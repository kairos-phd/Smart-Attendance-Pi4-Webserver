from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


def _as_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class BackendSettings:
    firebase_service_account: Path | None
    firebase_storage_bucket: str | None
    model_name: str
    model_root: Path
    face_det_size: int
    match_threshold: float
    match_margin: float
    enrollment_consistency_threshold: float
    cors_origins: list[str]
    data_dir: Path
    save_enrollment_images: bool
    ai_enabled: bool
    device_api_key: str | None
    deployment_timezone: str
    attendance_cooldown_seconds: int
    unknown_cooldown_seconds: int
    user_refresh_seconds: int
    max_frame_bytes: int
    recognition_confirmations: int
    recognition_window_seconds: float
    unknown_confirmations: int
    unknown_image_retention_days: int

    @classmethod
    def from_env(cls) -> "BackendSettings":
        backend_root = Path(__file__).resolve().parents[1]
        load_dotenv(backend_root / ".env")
        service_account = os.getenv("FIREBASE_SERVICE_ACCOUNT")
        default_origins = (
            "http://localhost:5173,http://localhost:5174,http://localhost:8081,"
            "https://sicccc-30fed.firebaseapp.com,https://sicccc-30fed.web.app"
        )
        return cls(
            firebase_service_account=Path(service_account).expanduser().resolve() if service_account else None,
            firebase_storage_bucket=os.getenv("FIREBASE_STORAGE_BUCKET") or None,
            model_name=os.getenv("MODEL_NAME", "buffalo_sc"),
            model_root=Path(os.getenv("MODEL_ROOT", str(backend_root / "models"))).expanduser().resolve(),
            face_det_size=int(os.getenv("FACE_DET_SIZE", "320")),
            match_threshold=float(os.getenv("MATCH_THRESHOLD", "0.45")),
            match_margin=float(os.getenv("MATCH_MARGIN", "0.06")),
            enrollment_consistency_threshold=float(os.getenv("ENROLLMENT_CONSISTENCY_THRESHOLD", "0.60")),
            cors_origins=[value.strip() for value in os.getenv("CORS_ORIGINS", default_origins).split(",") if value.strip()],
            data_dir=Path(os.getenv("DATA_DIR", str(backend_root / "data"))).expanduser().resolve(),
            save_enrollment_images=_as_bool(os.getenv("SAVE_ENROLLMENT_IMAGES"), True),
            ai_enabled=_as_bool(os.getenv("AI_ENABLED"), True),
            device_api_key=os.getenv("DEVICE_API_KEY") or None,
            deployment_timezone=os.getenv("DEPLOYMENT_TIMEZONE", "Asia/Ho_Chi_Minh"),
            attendance_cooldown_seconds=int(os.getenv("ATTENDANCE_COOLDOWN_SECONDS", "300")),
            unknown_cooldown_seconds=int(os.getenv("UNKNOWN_COOLDOWN_SECONDS", "30")),
            user_refresh_seconds=int(os.getenv("USER_REFRESH_SECONDS", "60")),
            max_frame_bytes=int(os.getenv("MAX_FRAME_BYTES", str(4 * 1024 * 1024))),
            recognition_confirmations=int(os.getenv("RECOGNITION_CONFIRMATIONS", "3")),
            recognition_window_seconds=float(os.getenv("RECOGNITION_WINDOW_SECONDS", "12")),
            unknown_confirmations=int(os.getenv("UNKNOWN_CONFIRMATIONS", "2")),
            unknown_image_retention_days=int(os.getenv("UNKNOWN_IMAGE_RETENTION_DAYS", "30")),
        )
