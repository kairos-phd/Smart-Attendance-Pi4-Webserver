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
from .remote_ingest import RemoteIngestClient

LOG = logging.getLogger(__name__)

MAX_RETRIES = 5


class AttendanceService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        (settings.data_dir / "unknown").mkdir(parents=True, exist_ok=True)
        self.store = LocalStore(settings.data_dir / "edge.db")
        self.repo = FirebaseRepository(settings) if settings.firebase_service_account else None
        self.engine = FaceEngine(settings.model_name, settings.model_root, settings.face_det_size, settings.match_threshold)
        self.remote_client = (
            RemoteIngestClient(settings.backend_api_url, settings.device_api_key)
            if settings.backend_api_url
            else None
        )
        self.users: list[RegisteredUser] = []
        self.user_lock = threading.Lock()
        self.ai_lock = threading.Lock()
        self.stop_event = threading.Event()

    def start(self) -> None:
        if self.engine:
            self.engine.start()
        if self.repo:
            try:
                self.refresh_users()
            except Exception:
                # The Pi can boot before Wi-Fi is associated. It must still monitor and queue events.
                LOG.warning("Firebase is unavailable at startup; loading cached user embeddings from local store", exc_info=True)
                self.load_cached_users()
            threading.Thread(target=self._sync_loop, name="firebase-sync", daemon=True).start()
            threading.Thread(target=self._user_refresh_loop, name="user-refresh", daemon=True).start()
        if self.remote_client:
            health = self.remote_client.check_health()
            if health:
                LOG.info("Connected to AI Backend at %s (version %s)", self.settings.backend_api_url, health.get("version"))
            else:
                LOG.warning("AI Backend at %s not responding to health check; will retry in background", self.settings.backend_api_url)
            threading.Thread(target=self._heartbeat_loop, name="remote-heartbeat", daemon=True).start()

    def refresh_users(self) -> None:
        users = self.repo.active_users()
        with self.user_lock:
            self.users = users
        self.store.save_users(users)
        LOG.info("Loaded and cached %d active user embeddings", len(users))

    def load_cached_users(self) -> None:
        cached = self.store.load_users()
        with self.user_lock:
            self.users = cached
        LOG.info("Loaded %d cached user embeddings from local store", len(cached))

    def _user_refresh_loop(self) -> None:
        while not self.stop_event.wait(self.settings.user_refresh_seconds):
            try:
                self.refresh_users()
            except Exception:
                if not self.users:
                    self.load_cached_users()
                LOG.exception("Could not refresh registered users; retaining previous cache")

    def _sync_loop(self) -> None:
        while not self.stop_event.is_set():
            self.flush_queue()
            self.stop_event.wait(self.settings.queue_retry_seconds)

    def flush_queue(self) -> None:
        for row in self.store.pending():
            row_id = int(row["id"])
            attempts = int(row["attempts"])
            if attempts >= MAX_RETRIES:
                self.store.mark_failed(row_id)
                LOG.warning("Event %d exceeded max retries (%d); skipping to avoid deadlock", row_id, MAX_RETRIES)
                continue
            try:
                import json

                self.repo.write_event(row["event_type"], json.loads(row["payload"]))
                self.store.complete(row_id)
                LOG.info("Synchronized queued %s event %s", row["event_type"], row_id)
            except Exception:
                self.store.mark_retry(row_id)
                new_attempts = attempts + 1
                if new_attempts >= MAX_RETRIES:
                    self.store.mark_failed(row_id)
                    LOG.error(
                        "Event %d failed %d times; marked failed to prevent head-of-line blocking",
                        row_id,
                        new_attempts,
                        exc_info=True,
                    )
                    continue
                LOG.warning("Firebase still unavailable; pending events retained", exc_info=True)
                return

    def _heartbeat_loop(self) -> None:
        while not self.stop_event.is_set():
            if self.remote_client:
                cams = [{"camera_id": c.camera_id, "name": c.name, "status": "online"} for c in self.settings.cameras]
                self.remote_client.send_heartbeat(self.settings.pi_id, cams)
            self.stop_event.wait(30)

    def camera_status(self, camera: CameraConfig, status: str, message: str | None) -> None:
        if self.repo:
            try:
                self.repo.camera_status(camera, status, message)
            except Exception:
                LOG.warning("Unable to publish %s status for %s", status, camera.camera_id, exc_info=True)
        if self.remote_client:
            try:
                self.remote_client.send_heartbeat(
                    self.settings.pi_id,
                    [{"camera_id": camera.camera_id, "name": camera.name, "status": status}],
                    status=status,
                )
            except Exception:
                pass

    def handle_activity(self, camera: CameraConfig, frame: np.ndarray) -> None:
        if self.remote_client:
            res = self.remote_client.ingest_frame(
                camera_id=camera.camera_id,
                camera_name=camera.name,
                raspberry_pi_id=self.settings.pi_id,
                frame=frame,
            )
            if res is not None:
                results = res.get("results", [])
                for r in results:
                    if r.get("result") == "recognized":
                        LOG.info("Remote recognized %s on %s (%.3f)", r.get("name"), camera.camera_id, r.get("confidence", 0.0))
                    elif r.get("result") == "unknown":
                        LOG.info("Remote detected unknown face on %s", camera.camera_id)
                return
            if not self.repo or not self.engine:
                LOG.warning("Remote ingest failed on %s and local fallback is unavailable", camera.camera_id)
                return
            LOG.info("Remote ingest failed; falling back to local inference")

        if not self.engine:
            return
        # Protect Pi CPU/RAM: camera loops remain responsive while one AI job runs.
        # Use a short timeout so near-simultaneous triggers from multiple cameras can be processed.
        if not self.ai_lock.acquire(timeout=0.35):
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
        if self.repo:
            try:
                self.repo.write_event(event.event_type, event.payload())
                return
            except Exception:
                LOG.warning("Firebase write failed; queued %s event locally", event.event_type, exc_info=True)
        self.store.enqueue(event.event_type, event.payload())

    def run(self) -> None:
        self.start()
        cam_ids = [camera.camera_id for camera in self.settings.cameras]
        LOG.info("Starting edge attendance service with %d camera(s): %s", len(cam_ids), ", ".join(cam_ids))
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
