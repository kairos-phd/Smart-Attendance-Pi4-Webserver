from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np

from app.face_engine import FaceEngine
from app.settings import BackendSettings


SUPPORTED_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}


def load_image(path: Path) -> np.ndarray | None:
    data = np.fromfile(path, dtype=np.uint8)
    return cv2.imdecode(data, cv2.IMREAD_COLOR)


def save_image(path: Path, image: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    suffix = path.suffix.lower()
    extension = suffix if suffix in {".jpg", ".jpeg", ".png", ".webp"} else ".jpg"
    ok, encoded = cv2.imencode(extension, image)
    if not ok:
        raise RuntimeError(f"Could not encode {path.name}")
    encoded.tofile(path)


def dominant_face_crop(engine: FaceEngine, image: np.ndarray) -> np.ndarray:
    if engine._app is None:
        raise RuntimeError("Face engine is not ready")
    height, width = image.shape[:2]
    faces = engine._app.get(image)
    face, _ = engine._select_enrollment_face(faces, width, height)
    bounds = engine._face_bounds(face, width, height)
    return engine._expanded_face_crop(image, bounds, padding_ratio=0.45)


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate a folder with the real SIC enrollment pipeline.")
    parser.add_argument("folder", type=Path)
    parser.add_argument("--crop-output", type=Path)
    args = parser.parse_args()

    settings = BackendSettings.from_env()
    engine = FaceEngine(
        settings.model_name,
        settings.model_root,
        settings.face_det_size,
        settings.match_threshold,
        settings.match_margin,
    )
    engine.start()

    files = sorted(
        path for path in args.folder.iterdir()
        if path.is_file() and path.suffix.lower() in SUPPORTED_SUFFIXES
    )
    records: list[dict[str, object]] = []
    accepted_embeddings: list[np.ndarray] = []
    accepted_records: list[dict[str, object]] = []

    for path in files:
        image = load_image(path)
        if image is None:
            records.append({"file": path.name, "passed": False, "error": "Image could not be decoded"})
            continue

        candidate = image
        cropped = False
        try:
            sample = engine.enrollment_sample(candidate)
        except ValueError as original_error:
            if args.crop_output is None:
                records.append({"file": path.name, "passed": False, "error": str(original_error)})
                continue
            try:
                candidate = dominant_face_crop(engine, image)
                sample = engine.enrollment_sample(candidate)
                cropped = True
            except ValueError as crop_error:
                records.append({
                    "file": path.name,
                    "passed": False,
                    "error": str(original_error),
                    "after_crop_error": str(crop_error),
                })
                continue

        if args.crop_output is not None:
            output_path = args.crop_output / f"{path.stem}.jpg"
            save_image(output_path, sample.face_crop if not cropped else candidate)

        embedding = np.asarray(sample.embedding, dtype=np.float32)
        accepted_embeddings.append(embedding)
        record: dict[str, object] = {
            "file": path.name,
            "passed": True,
            "cropped_to_pass": cropped,
            "detection_score": round(sample.detection_score, 4),
            "blur_score": round(sample.blur_score, 2),
            "brightness": round(sample.brightness, 2),
            "face_ratio": round(sample.face_ratio, 4),
            "detected_faces": sample.detected_faces,
            "ignored_background_faces": sample.ignored_background_faces,
        }
        records.append(record)
        accepted_records.append(record)

    consistency: dict[str, object] = {"accepted": len(accepted_embeddings)}
    if len(accepted_embeddings) >= 2:
        matrix = np.stack(accepted_embeddings)
        centroid = matrix.mean(axis=0)
        centroid /= max(float(np.linalg.norm(centroid)), 1e-12)
        centroid_scores = matrix @ centroid
        for record, score in zip(accepted_records, centroid_scores, strict=True):
            record["centroid_similarity"] = round(float(score), 4)
        pair_scores = matrix @ matrix.T
        lower_triangle = pair_scores[np.tril_indices(len(matrix), k=-1)]
        consistency.update({
            "minimum_centroid_similarity": round(float(centroid_scores.min()), 4),
            "minimum_pair_similarity": round(float(lower_triangle.min()), 4),
            "required_centroid_similarity": settings.enrollment_consistency_threshold,
        })

    print(json.dumps({"folder": str(args.folder), "images": records, "consistency": consistency}, indent=2))


if __name__ == "__main__":
    main()
