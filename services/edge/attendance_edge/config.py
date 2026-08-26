from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


def _as_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _as_source(value: str) -> int | str:
    return int(value) if value.isdigit() else value


@dataclass(frozen=True)
class CameraConfig:
    camera_id: str
    name: str
    source: int | str


@dataclass(frozen=True)
class Settings:
    firebase_service_account: Path
    firebase_storage_bucket: str | None
    pi_id: str
    cameras: tuple[CameraConfig, CameraConfig]
    frame_width: int
    frame_height: int
    monitor_fps: float
    motion_min_area: int
    camera_cooldown_seconds: int
    attendance_cooldown_seconds: int
    match_threshold: float
    face_det_size: int
    model_name: str
    model_root: Path
    user_refresh_seconds: int
    queue_retry_seconds: int
    save_unknown_images: bool
    data_dir: Path
    log_level: str

    @classmethod
    def from_env(cls) -> "Settings":
        load_dotenv()
        required = os.getenv("FIREBASE_SERVICE_ACCOUNT")
        if not required:
            raise RuntimeError("FIREBASE_SERVICE_ACCOUNT is required; copy .env.example to .env first.")
        data_dir = Path(os.getenv("DATA_DIR", "./data")).resolve()
        return cls(
            firebase_service_account=Path(required).expanduser(),
            firebase_storage_bucket=os.getenv("FIREBASE_STORAGE_BUCKET") or None,
            pi_id=os.getenv("PI_ID", "pi-classroom-01"),
            cameras=(
                CameraConfig(os.getenv("CAMERA_1_ID", "camera-1"), os.getenv("CAMERA_1_NAME", "Camera 1"), _as_source(os.getenv("CAMERA_1_SOURCE", "0"))),
                CameraConfig(os.getenv("CAMERA_2_ID", "camera-2"), os.getenv("CAMERA_2_NAME", "Camera 2"), _as_source(os.getenv("CAMERA_2_SOURCE", "1"))),
            ),
            frame_width=int(os.getenv("FRAME_WIDTH", "640")),
            frame_height=int(os.getenv("FRAME_HEIGHT", "480")),
            monitor_fps=float(os.getenv("MONITOR_FPS", "4")),
            motion_min_area=int(os.getenv("MOTION_MIN_AREA", "1800")),
            camera_cooldown_seconds=int(os.getenv("CAMERA_COOLDOWN_SECONDS", "4")),
            attendance_cooldown_seconds=int(os.getenv("ATTENDANCE_COOLDOWN_SECONDS", "300")),
            match_threshold=float(os.getenv("MATCH_THRESHOLD", "0.45")),
            face_det_size=int(os.getenv("FACE_DET_SIZE", "320")),
            model_name=os.getenv("MODEL_NAME", "buffalo_sc"),
            model_root=Path(os.getenv("MODEL_ROOT", "./models")).resolve(),
            user_refresh_seconds=int(os.getenv("USER_REFRESH_SECONDS", "120")),
            queue_retry_seconds=int(os.getenv("QUEUE_RETRY_SECONDS", "15")),
            save_unknown_images=_as_bool(os.getenv("SAVE_UNKNOWN_IMAGES"), True),
            data_dir=data_dir,
            log_level=os.getenv("LOG_LEVEL", "INFO").upper(),
        )
