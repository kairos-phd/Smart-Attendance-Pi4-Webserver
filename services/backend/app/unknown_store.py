from __future__ import annotations

import re
import time
from pathlib import Path

import cv2
import numpy as np


_EVENT_ID = re.compile(r"^[0-9a-f]{32}$")


class UnknownImageStore:
    """Private laptop-only storage for confirmed unknown face crops."""

    def __init__(self, data_root: Path, retention_days: int) -> None:
        self.root = data_root / "unknown"
        self.retention_seconds = max(1, retention_days) * 24 * 60 * 60
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, event_id: str) -> Path:
        if not _EVENT_ID.fullmatch(event_id):
            raise ValueError("Invalid unknown-event ID")
        return self.root / f"{event_id}.jpg"

    def save(self, event_id: str, image: np.ndarray, bbox: tuple[int, int, int, int]) -> Path:
        height, width = image.shape[:2]
        x1, y1, x2, y2 = bbox
        padding_x = max(12, int((x2 - x1) * 0.25))
        padding_y = max(12, int((y2 - y1) * 0.25))
        x1, y1 = max(0, x1 - padding_x), max(0, y1 - padding_y)
        x2, y2 = min(width, x2 + padding_x), min(height, y2 + padding_y)
        crop = image[y1:y2, x1:x2]
        if crop.size == 0:
            raise ValueError("The unknown face crop is empty")
        path = self._path(event_id)
        if not cv2.imwrite(str(path), crop, [cv2.IMWRITE_JPEG_QUALITY, 88]):
            raise RuntimeError("Could not save the unknown face crop")
        return path

    def path(self, event_id: str) -> Path | None:
        path = self._path(event_id)
        return path if path.is_file() else None

    def delete(self, event_id: str) -> bool:
        path = self._path(event_id)
        if not path.exists():
            return False
        path.unlink()
        return True

    def cleanup(self) -> int:
        cutoff = time.time() - self.retention_seconds
        removed = 0
        for path in self.root.glob("*.jpg"):
            if path.stat().st_mtime < cutoff:
                path.unlink()
                removed += 1
        return removed
