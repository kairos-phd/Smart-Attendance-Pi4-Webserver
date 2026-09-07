from __future__ import annotations

import os
from pathlib import Path
from unittest import mock

import numpy as np

from attendance_edge.config import CameraConfig, Settings
from attendance_edge.main import AttendanceService
from attendance_edge.remote_ingest import RemoteIngestClient


def test_remote_ingest_client_health() -> None:
    client = RemoteIngestClient("http://127.0.0.1:8000", device_api_key="test-key")
    with mock.patch.object(client.session, "get") as mock_get:
        mock_get.return_value.status_code = 200
        mock_get.return_value.json.return_value = {"status": "ok", "version": "0.5.0"}

        res = client.check_health()
        assert res is not None
        assert res["status"] == "ok"
        assert res["version"] == "0.5.0"


def test_remote_ingest_client_heartbeat() -> None:
    client = RemoteIngestClient("http://127.0.0.1:8000", device_api_key="test-key")
    with mock.patch.object(client.session, "post") as mock_post:
        mock_post.return_value.status_code = 204

        cams = [{"camera_id": "camera-1", "name": "Camera 1", "status": "online"}]
        ok = client.send_heartbeat("pi-01", cams)
        assert ok is True
        mock_post.assert_called_once()
        call_kwargs = mock_post.call_args[1]
        assert call_kwargs["json"]["device_id"] == "pi-01"


def test_remote_ingest_client_send_frame() -> None:
    client = RemoteIngestClient("http://127.0.0.1:8000", device_api_key="test-key")
    dummy_frame = np.zeros((480, 640, 3), dtype=np.uint8)

    with mock.patch.object(client.session, "post") as mock_post:
        mock_post.return_value.status_code = 200
        mock_post.return_value.json.return_value = {
            "frame_id": "f123",
            "camera_id": "camera-1",
            "faces_detected": 1,
            "results": [
                {
                    "result": "recognized",
                    "user_id": "u1",
                    "name": "Student A",
                    "confidence": 0.88,
                }
            ],
        }

        res = client.ingest_frame("camera-1", "Camera 1", "pi-01", dummy_frame)
        assert res is not None
        assert res["frame_id"] == "f123"
        assert len(res["results"]) == 1


def test_attendance_service_remote_ingest_dispatch(tmp_path: Path) -> None:
    env = {
        "BACKEND_API_URL": "http://127.0.0.1:8000",
        "DEVICE_API_KEY": "test-key",
        "DATA_DIR": str(tmp_path / "data"),
    }
    with mock.patch("attendance_edge.config.load_dotenv"):
        with mock.patch.dict(os.environ, env, clear=True):
            settings = Settings.from_env()

    service = AttendanceService(settings)
    assert service.remote_client is not None
    assert service.repo is None

    cam = CameraConfig("camera-1", "Camera 1", 0)
    dummy_frame = np.zeros((480, 640, 3), dtype=np.uint8)

    with mock.patch.object(service.remote_client, "ingest_frame") as mock_ingest:
        mock_ingest.return_value = {
            "frame_id": "test-frame",
            "camera_id": "camera-1",
            "faces_detected": 1,
            "results": [{"result": "recognized", "name": "Nguyen Van A", "confidence": 0.92}],
        }

        service.handle_activity(cam, dummy_frame)
        mock_ingest.assert_called_once()
        args, kwargs = mock_ingest.call_args
        assert kwargs["camera_id"] == "camera-1"
        assert kwargs["raspberry_pi_id"] == "pi-classroom-01"

    service.store.close()
