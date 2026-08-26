from __future__ import annotations

import logging
from pathlib import Path

import numpy as np

from .models import Recognition, RegisteredUser

LOG = logging.getLogger(__name__)


class FaceEngine:
    """SCRFD detection plus ArcFace embeddings through a small InsightFace pack."""

    def __init__(self, model_name: str, model_root: Path, det_size: int, match_threshold: float) -> None:
        self.model_name = model_name
        self.model_root = model_root
        self.det_size = det_size
        self.match_threshold = match_threshold
        self._app = None

    def start(self) -> None:
        # Import late so camera/motion diagnostics can still run before a model is installed.
        from insightface.app import FaceAnalysis

        self.model_root.mkdir(parents=True, exist_ok=True)
        self._app = FaceAnalysis(
            name=self.model_name,
            root=str(self.model_root),
            providers=["CPUExecutionProvider"],
        )
        self._app.prepare(ctx_id=-1, det_size=(self.det_size, self.det_size))
        LOG.info("Loaded InsightFace model %s at %spx", self.model_name, self.det_size)

    def embedding_from_image(self, image: np.ndarray) -> list[float]:
        if self._app is None:
            raise RuntimeError("FaceEngine.start() must be called before use")
        faces = self._app.get(image)
        if not faces:
            raise ValueError("No face was detected in the enrollment image")
        face = max(faces, key=lambda candidate: float(candidate.det_score))
        if float(face.det_score) < 0.60:
            raise ValueError("Face detection confidence is too low; use a clear, well-lit face photo")
        return np.asarray(face.normed_embedding, dtype=np.float32).tolist()

    def recognize(self, image: np.ndarray, users: list[RegisteredUser]) -> list[Recognition]:
        if self._app is None:
            raise RuntimeError("FaceEngine.start() must be called before use")
        faces = self._app.get(image)
        if not faces:
            return []
        if users:
            user_matrix = np.asarray([user.embedding for user in users], dtype=np.float32)
        else:
            user_matrix = np.empty((0, 0), dtype=np.float32)

        results: list[Recognition] = []
        for face in faces:
            embedding = np.asarray(face.normed_embedding, dtype=np.float32)
            matched_user = None
            score = 0.0
            if len(users):
                similarities = user_matrix @ embedding
                index = int(np.argmax(similarities))
                score = float(similarities[index])
                if score >= self.match_threshold:
                    matched_user = users[index]
            x1, y1, x2, y2 = (int(value) for value in face.bbox)
            results.append(Recognition(score, (x1, y1, x2, y2), matched_user))
        return results
