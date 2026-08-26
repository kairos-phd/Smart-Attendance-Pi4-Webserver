from __future__ import annotations

import logging
import signal
import threading
import time
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np

from .camera import CameraWorker
from .config import CameraConfig, Settings
from .face_engine import FaceEngine
from .firebase_repository import FirebaseRepository
from .local_store import LocalStore
from .models import Event, RegisteredUser, utc_now

LOG = logging.getLogger(__name__)


class AttendanceService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        (settings.data_dir / "unknown").mkdir(parents=True, exist_ok=True)
        self.store = LocalStore(settings.data_dir / "edge.db")
        self.repo = FirebaseRepository(settings)
        self.engine = FaceEngine(settings.model_name, settings.model_root, settings.face_det_size, settings.match_threshold)
        self.users: list[RegisteredUser] = []
        self.user_lock = threading.Lock()
        self.ai_lock = threading.Lock()
        self.stop_event = threading.Event()

    def start(self) -> None:
        self.engine.start()
        try:
            self.refresh_users()
        except Exception:
            # The Pi can boot before Wi-Fi is associated. It must still monitor and queue events.
            LOG.exception("Firebase is unavailable at startup; beginning with an empty user cache")
        threading.Thread(target=self._sync_loop, name="firebase-sync", daemon=True).start()
        threading.Thread(target=self._user_refresh_loop, name="user-refresh", daemon=True).start()

    def refresh_users(self) -> None:
        users = self.repo.active_users()
        with self.user_lock:
            self.users = users
        LOG.info("Loaded %d active user embeddings", len(users))

    def _user_refresh_loop(self) -> None:
        while not self.stop_event.wait(self.settings.user_refresh_seconds):
            try:
                self.refresh_users()
            except Exception:
                LOG.exception("Could not refresh registered users; retaining previous cache")

    def _sync_loop(self) -> None:
        while not self.stop_event.is_set():
            self.flush_queue()
            self.stop_event.wait(self.settings.queue_retry_seconds)

    def flush_queue(self) -> None:
        for row in self.store.pending():
            try:
                import json

                self.repo.write_event(row["event_type"], json.loads(row["payload"]))
                self.store.complete(int(row["id"]))
                LOG.info("Synchronized queued %s event %s", row["event_type"], row["id"])
            except Exception:
                self.store.mark_retry(int(row["id"]))
                LOG.warning("Firebase still unavailable; pending events retained", exc_info=True)
                return

    def camera_status(self, camera: CameraConfig, status: str, message: str | None) -> None:
        try:
            self.repo.camera_status(camera, status, message)
        except Exception:
            LOG.warning("Unable to publish %s status for %s", status, camera.camera_id, exc_info=True)

    def handle_activity(self, camera: CameraConfig, frame: np.ndarray) -> None:
        # This lock protects Pi CPU/RAM: camera loops remain responsive while one AI job runs.
        if not self.ai_lock.acquire(blocking=False):
            LOG.debug("Skipping activity from %s while another AI job is running", camera.camera_id)
            return
        try:
            with self.user_lock:
                users = list(self.users)
            recognitions = self.engine.recognize(frame, users)
            if not recognitions:
                LOG.debug("Activity on %s had no face", camera.camera_id)
                return
            for recognition in recognitions:
                if recognition.user:
                    event = Event(
                        event_type="attendance",
                        camera_id=camera.camera_id,
                        occurred_at=utc_now(),
                        confidence=recognition.confidence,
                        user_id=recognition.user.user_id,
                        name=recognition.user.name,
                    )
                    if self.store.accept_attendance(
                        camera.camera_id, recognition.user.user_id, self.settings.attendance_cooldown_seconds
                    ):
                        self._submit(event)
                        LOG.info("Recognized %s on %s (%.3f)", recognition.user.name, camera.camera_id, recognition.confidence)
                    else:
                        LOG.debug("Suppressed duplicate attendance for %s", recognition.user.user_id)
                else:
                    event = Event(
                        event_type="unknown",
                        camera_id=camera.camera_id,
                        occurred_at=utc_now(),
                        confidence=recognition.confidence,
                        image_path=self._save_unknown_image(frame) if self.settings.save_unknown_images else None,
                    )
                    self._submit(event)
                    LOG.info("Unknown face on %s (best score %.3f)", camera.camera_id, recognition.confidence)
        except Exception:
            LOG.exception("Unable to process activity on %s", camera.camera_id)
        finally:
            self.ai_lock.release()

    def _save_unknown_image(self, frame: np.ndarray) -> str | None:
        path = self.settings.data_dir / "unknown" / f"unknown-{datetime.utcnow():%Y%m%dT%H%M%S}-{time.time_ns()}.jpg"
        if cv2.imwrite(str(path), frame):
            return str(path)
        LOG.warning("Could not save unknown-event image %s", path)
        return None

    def _submit(self, event: Event) -> None:
        try:
            self.repo.write_event(event.event_type, event.payload())
        except Exception:
            self.store.enqueue(event.event_type, event.payload())
            LOG.warning("Firebase write failed; queued %s event locally", event.event_type, exc_info=True)

    def run(self) -> None:
        self.start()
        workers = [
            CameraWorker(camera, self.settings, self.stop_event, self.handle_activity, self.camera_status)
            for camera in self.settings.cameras
        ]
        for worker in workers:
            worker.start()
        while not self.stop_event.wait(1):
            pass
        for worker in workers:
            worker.join(timeout=3)
        self.flush_queue()
        self.store.close()

    def stop(self) -> None:
        self.stop_event.set()


def main() -> None:
    settings = Settings.from_env()
    logging.basicConfig(
        level=getattr(logging, settings.log_level, logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    service = AttendanceService(settings)
    signal.signal(signal.SIGTERM, lambda *_: service.stop())
    signal.signal(signal.SIGINT, lambda *_: service.stop())
    service.run()


if __name__ == "__main__":
    main()
