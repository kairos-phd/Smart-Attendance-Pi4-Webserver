from __future__ import annotations

import asyncio
import logging
import secrets
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4
from zoneinfo import ZoneInfo

import cv2
import firebase_admin
import numpy as np
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Response, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from firebase_admin import auth as firebase_auth, credentials, firestore, storage

from .auth import require_admin
from .dataset import LocalDataset
from .face_engine import FaceEngine, RegisteredUser
from .schemas import AdminAccountUpdate, AdminAccountView, DeviceHeartbeat, FrameIngestResponse, RecognitionView, UnknownReview, UserUpdate, UserView
from .settings import BackendSettings
from .unknown_store import UnknownImageStore

LOG = logging.getLogger(__name__)
VERSION = "0.5.0"


class _HideHealthChecks(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        arguments = record.args
        return not (isinstance(arguments, tuple) and len(arguments) > 2 and arguments[2] == "/health")


logging.getLogger("uvicorn.access").addFilter(_HideHealthChecks())


class AppState:
    settings: BackendSettings
    db: Any | None = None
    bucket: Any | None = None
    engine: FaceEngine | None = None
    dataset: LocalDataset | None = None
    unknown_store: UnknownImageStore | None = None
    firebase_state = "not_configured"
    ai_state = "not_configured"
    startup_errors: list[str]
    users_cache: list[RegisteredUser]
    users_cache_at = 0.0
    attendance_cooldowns: dict[str, float]
    unknown_cooldowns: dict[str, float]
    recognition_history: dict[tuple[str, str], list[float]]
    unknown_history: dict[str, list[float]]
    recovered_local_profiles: int
    device_heartbeats: dict[str, float]

    def __init__(self) -> None:
        self.startup_errors = []
        self.users_cache = []
        self.attendance_cooldowns = {}
        self.unknown_cooldowns = {}
        self.recognition_history = {}
        self.unknown_history = {}
        self.recovered_local_profiles = 0
        self.device_heartbeats = {}


state = AppState()


def _recover_local_face_profiles() -> int:
    """Create local embedding backups for cloud profiles missing from this laptop."""
    if state.db is None or state.dataset is None:
        return 0
    recovered = 0
    for document in state.db.collection("users").stream():
        data = document.to_dict() or {}
        embedding = data.get("face_embedding")
        if not isinstance(embedding, list) or not embedding:
            continue
        try:
            if state.dataset.recover_profile(document.id, embedding, {
                "name": data.get("name", "Unnamed"),
                "student_id": data.get("student_id"),
                "source": "firestore_profile_recovery",
            }):
                recovered += 1
        except Exception:
            LOG.exception("Could not recover local dataset profile %s", document.id)
    return recovered


@asynccontextmanager
async def lifespan(_: FastAPI):
    state.settings = BackendSettings.from_env()
    state.dataset = LocalDataset(state.settings.data_dir, state.settings.save_enrollment_images)
    state.unknown_store = UnknownImageStore(state.settings.data_dir, state.settings.unknown_image_retention_days)
    removed_unknown_images = state.unknown_store.cleanup()
    if removed_unknown_images:
        LOG.info("Removed %d expired unknown-person images", removed_unknown_images)

    service_account = state.settings.firebase_service_account
    if service_account is None:
        state.startup_errors.append("FIREBASE_SERVICE_ACCOUNT is not configured")
    elif not service_account.exists():
        state.firebase_state = "error"
        LOG.error("Firebase service-account file was not found: %s", service_account)
        state.startup_errors.append("Firebase service-account file was not found")
    else:
        try:
            options = {"storageBucket": state.settings.firebase_storage_bucket} if state.settings.firebase_storage_bucket else None
            if not firebase_admin._apps:
                firebase_admin.initialize_app(credentials.Certificate(str(service_account)), options)
            state.db = firestore.client()
            state.bucket = storage.bucket() if state.settings.firebase_storage_bucket else None
            state.firebase_state = "ready"
            state.recovered_local_profiles = _recover_local_face_profiles()
            if state.recovered_local_profiles:
                LOG.info("Recovered %d Firestore face profile(s) into the local dataset", state.recovered_local_profiles)
        except Exception:
            LOG.exception("Firebase initialization failed")
            state.firebase_state = "error"
            state.startup_errors.append("Firebase initialization failed; check the server log")

    if not state.settings.ai_enabled:
        state.ai_state = "disabled"
    elif state.db is None:
        state.startup_errors.append("AI startup is waiting for Firebase configuration")
    else:
        try:
            state.engine = FaceEngine(
                state.settings.model_name,
                state.settings.model_root,
                state.settings.face_det_size,
                state.settings.match_threshold,
                state.settings.match_margin,
            )
            state.engine.start()
            state.ai_state = "ready"
        except ModuleNotFoundError as exc:
            if exc.name != "insightface":
                LOG.exception("AI dependency initialization failed")
            else:
                LOG.warning("InsightFace is not installed; API started with AI features disabled")
            state.engine = None
            state.ai_state = "error"
            state.startup_errors.append("InsightFace is not installed")
        except Exception:
            LOG.exception("AI model initialization failed")
            state.engine = None
            state.ai_state = "error"
            state.startup_errors.append("AI model initialization failed; check the server log")
    yield


settings_for_cors = BackendSettings.from_env()
app = FastAPI(title="SIC Smart Attendance Laptop API", version=VERSION, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings_for_cors.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type", "X-Device-Key"],
)


@app.get("/")
def root() -> dict[str, str]:
    return {
        "service": "SIC Smart Attendance Laptop API",
        "status": "online",
        "health": "/health",
        "documentation": "/docs",
    }


@app.get("/health")
@app.get("/api/health")
def health() -> dict[str, Any]:
    ready = state.db is not None and state.engine is not None
    return {
        "status": "ok" if ready else "degraded",
        "service": "online",
        "firebase": state.firebase_state,
        "ai": state.ai_state,
        "storage": "ready" if state.bucket is not None else "disabled",
        "local_profiles_recovered": state.recovered_local_profiles,
        "version": VERSION,
        "errors": state.startup_errors,
    }


def _require_database() -> Any:
    if state.db is None:
        raise HTTPException(status_code=503, detail="Firebase is not configured on the laptop API")
    return state.db


def _require_ai() -> FaceEngine:
    if state.engine is None:
        raise HTTPException(status_code=503, detail="The laptop face-recognition engine is not ready")
    return state.engine


def _require_device(x_device_key: str | None = Header(default=None)) -> None:
    expected = state.settings.device_api_key
    if not expected:
        raise HTTPException(status_code=503, detail="DEVICE_API_KEY is not configured on the laptop API")
    if not x_device_key or not secrets.compare_digest(x_device_key, expected):
        raise HTTPException(status_code=401, detail="A valid device API key is required")


def _decode_image(raw: bytes, label: str) -> np.ndarray:
    if len(raw) > state.settings.max_frame_bytes:
        raise HTTPException(status_code=413, detail=f"{label} exceeds the configured size limit")
    image = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(status_code=400, detail=f"{label} could not be decoded")
    return image


def _user_view(document: Any) -> UserView:
    data = document.to_dict()
    registered = data.get("registration_date")
    if hasattr(registered, "isoformat"):
        registered = registered.isoformat()
    return UserView(
        id=document.id,
        name=data.get("name", "Unnamed"),
        student_id=data.get("student_id"),
        status=data.get("status", "active"),
        registration_date=registered,
        registration_image_path=data.get("registration_image_path"),
        enrollment_samples=int(data.get("enrollment_samples", 1)),
    )


def _invalidate_users_cache() -> None:
    state.users_cache = []
    if state.engine is not None:
        state.engine.clear_centroid_cache()


def _active_users() -> list[RegisteredUser]:
    now = time.monotonic()
    if state.users_cache and now - state.users_cache_at < state.settings.user_refresh_seconds:
        return state.users_cache
    db = _require_database()
    users: list[RegisteredUser] = []
    for document in db.collection("users").where("status", "==", "active").stream():
        data = document.to_dict()
        embedding = data.get("face_embedding")
        if isinstance(embedding, list) and embedding:
            users.append(RegisteredUser(
                document.id,
                data.get("name", "Unnamed"),
                [embedding],
                data.get("student_id"),
                centroid=embedding,
            ))
    state.users_cache = users
    state.users_cache_at = now
    return users


def _captured_at(value: str | None) -> datetime:
    if not value or not isinstance(value, str):
        return datetime.now(timezone.utc)
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="captured_at must be an ISO-8601 timestamp") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _write_heartbeat(device: DeviceHeartbeat) -> None:
    db = _require_database()
    device_payload = {
        "device_id": device.device_id,
        "name": device.name,
        "device_type": device.device_type,
        "status": device.status,
        "last_seen": firestore.SERVER_TIMESTAMP,
        "last_error": device.last_error,
    }
    if device.software_version:
        device_payload["software_version"] = device.software_version
    db.collection("devices").document(device.device_id).set(device_payload, merge=True)
    for camera in device.cameras:
        camera_payload = {
            "camera_id": camera.camera_id,
            "name": camera.name,
            "raspberry_pi_id": device.device_id,
            "status": camera.status,
            "last_seen": firestore.SERVER_TIMESTAMP,
            "last_error": camera.last_error,
        }
        if camera.location:
            camera_payload["location"] = camera.location
        db.collection("cameras").document(camera.camera_id).set(camera_payload, merge=True)


def _firebase_millis(value: int | None) -> str | None:
    if value is None:
        return None
    return datetime.fromtimestamp(value / 1000, timezone.utc).isoformat()


@app.get("/api/admin/accounts", response_model=list[AdminAccountView])
def admin_accounts(_: dict = Depends(require_admin)) -> list[AdminAccountView]:
    db = _require_database()
    account_documents = {document.id: document.to_dict() for document in db.collection("accounts").stream()}
    results: list[AdminAccountView] = []
    for user in firebase_auth.list_users().iterate_all():
        account = account_documents.get(user.uid, {})
        claims = user.custom_claims or {}
        results.append(AdminAccountView(
            uid=user.uid,
            email=user.email,
            username=account.get("username"),
            display_name=user.display_name,
            role="admin" if claims.get("admin") is True else "viewer",
            email_verified=user.email_verified,
            disabled=user.disabled,
            created_at=_firebase_millis(user.user_metadata.creation_timestamp),
            last_sign_in_at=_firebase_millis(user.user_metadata.last_sign_in_timestamp),
        ))
    return sorted(results, key=lambda item: (item.email or item.username or item.uid).lower())


@app.patch("/api/admin/accounts/{user_id}", response_model=AdminAccountView)
def update_admin_account(user_id: str, update: AdminAccountUpdate, admin: dict = Depends(require_admin)) -> AdminAccountView:
    if user_id == admin.get("uid"):
        raise HTTPException(status_code=400, detail="Administrators cannot change their own role or disabled state")
    if update.role is None and update.disabled is None:
        raise HTTPException(status_code=400, detail="No account changes were supplied")
    try:
        user = firebase_auth.get_user(user_id)
    except firebase_auth.UserNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Dashboard account not found") from exc

    if update.role is not None:
        claims = dict(user.custom_claims or {})
        if update.role == "admin":
            claims["admin"] = True
        else:
            claims.pop("admin", None)
        firebase_auth.set_custom_user_claims(user_id, claims or None)
    if update.disabled is not None:
        firebase_auth.update_user(user_id, disabled=update.disabled)
    firebase_auth.revoke_refresh_tokens(user_id)

    refreshed = firebase_auth.get_user(user_id)
    account_document = _require_database().collection("accounts").document(user_id).get()
    account = account_document.to_dict() if account_document.exists else {}
    return AdminAccountView(
        uid=refreshed.uid,
        email=refreshed.email,
        username=account.get("username"),
        display_name=refreshed.display_name,
        role="admin" if (refreshed.custom_claims or {}).get("admin") is True else "viewer",
        email_verified=refreshed.email_verified,
        disabled=refreshed.disabled,
        created_at=_firebase_millis(refreshed.user_metadata.creation_timestamp),
        last_sign_in_at=_firebase_millis(refreshed.user_metadata.last_sign_in_timestamp),
    )


@app.get("/api/users", response_model=list[UserView])
def list_users(_: dict = Depends(require_admin)) -> list[UserView]:
    db = _require_database()
    return [_user_view(document) for document in db.collection("users").order_by("name").stream()]


@app.post("/api/users", response_model=UserView, status_code=status.HTTP_201_CREATED)
async def create_user(
    name: str = Form(..., min_length=1, max_length=120),
    student_id: str = Form(..., min_length=1, max_length=80),
    face_images: list[UploadFile] = File(default=[]),
    face_image: UploadFile | None = File(default=None),
    _: dict = Depends(require_admin),
) -> UserView:
    db = _require_database()
    engine = _require_ai()
    uploads = list(face_images)
    if face_image is not None:
        uploads.append(face_image)
    if not 3 <= len(uploads) <= 8:
        raise HTTPException(status_code=400, detail="Enrollment requires 3 to 8 clear photos of the same person")

    images: list[np.ndarray] = []
    raw_images: list[bytes] = []
    embeddings: list[list[float]] = []
    sample_quality: list[dict[str, float]] = []
    for index, upload in enumerate(uploads, start=1):
        if upload.content_type not in {"image/jpeg", "image/png", "image/webp"}:
            raise HTTPException(status_code=400, detail=f"Enrollment photo {index} must be JPEG, PNG, or WebP")
        raw = await upload.read()
        image = await asyncio.to_thread(_decode_image, raw, f"Enrollment photo {index}")
        try:
            sample = await asyncio.to_thread(engine.enrollment_sample, image)
        except ValueError as exc:
            safe_filename = Path(upload.filename or "").name
            label = f"Photo {index}" + (f" ({safe_filename})" if safe_filename else "")
            raise HTTPException(status_code=400, detail=f"{label}: {exc}") from exc
        # Store a private, padded crop of the selected foreground face rather
        # than the full photograph and unrelated people in its background.
        images.append(sample.face_crop)
        raw_images.append(raw)
        embeddings.append(sample.embedding)
        sample_quality.append({
            "detection_score": round(sample.detection_score, 4),
            "blur_score": round(sample.blur_score, 2),
            "brightness": round(sample.brightness, 2),
            "face_ratio": round(sample.face_ratio, 4),
            "detected_faces": sample.detected_faces,
            "ignored_background_faces": sample.ignored_background_faces,
        })

    profile_embedding = await asyncio.to_thread(engine.profile_embedding, embeddings)
    sample_matrix = np.asarray(embeddings, dtype=np.float32)
    consistency = sample_matrix @ np.asarray(profile_embedding, dtype=np.float32)
    if float(np.min(consistency)) < state.settings.enrollment_consistency_threshold:
        raise HTTPException(status_code=400, detail="Enrollment photos are inconsistent; make sure every photo shows the same person")

    clean_name = name.strip()
    clean_student_id = student_id.strip()
    existing = await asyncio.to_thread(
        lambda: list(db.collection("users").where("student_id", "==", clean_student_id).limit(1).stream())
    )
    if existing:
        raise HTTPException(status_code=409, detail="A user with this student ID already exists")

    user_id = uuid4().hex
    assert state.dataset is not None
    try:
        await asyncio.to_thread(state.dataset.save, user_id, images, embeddings, {
            "name": clean_name,
            "student_id": clean_student_id,
            "sample_count": len(images),
            "sample_quality": sample_quality,
            "minimum_consistency": round(float(np.min(consistency)), 4),
        })
    except FileExistsError as exc:
        raise HTTPException(status_code=409, detail="The generated dataset entry already exists") from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not save the local face dataset: {exc}") from exc

    image_path = None
    try:
        if state.bucket:
            image_path = f"registration/{user_id}/{uuid4().hex}.jpg"
            def _upload_blob() -> None:
                blob = state.bucket.blob(image_path)
                blob.upload_from_string(raw_images[0], content_type=uploads[0].content_type)
            await asyncio.to_thread(_upload_blob)
        payload = {
            "name": clean_name,
            "student_id": clean_student_id,
            "face_embedding": profile_embedding,
            "enrollment_samples": len(images),
            "profile_consistency": round(float(np.min(consistency)), 4),
            "registration_date": firestore.SERVER_TIMESTAMP,
            "registration_image_path": image_path,
            "status": "active",
        }
        reference = db.collection("users").document(user_id)
        await asyncio.to_thread(reference.set, payload)
    except Exception:
        await asyncio.to_thread(state.dataset.remove, user_id)
        raise
    _invalidate_users_cache()
    doc = await asyncio.to_thread(reference.get)
    return _user_view(doc)


@app.patch("/api/users/{user_id}", response_model=UserView)
def update_user(user_id: str, update: UserUpdate, _: dict = Depends(require_admin)) -> UserView:
    db = _require_database()
    reference = db.collection("users").document(user_id)
    if not reference.get().exists:
        raise HTTPException(status_code=404, detail="User not found")
    changes = {key: value.strip() if isinstance(value, str) else value for key, value in update.model_dump(exclude_none=True).items()}
    if not changes:
        raise HTTPException(status_code=400, detail="No changes supplied")
    if "student_id" in changes:
        duplicates = [doc for doc in db.collection("users").where("student_id", "==", changes["student_id"]).limit(2).stream() if doc.id != user_id]
        if duplicates:
            raise HTTPException(status_code=409, detail="A user with this student ID already exists")
    reference.update(changes)
    _invalidate_users_cache()
    return _user_view(reference.get())


@app.delete("/api/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_user(user_id: str, _: dict = Depends(require_admin)) -> None:
    db = _require_database()
    reference = db.collection("users").document(user_id)
    if not reference.get().exists:
        raise HTTPException(status_code=404, detail="User not found")
    reference.update({"status": "inactive", "deactivated_at": firestore.SERVER_TIMESTAMP})
    _invalidate_users_cache()


@app.post("/api/devices/heartbeat", status_code=status.HTTP_204_NO_CONTENT)
async def device_heartbeat(device: DeviceHeartbeat, _: None = Depends(_require_device)) -> None:
    state.device_heartbeats[device.device_id] = time.monotonic()
    await asyncio.to_thread(_write_heartbeat, device)


@app.get("/api/unknown-events/{event_id}/image")
def unknown_event_image(event_id: str, _: dict = Depends(require_admin)) -> FileResponse:
    if state.unknown_store is None:
        raise HTTPException(status_code=503, detail="Unknown-image storage is not ready")
    try:
        path = state.unknown_store.path(event_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if path is None:
        raise HTTPException(status_code=404, detail="The unknown-person image is unavailable or has expired")
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "private, no-store"})


@app.patch("/api/unknown-events/{event_id}/review", status_code=status.HTTP_204_NO_CONTENT)
def review_unknown_event(event_id: str, review: UnknownReview, admin: dict = Depends(require_admin)) -> Response:
    db = _require_database()
    reference = db.collection("unknown_events").document(event_id)
    if not reference.get().exists:
        raise HTTPException(status_code=404, detail="Unknown-person event not found")
    reference.update({
        "review_status": review.decision,
        "review_note": review.note.strip() if review.note else None,
        "reviewed_by": admin.get("uid"),
        "reviewed_at": firestore.SERVER_TIMESTAMP,
    })
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.delete("/api/unknown-events/{event_id}/image", status_code=status.HTTP_204_NO_CONTENT)
def delete_unknown_event_image(event_id: str, _: dict = Depends(require_admin)) -> Response:
    db = _require_database()
    reference = db.collection("unknown_events").document(event_id)
    if not reference.get().exists:
        raise HTTPException(status_code=404, detail="Unknown-person event not found")
    if state.unknown_store is None:
        raise HTTPException(status_code=503, detail="Unknown-image storage is not ready")
    try:
        state.unknown_store.delete(event_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    reference.update({"image_url": None, "image_deleted_at": firestore.SERVER_TIMESTAMP})
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _update_confirmation_history(
    camera_id: str,
    recognized_user_ids: set[str],
    unknown_present: bool,
    now: float,
) -> tuple[dict[str, int], int]:
    cutoff = now - state.settings.recognition_window_seconds
    for key in list(state.recognition_history):
        history_camera, user_id = key
        if history_camera != camera_id:
            continue
        history = [seen for seen in state.recognition_history[key] if seen >= cutoff]
        if user_id in recognized_user_ids:
            history.append(now)
            state.recognition_history[key] = history[-state.settings.recognition_confirmations:]
        elif history:
            state.recognition_history[key] = history
        else:
            del state.recognition_history[key]

    counts: dict[str, int] = {}
    for user_id in recognized_user_ids:
        key = (camera_id, user_id)
        if key not in state.recognition_history:
            state.recognition_history[key] = [now]
        counts[user_id] = len(state.recognition_history[key])

    history = [seen for seen in state.unknown_history.get(camera_id, []) if seen >= cutoff]
    if unknown_present:
        history.append(now)
        state.unknown_history[camera_id] = history[-state.settings.unknown_confirmations:]
    elif history:
        state.unknown_history[camera_id] = history
    else:
        state.unknown_history.pop(camera_id, None)
    return counts, len(state.unknown_history.get(camera_id, []))


@app.post("/api/ingest/frame", response_model=FrameIngestResponse)
async def ingest_frame(
    frame: UploadFile = File(...),
    camera_id: str = Form(..., pattern=r"^[A-Za-z0-9_-]{1,64}$"),
    raspberry_pi_id: str = Form(..., pattern=r"^[A-Za-z0-9_-]{1,64}$"),
    device_type: str = Form(default="raspberry_pi", pattern="^(raspberry_pi|laptop_ai)$"),
    camera_name: str = Form(default="Camera", min_length=1, max_length=120),
    captured_at: str | None = Form(default=None),
    _: None = Depends(_require_device),
) -> FrameIngestResponse:
    db = _require_database()
    engine = _require_ai()
    if frame.content_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(status_code=400, detail="Frame must be JPEG, PNG, or WebP")
    raw = await frame.read()
    image = await asyncio.to_thread(_decode_image, raw, "Frame")
    occurred_at = _captured_at(captured_at)
    frame_id = uuid4().hex
    now_mono = time.monotonic()

    clean_device_type = device_type if isinstance(device_type, str) else "raspberry_pi"
    clean_camera_name = camera_name if isinstance(camera_name, str) else "Camera"

    # COST-01: Throttle heartbeat updates to at most once every 60 seconds per device
    if now_mono - state.device_heartbeats.get(raspberry_pi_id, 0.0) >= 60.0:
        state.device_heartbeats[raspberry_pi_id] = now_mono
        heartbeat = DeviceHeartbeat(
            device_id=raspberry_pi_id,
            name=raspberry_pi_id,
            device_type=clean_device_type,
            cameras=[{"camera_id": camera_id, "name": clean_camera_name, "status": "online"}],
        )
        await asyncio.to_thread(_write_heartbeat, heartbeat)

    active_users = await asyncio.to_thread(_active_users)
    recognitions = await asyncio.to_thread(engine.recognize, image, active_users)
    results: list[RecognitionView] = []
    local_date = occurred_at.astimezone(ZoneInfo(state.settings.deployment_timezone)).date().isoformat()
    unknown_written = False
    matched_user_ids = {item.user.user_id for item in recognitions if item.user is not None}
    unknown_present = any(item.user is None for item in recognitions)
    confirmation_counts, unknown_confirmation_count = _update_confirmation_history(
        camera_id, matched_user_ids, unknown_present, now_mono
    )

    for recognition in recognitions:
        if recognition.user is not None:
            user = recognition.user
            confirmation_count = confirmation_counts.get(user.user_id, 0)
            confirmed = confirmation_count >= state.settings.recognition_confirmations
            last = state.attendance_cooldowns.get(user.user_id, 0.0)
            accepted = confirmed and now_mono - last >= state.settings.attendance_cooldown_seconds
            event_id = None
            if accepted:
                event_id = uuid4().hex
                attendance_payload = {
                    "attendance_id": event_id,
                    "user_id": user.user_id,
                    "name": user.name,
                    "camera_id": camera_id,
                    "timestamp": occurred_at,
                    "date": local_date,
                    "confidence": recognition.confidence,
                    "status": "recognized",
                    "raspberry_pi_id": raspberry_pi_id,
                    "created_at": firestore.SERVER_TIMESTAMP,
                }
                await asyncio.to_thread(
                    db.collection("attendance").document(event_id).set, attendance_payload
                )
                state.attendance_cooldowns[user.user_id] = now_mono
            results.append(RecognitionView(
                result="recognized",
                confidence=recognition.confidence,
                user_id=user.user_id,
                name=user.name,
                event_id=event_id,
                attendance_created=accepted,
                confirmation_count=confirmation_count,
                confirmations_required=state.settings.recognition_confirmations,
                second_best_confidence=recognition.second_best_confidence,
            ))
        else:
            event_id = None
            last_unknown = state.unknown_cooldowns.get(camera_id, 0.0)
            unknown_confirmed = unknown_confirmation_count >= state.settings.unknown_confirmations
            if not unknown_written and unknown_confirmed and now_mono - last_unknown >= state.settings.unknown_cooldown_seconds:
                event_id = uuid4().hex
                image_reference = None
                if state.unknown_store is not None:
                    try:
                        await asyncio.to_thread(
                            state.unknown_store.save, event_id, image, recognition.bbox
                        )
                        image_reference = f"local://unknown/{event_id}.jpg"
                    except Exception:
                        LOG.exception("Could not save local image for unknown event %s", event_id)
                try:
                    unknown_payload = {
                        "event_id": event_id,
                        "camera_id": camera_id,
                        "timestamp": occurred_at,
                        # Diagnostic nearest-profile score; it never assigns an identity by itself.
                        "confidence": recognition.confidence,
                        "second_best_confidence": recognition.second_best_confidence,
                        "recognition_status": "unknown",
                        "review_status": "pending",
                        "image_url": image_reference,
                        "raspberry_pi_id": raspberry_pi_id,
                        "created_at": firestore.SERVER_TIMESTAMP,
                    }
                    await asyncio.to_thread(
                        db.collection("unknown_events").document(event_id).set, unknown_payload
                    )
                except Exception:
                    if image_reference and state.unknown_store is not None:
                        await asyncio.to_thread(state.unknown_store.delete, event_id)
                    raise
                state.unknown_cooldowns[camera_id] = now_mono
                state.unknown_history.pop(camera_id, None)
                unknown_written = True
            results.append(RecognitionView(
                result="unknown",
                confidence=recognition.confidence,
                event_id=event_id,
                confirmation_count=unknown_confirmation_count,
                confirmations_required=state.settings.unknown_confirmations,
                second_best_confidence=recognition.second_best_confidence,
            ))

    return FrameIngestResponse(frame_id=frame_id, camera_id=camera_id, faces_detected=len(recognitions), results=results)
