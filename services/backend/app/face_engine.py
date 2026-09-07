from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np


@dataclass(frozen=True)
class RegisteredUser:
    user_id: str
    name: str
    embeddings: list[list[float]]
    student_id: str | None = None
    centroid: list[float] | None = None


@dataclass(frozen=True)
class Recognition:
    confidence: float
    second_best_confidence: float
    bbox: tuple[int, int, int, int]
    user: RegisteredUser | None


@dataclass(frozen=True)
class EnrollmentSample:
    embedding: list[float]
    detection_score: float
    blur_score: float
    brightness: float
    face_ratio: float
    face_crop: np.ndarray
    detected_faces: int
    ignored_background_faces: int


class FaceEngine:
    """Laptop-side SCRFD detection and ArcFace embedding/recognition."""

    def __init__(
        self,
        model_name: str,
        model_root: Path,
        det_size: int,
        match_threshold: float,
        match_margin: float = 0.06,
    ) -> None:
        self.model_name = model_name
        self.model_root = model_root
        self.det_size = det_size
        self.match_threshold = match_threshold
        self.match_margin = match_margin
        self._app = None
        self._centroid_cache: dict[str, np.ndarray] = {}
        self._cached_users_id: int | None = None
        self._cached_profile_matrix: np.ndarray | None = None

    def start(self) -> None:
        from insightface.app import FaceAnalysis

        self.model_root.mkdir(parents=True, exist_ok=True)
        self._app = FaceAnalysis(name=self.model_name, root=str(self.model_root), providers=["CPUExecutionProvider"])
        self._app.prepare(ctx_id=-1, det_size=(self.det_size, self.det_size))

    @staticmethod
    def _face_bounds(face: object, width: int, height: int) -> tuple[int, int, int, int]:
        x1, y1, x2, y2 = (int(value) for value in face.bbox)
        return max(0, x1), max(0, y1), min(width, x2), min(height, y2)

    @classmethod
    def _select_enrollment_face(cls, faces: list[object], width: int, height: int) -> tuple[object, int]:
        """Select one dominant portrait while ignoring small background faces.

        Enrollment photos often contain blurred people in the background. Rejecting
        every multi-face detection makes good portraits unusable, while accepting a
        group photo could enroll the wrong identity. The largest foreground face is
        accepted only when no other credible face is at least 35% of its area.
        """
        candidates: list[tuple[int, float, object]] = []
        for face in faces:
            x1, y1, x2, y2 = cls._face_bounds(face, width, height)
            area = max(0, x2 - x1) * max(0, y2 - y1)
            if area > 0:
                candidates.append((area, float(face.det_score), face))
        if not candidates:
            raise ValueError("No face was detected in the enrollment image")

        candidates.sort(key=lambda item: (item[0], item[1]), reverse=True)
        primary_area, _, primary = candidates[0]
        ambiguous = [
            item for item in candidates[1:]
            if item[1] >= 0.60 and item[0] / float(primary_area) >= 0.35
        ]
        if ambiguous:
            raise ValueError(
                "More than one prominent face was detected; use a portrait with one clear foreground person"
            )
        return primary, len(candidates) - 1

    @staticmethod
    def _expanded_face_crop(
        image: np.ndarray,
        bounds: tuple[int, int, int, int],
        padding_ratio: float = 0.28,
    ) -> np.ndarray:
        height, width = image.shape[:2]
        x1, y1, x2, y2 = bounds
        pad_x = int((x2 - x1) * padding_ratio)
        pad_y = int((y2 - y1) * padding_ratio)
        return image[max(0, y1 - pad_y):min(height, y2 + pad_y), max(0, x1 - pad_x):min(width, x2 + pad_x)].copy()

    def enrollment_sample(self, image: np.ndarray) -> EnrollmentSample:
        if self._app is None:
            raise RuntimeError("The face engine is not ready")
        faces = self._app.get(image)
        height, width = image.shape[:2]
        face, ignored_background_faces = self._select_enrollment_face(faces, width, height)
        detection_score = float(face.det_score)
        if detection_score < 0.65:
            raise ValueError("Face detection confidence is too low; use a clear, well-lit image")

        x1, y1, x2, y2 = self._face_bounds(face, width, height)
        face_area = max(0, x2 - x1) * max(0, y2 - y1)
        face_ratio = face_area / float(max(1, width * height))
        if face_ratio < 0.035 or min(x2 - x1, y2 - y1) < 80:
            raise ValueError("The face is too small; move closer to the camera")

        crop = image[y1:y2, x1:x2]
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        blur_score = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        if blur_score < 45.0:
            raise ValueError("The enrollment image is too blurry; hold still and use a sharper image")
        brightness = float(np.mean(gray))
        if brightness < 35.0:
            raise ValueError("The enrollment image is too dark; improve the lighting")
        if brightness > 225.0:
            raise ValueError("The enrollment image is overexposed; reduce the lighting")

        return EnrollmentSample(
            embedding=np.asarray(face.normed_embedding, dtype=np.float32).tolist(),
            detection_score=detection_score,
            blur_score=blur_score,
            brightness=brightness,
            face_ratio=face_ratio,
            face_crop=self._expanded_face_crop(image, (x1, y1, x2, y2)),
            detected_faces=len(faces),
            ignored_background_faces=ignored_background_faces,
        )

    def embedding_from_image(self, image: np.ndarray) -> list[float]:
        """Backward-compatible single-sample helper."""
        return self.enrollment_sample(image).embedding

    @staticmethod
    def profile_embedding(embeddings: list[list[float]]) -> list[float]:
        matrix = np.asarray(embeddings, dtype=np.float32)
        centroid = np.mean(matrix, axis=0)
        norm = float(np.linalg.norm(centroid))
        if norm <= 0:
            raise ValueError("The face profile could not be normalized")
        return (centroid / norm).tolist()

    def clear_centroid_cache(self) -> None:
        self._centroid_cache.clear()
        self._cached_users_id = None
        self._cached_profile_matrix = None

    def _get_profile_matrix(self, users: list[RegisteredUser]) -> np.ndarray | None:
        if not users:
            return None
        if self._cached_users_id == id(users) and self._cached_profile_matrix is not None:
            return self._cached_profile_matrix

        vectors: list[np.ndarray] = []
        for user in users:
            cached = self._centroid_cache.get(user.user_id)
            if cached is None:
                if user.centroid is not None:
                    cached = np.asarray(user.centroid, dtype=np.float32)
                else:
                    cached = np.asarray(self.profile_embedding(user.embeddings), dtype=np.float32)
                self._centroid_cache[user.user_id] = cached
            vectors.append(cached)

        matrix = np.asarray(vectors, dtype=np.float32)
        self._cached_users_id = id(users)
        self._cached_profile_matrix = matrix
        return matrix

    def recognize(self, image: np.ndarray, users: list[RegisteredUser]) -> list[Recognition]:
        if self._app is None:
            raise RuntimeError("The face engine is not ready")
        faces = self._app.get(image)
        height, width = image.shape[:2]
        profile_matrix = self._get_profile_matrix(users)
        results: list[Recognition] = []
        for face in faces:
            embedding = np.asarray(face.normed_embedding, dtype=np.float32)
            matched_user = None
            best_score = 0.0
            second_score = -1.0
            if users and profile_matrix is not None:
                similarities = profile_matrix @ embedding
                ranking = np.argsort(similarities)[::-1]
                best_index = int(ranking[0])
                best_score = float(similarities[best_index])
                if len(ranking) > 1:
                    second_score = float(similarities[int(ranking[1])])
                if best_score >= self.match_threshold and best_score - second_score >= self.match_margin:
                    matched_user = users[best_index]
            bbox = self._face_bounds(face, width, height)
            results.append(Recognition(best_score, second_score, bbox, matched_user))
        return results
