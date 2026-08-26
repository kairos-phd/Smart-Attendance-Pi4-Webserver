from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np

from app.face_engine import FaceEngine
from app.settings import BackendSettings


SUPPORTED_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}


def embeddings(engine: FaceEngine, folder: Path) -> list[tuple[str, np.ndarray]]:
    results: list[tuple[str, np.ndarray]] = []
    for path in sorted(folder.iterdir()):
        if not path.is_file() or path.suffix.lower() not in SUPPORTED_SUFFIXES:
            continue
        image = cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError(f"Could not decode {path}")
        sample = engine.enrollment_sample(image)
        results.append((path.name, np.asarray(sample.embedding, dtype=np.float32)))
    return results


def normalized_centroid(values: list[np.ndarray]) -> np.ndarray:
    centroid = np.stack(values).mean(axis=0)
    return centroid / max(float(np.linalg.norm(centroid)), 1e-12)


def main() -> None:
    parser = argparse.ArgumentParser(description="Leave-one-out recognition check for two approved datasets.")
    parser.add_argument("first", type=Path)
    parser.add_argument("second", type=Path)
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

    first_label = args.first.parent.name if args.first.name == "approved_enrollment" else args.first.name
    second_label = args.second.parent.name if args.second.name == "approved_enrollment" else args.second.name
    groups = [(first_label, embeddings(engine, args.first)), (second_label, embeddings(engine, args.second))]
    rows: list[dict[str, object]] = []
    for group_index, (label, samples) in enumerate(groups):
        other_label, other_samples = groups[1 - group_index]
        other_profile = normalized_centroid([embedding for _, embedding in other_samples])
        for sample_index, (filename, embedding) in enumerate(samples):
            own_others = [value for index, (_, value) in enumerate(samples) if index != sample_index]
            own_profile = normalized_centroid(own_others)
            own_score = float(own_profile @ embedding)
            other_score = float(other_profile @ embedding)
            margin = own_score - other_score
            rows.append({
                "expected": label,
                "file": filename,
                "own_score": round(own_score, 4),
                f"{other_label}_score": round(other_score, 4),
                "margin": round(margin, 4),
                "recognized_correctly": own_score >= settings.match_threshold and margin >= settings.match_margin,
            })

    print(json.dumps({
        "match_threshold": settings.match_threshold,
        "match_margin": settings.match_margin,
        "results": rows,
        "all_correct": all(bool(row["recognized_correctly"]) for row in rows),
    }, indent=2))


if __name__ == "__main__":
    main()
