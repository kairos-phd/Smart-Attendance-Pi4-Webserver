from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

import cv2
import numpy as np
import requests

LOG = logging.getLogger(__name__)


class RemoteIngestClient:
    def __init__(self, base_url: str, device_api_key: str | None = None, timeout: float = 8.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.device_api_key = device_api_key
        self.timeout = timeout
        self.session = requests.Session()
        if device_api_key:
            self.session.headers.update({"X-Device-Key": device_api_key})

    def check_health(self) -> dict[str, Any] | None:
        try:
            res = self.session.get(f"{self.base_url}/health", timeout=self.timeout)
            if res.status_code == 200:
                return res.json()
            LOG.warning("Backend health check returned HTTP %d", res.status_code)
            return None
        except Exception:
            LOG.warning("Could not reach backend health endpoint at %s", self.base_url)
            return None

    def send_heartbeat(
        self,
        device_id: str,
        cameras: list[dict[str, Any]],
        device_name: str = "Raspberry Pi 4",
        status: str = "online",
    ) -> bool:
        try:
            payload = {
                "device_id": device_id,
                "name": device_name,
                "device_type": "raspberry_pi",
                "status": status,
                "software_version": "0.5.0",
                "cameras": cameras,
            }
            res = self.session.post(
                f"{self.base_url}/api/devices/heartbeat",
                json=payload,
                timeout=self.timeout,
            )
            return res.status_code in (200, 204)
        except Exception:
            LOG.debug("Failed to send heartbeat to %s", self.base_url)
            return False

    def ingest_frame(
        self,
        camera_id: str,
        camera_name: str,
        raspberry_pi_id: str,
        frame: np.ndarray,
        jpeg_quality: int = 85,
    ) -> dict[str, Any] | None:
        ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, jpeg_quality])
        if not ok:
            LOG.error("Failed to encode frame to JPEG for %s", camera_id)
            return None

        captured_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        files = {"frame": ("frame.jpg", buf.tobytes(), "image/jpeg")}
        data = {
            "camera_id": camera_id,
            "camera_name": camera_name,
            "raspberry_pi_id": raspberry_pi_id,
            "device_type": "raspberry_pi",
            "captured_at": captured_at,
        }

        try:
            res = self.session.post(
                f"{self.base_url}/api/ingest/frame",
                files=files,
                data=data,
                timeout=self.timeout,
            )
            if res.status_code == 200:
                return res.json()
            LOG.warning("Remote ingest returned status %d: %s", res.status_code, res.text[:200])
            return None
        except Exception:
            LOG.warning("Failed to stream frame to backend %s", self.base_url)
            return None
