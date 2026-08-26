from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable

import cv2
import numpy as np

from .config import CameraConfig, Settings
from .motion import MotionDetector

LOG = logging.getLogger(__name__)


class CameraWorker(threading.Thread):
    """A recoverable, lightweight monitor for one V4L2/OpenCV camera source."""

    def __init__(
        self,
        camera: CameraConfig,
        settings: Settings,
        stop_event: threading.Event,
        on_activity: Callable[[CameraConfig, np.ndarray], None],
        on_status: Callable[[CameraConfig, str, str | None], None],
    ) -> None:
        super().__init__(name=f"camera-{camera.camera_id}", daemon=True)
        self.camera = camera
        self.settings = settings
        self.stop_event = stop_event
        self.on_activity = on_activity
        self.on_status = on_status
        self.detector = MotionDetector(settings.motion_min_area)

    def run(self) -> None:
        retry_seconds = 5
        while not self.stop_event.is_set():
            cap = cv2.VideoCapture(self.camera.source, cv2.CAP_V4L2)
            if not cap.isOpened():
                message = f"Cannot open source {self.camera.source!r}; retrying in {retry_seconds}s"
                LOG.error("%s: %s", self.camera.camera_id, message)
                self.on_status(self.camera, "offline", message)
                self.stop_event.wait(retry_seconds)
                continue
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.settings.frame_width)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.settings.frame_height)
            self.on_status(self.camera, "online", None)
            LOG.info("%s is online (%s)", self.camera.camera_id, self.camera.source)
            last_capture = 0.0
            frame_delay = 1 / max(1.0, self.settings.monitor_fps)
            try:
                while not self.stop_event.is_set():
                    started = time.monotonic()
                    ok, frame = cap.read()
                    if not ok or frame is None:
                        raise RuntimeError("Camera returned no frame")
                    if (
                        time.monotonic() - last_capture >= self.settings.camera_cooldown_seconds
                        and self.detector.has_activity(frame)
                    ):
                        last_capture = time.monotonic()
                        self.on_activity(self.camera, frame.copy())
                    remaining = frame_delay - (time.monotonic() - started)
                    if remaining > 0:
                        self.stop_event.wait(remaining)
            except Exception as exc:  # Reopen physical cameras after a disconnect/read failure.
                LOG.exception("%s failed", self.camera.camera_id)
                self.on_status(self.camera, "offline", str(exc))
                self.stop_event.wait(retry_seconds)
            finally:
                cap.release()
