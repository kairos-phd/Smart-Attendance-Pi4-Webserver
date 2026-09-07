from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta
from pathlib import Path
from uuid import uuid4

try:
    from zoneinfo import ZoneInfo
    LOCAL_TZ = ZoneInfo("Asia/Ho_Chi_Minh")
except Exception:
    LOCAL_TZ = timezone(timedelta(hours=7))

import firebase_admin
from firebase_admin import credentials, firestore, storage

from .config import CameraConfig, Settings
from .models import Event, RegisteredUser

LOG = logging.getLogger(__name__)


class FirebaseRepository:
    def __init__(self, settings: Settings) -> None:
        if not settings.firebase_service_account.exists():
            raise FileNotFoundError(f"Firebase service-account file not found: {settings.firebase_service_account}")
        options = {"storageBucket": settings.firebase_storage_bucket} if settings.firebase_storage_bucket else None
        if not firebase_admin._apps:
            firebase_admin.initialize_app(credentials.Certificate(str(settings.firebase_service_account)), options)
        self.db = firestore.client()
        self.bucket = storage.bucket() if settings.firebase_storage_bucket else None
        self.pi_id = settings.pi_id

    def active_users(self) -> list[RegisteredUser]:
        users: list[RegisteredUser] = []
        for document in self.db.collection("users").where("status", "==", "active").stream():
            data = document.to_dict()
            embedding = data.get("face_embedding")
            if isinstance(embedding, list) and embedding:
                users.append(RegisteredUser(document.id, data.get("name", "Unnamed"), embedding, data.get("student_id")))
        return users

    def camera_status(self, camera: CameraConfig, status: str, message: str | None = None) -> None:
        payload = {
            "camera_id": camera.camera_id,
            "name": camera.name,
            "raspberry_pi_id": self.pi_id,
            "status": status,
            "last_seen": firestore.SERVER_TIMESTAMP,
        }
        if message:
            payload["last_error"] = message
        self.db.collection("cameras").document(camera.camera_id).set(payload, merge=True)

    def write_event(self, event_type: str, payload: dict) -> None:
        occurred_at = datetime.fromisoformat(payload["occurred_at"])
        if occurred_at.tzinfo is None:
            occurred_at = occurred_at.replace(tzinfo=timezone.utc)
        local_time = occurred_at.astimezone(LOCAL_TZ)
        if event_type == "attendance":
            doc = {
                "attendance_id": payload["event_id"],
                "user_id": payload["user_id"],
                "name": payload["name"],
                "camera_id": payload["camera_id"],
                "timestamp": occurred_at,
                "date": local_time.date().isoformat(),
                "confidence": payload["confidence"],
                "status": "recognized",
                "raspberry_pi_id": self.pi_id,
                "created_at": firestore.SERVER_TIMESTAMP,
            }
            # Idempotent document IDs prevent duplicates if a request times out and is replayed.
            self.db.collection("attendance").document(payload["event_id"]).set(doc)
        elif event_type == "unknown":
            image_ref = self._upload_unknown(Path(payload["image_path"])) if payload.get("image_path") else None
            doc = {
                "event_id": payload["event_id"],
                "camera_id": payload["camera_id"],
                "timestamp": occurred_at,
                "confidence": payload["confidence"],
                "recognition_status": "unknown",
                "image_url": image_ref,
                "raspberry_pi_id": self.pi_id,
                "created_at": firestore.SERVER_TIMESTAMP,
            }
            self.db.collection("unknown_events").document(payload["event_id"]).set(doc)
        else:
            raise ValueError(f"Unsupported queued event type: {event_type}")

    def _upload_unknown(self, image_path: Path) -> str | None:
        if not image_path.exists():
            LOG.warning("Unknown-event image no longer exists: %s", image_path)
            return None
        if self.bucket is None:
            # Local filesystem paths are private implementation details and are
            # unusable by web/mobile clients. Firestore receives metadata only.
            return None
        destination = f"unknown/{datetime.utcnow():%Y/%m/%d}/{uuid4()}.jpg"
        blob = self.bucket.blob(destination)
        blob.upload_from_filename(str(image_path), content_type="image/jpeg")
        return f"gs://{self.bucket.name}/{destination}"
