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
    firebase_service_account: Path | None
    firebase_storage_bucket: str | None
    pi_id: str
    cameras: tuple[CameraConfig, ...]
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
    backend_api_url: str | None = None
    device_api_key: str | None = None

    @classmethod
    def from_env(cls) -> "Settings":
        edge_root = Path(__file__).resolve().parents[1]
        load_dotenv(edge_root / ".env")
        load_dotenv(edge_root.parent / "backend" / ".env")
        load_dotenv()
        required = os.getenv("FIREBASE_SERVICE_ACCOUNT")
        backend_url = os.getenv("BACKEND_API_URL")
        if not required and not backend_url:
            raise RuntimeError("Either FIREBASE_SERVICE_ACCOUNT or BACKEND_API_URL is required; copy .env.example to .env first.")
        data_dir = Path(os.getenv("DATA_DIR", "./data")).resolve()

        max_cameras = int(os.getenv("CAMERAS_COUNT", "3"))
        configured_cameras: list[CameraConfig] = []
        for index in range(1, max(max_cameras + 1, 4)):
            cam_id = os.getenv(f"CAMERA_{index}_ID", f"camera-{index}")
            cam_name = os.getenv(f"CAMERA_{index}_NAME", f"Camera {index}")
            source_env = os.getenv(f"CAMERA_{index}_SOURCE")
            enabled_env = os.getenv(f"CAMERA_{index}_ENABLED")

            if source_env is None:
                if index <= max_cameras:
                    source_val: int | str = index - 1
                else:
                    continue
            else:
                source_clean = source_env.strip()
                if not source_clean or source_clean.lower() in {"none", "disabled", "false"}:
                    continue
                source_val = _as_source(source_clean)

            if index > max_cameras:
                continue

            if enabled_env is not None and not _as_bool(enabled_env, default=True):
                continue

            configured_cameras.append(CameraConfig(cam_id, cam_name, source_val))

        if not configured_cameras:
            configured_cameras.append(CameraConfig("camera-1", "Camera 1", 0))

        return cls(
            firebase_service_account=Path(required).expanduser() if required else None,
            firebase_storage_bucket=os.getenv("FIREBASE_STORAGE_BUCKET") or None,
            pi_id=os.getenv("PI_ID", "pi-classroom-01"),
            cameras=tuple(configured_cameras),
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
            backend_api_url=backend_url.rstrip("/") if backend_url else None,
            device_api_key=os.getenv("DEVICE_API_KEY"),
        )
