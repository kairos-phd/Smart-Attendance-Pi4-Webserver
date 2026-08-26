from __future__ import annotations

import json
import shutil
from pathlib import Path

import cv2
import numpy as np


class LocalDataset:
    """Private laptop dataset. Its paths are never written to Firestore."""

    def __init__(self, root: Path, save_images: bool) -> None:
        self.root = root / "enrollments"
        self.save_images = save_images
        self.root.mkdir(parents=True, exist_ok=True)

    def save(
        self,
        user_id: str,
        images: list[np.ndarray],
        embeddings: list[list[float]],
        metadata: dict[str, object],
    ) -> None:
        user_dir = self.root / user_id
        user_dir.mkdir(parents=True, exist_ok=False)
        try:
            np.save(user_dir / "embeddings.npy", np.asarray(embeddings, dtype=np.float32), allow_pickle=False)
            (user_dir / "metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
            if self.save_images and images:
                samples_dir = user_dir / "samples"
                samples_dir.mkdir()
                for index, image in enumerate(images, start=1):
                    if not cv2.imwrite(str(samples_dir / f"sample-{index:02d}.jpg"), image):
                        raise RuntimeError(f"Could not save enrollment image {index}")
        except Exception:
            shutil.rmtree(user_dir, ignore_errors=True)
            raise

    def exists(self, user_id: str) -> bool:
        return (self.root / user_id / "embeddings.npy").is_file()

    def recover_profile(self, user_id: str, embedding: list[float], metadata: dict[str, object]) -> bool:
        """Migrate a legacy profile or back up its Firestore embedding locally."""
        if self.exists(user_id):
            return False
        user_dir = self.root / user_id
        user_dir.mkdir(parents=True, exist_ok=True)
        legacy_embedding = user_dir / "embedding.npy"
        vector = np.asarray(
            np.load(legacy_embedding, allow_pickle=False) if legacy_embedding.is_file() else embedding,
            dtype=np.float32,
        ).reshape(-1)
        if vector.ndim != 1 or vector.size == 0 or not np.isfinite(vector).all():
            raise ValueError("The recovered face embedding is invalid")
        np.save(user_dir / "embeddings.npy", vector.reshape(1, -1), allow_pickle=False)

        legacy_image = user_dir / "enrollment.jpg"
        if self.save_images and legacy_image.is_file():
            samples_dir = user_dir / "samples"
            samples_dir.mkdir(exist_ok=True)
            sample_path = samples_dir / "sample-01.jpg"
            if not sample_path.exists():
                shutil.copy2(legacy_image, sample_path)

        (user_dir / "recovery.json").write_text(json.dumps({
            **metadata,
            "recovered_from": "legacy_local_profile" if legacy_embedding.is_file() else "firestore_profile",
            "sample_images_available": legacy_image.is_file(),
        }, ensure_ascii=False, indent=2), encoding="utf-8")
        return True

    def remove(self, user_id: str) -> None:
        shutil.rmtree(self.root / user_id, ignore_errors=True)
