from __future__ import annotations

import os
from pathlib import Path
from unittest import mock

from attendance_edge.config import Settings
from attendance_edge.local_store import LocalStore
from attendance_edge.main import AttendanceService, MAX_RETRIES
from attendance_edge.models import RegisteredUser


def test_offline_user_cache_fallback(tmp_path: Path) -> None:
    db_path = tmp_path / "data" / "edge.db"
    store = LocalStore(db_path)
    store.save_users([
        RegisteredUser("u100", "Cached Student", [0.11, 0.22, 0.33], "ST100")
    ])
    store.close()

    sa_file = tmp_path / "dummy-sa.json"
    sa_file.write_text("{}")

    env = {
        "FIREBASE_SERVICE_ACCOUNT": str(sa_file),
        "DATA_DIR": str(tmp_path / "data"),
    }
    with mock.patch.dict(os.environ, env, clear=True):
        settings = Settings.from_env()

    with mock.patch("attendance_edge.main.FirebaseRepository") as mock_repo_cls, \
         mock.patch("attendance_edge.main.FaceEngine") as mock_engine_cls:
        mock_repo = mock_repo_cls.return_value
        mock_repo.active_users.side_effect = ConnectionError("Firebase offline")

        service = AttendanceService(settings)
        # Verify startup offline behavior
        service.engine.start = mock.MagicMock()
        with mock.patch("threading.Thread"):  # avoid starting background threads in test
            service.start()

        assert len(service.users) == 1
        assert service.users[0].user_id == "u100"
        assert service.users[0].name == "Cached Student"
        service.store.close()


def test_sync_deadlock_recovery_with_max_retries(tmp_path: Path) -> None:
    sa_file = tmp_path / "dummy-sa.json"
    sa_file.write_text("{}")
    env = {
        "FIREBASE_SERVICE_ACCOUNT": str(sa_file),
        "DATA_DIR": str(tmp_path / "data"),
    }
    with mock.patch.dict(os.environ, env, clear=True):
        settings = Settings.from_env()

    with mock.patch("attendance_edge.main.FirebaseRepository") as mock_repo_cls, \
         mock.patch("attendance_edge.main.FaceEngine"):
        mock_repo = mock_repo_cls.return_value

        service = AttendanceService(settings)

        # Enqueue 1 poison event and 1 good event
        service.store.enqueue("attendance", {"event_id": "bad-1", "data": "corrupt"})
        service.store.enqueue("attendance", {"event_id": "good-2", "user_id": "u1"})

        def write_side_effect(event_type: str, payload: dict) -> None:
            if payload.get("event_id") == "bad-1":
                raise ValueError("Corrupted payload cannot be serialized to Firestore")
            return None

        mock_repo.write_event.side_effect = write_side_effect

        # For the first 4 retries, the bad event fails and returns early
        for i in range(MAX_RETRIES - 1):
            service.flush_queue()
            pending = service.store.pending()
            assert len(pending) == 2
            assert pending[0]["id"] == 1
            assert pending[0]["attempts"] == i + 1

        # On the 5th attempt, the bad event hits MAX_RETRIES (5),
        # gets marked failed, and flush_queue continues to good-2!
        service.flush_queue()

        # good-2 was successfully synchronized and completed!
        # bad-1 is marked failed and no longer in pending.
        assert len(service.store.pending()) == 0
        assert len(service.store.failed()) == 1
        assert service.store.failed()[0]["id"] == 1
        service.store.close()


def test_firebase_repository_vietnam_timezone_date(tmp_path: Path) -> None:
    from attendance_edge.firebase_repository import FirebaseRepository

    sa_file = tmp_path / "dummy-sa.json"
    sa_file.write_text("{}")
    env = {
        "FIREBASE_SERVICE_ACCOUNT": str(sa_file),
        "DATA_DIR": str(tmp_path / "data"),
    }
    with mock.patch.dict(os.environ, env, clear=True):
        settings = Settings.from_env()

    with mock.patch("firebase_admin.credentials.Certificate"), \
         mock.patch("firebase_admin.initialize_app"), \
         mock.patch("firebase_admin.firestore.client") as mock_client:
        mock_db = mock.MagicMock()
        mock_client.return_value = mock_db

        repo = FirebaseRepository(settings)

        # 17:30 UTC on Sep 5 is 00:30 UTC+7 on Sep 6 in Vietnam
        payload_night = {
            "event_id": "evt-night",
            "user_id": "u1",
            "name": "Nguyen Van A",
            "camera_id": "cam-1",
            "occurred_at": "2026-09-05T17:30:00+00:00",
            "confidence": 0.95,
        }
        repo.write_event("attendance", payload_night)

        mock_doc = mock_db.collection("attendance").document("evt-night")
        mock_doc.set.assert_called_once()
        written_data = mock_doc.set.call_args[0][0]

        # doc["date"] must be 2026-09-06 (Vietnam local date), NOT 2026-09-05 (UTC date)
        assert written_data["date"] == "2026-09-06"

        # 16:30 UTC on Sep 5 is 23:30 UTC+7 on Sep 5 in Vietnam
        mock_doc.set.reset_mock()
        payload_evening = {
            "event_id": "evt-evening",
            "user_id": "u1",
            "name": "Nguyen Van A",
            "camera_id": "cam-1",
            "occurred_at": "2026-09-05T16:30:00+00:00",
            "confidence": 0.95,
        }
        repo.write_event("attendance", payload_evening)

        mock_doc2 = mock_db.collection("attendance").document("evt-evening")
        written_data2 = mock_doc2.set.call_args[0][0]
        assert written_data2["date"] == "2026-09-05"
