from __future__ import annotations

from pydantic import BaseModel, Field


class UserUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    student_id: str | None = Field(default=None, min_length=1, max_length=80)
    status: str | None = Field(default=None, pattern="^(active|inactive)$")


class UserView(BaseModel):
    id: str
    name: str
    student_id: str | None = None
    status: str
    registration_date: str | None = None
    registration_image_path: str | None = None
    enrollment_samples: int = 1


class CameraHeartbeat(BaseModel):
    camera_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")
    name: str = Field(min_length=1, max_length=120)
    location: str | None = Field(default=None, max_length=160)
    status: str = Field(default="online", pattern="^(online|offline)$")
    last_error: str | None = Field(default=None, max_length=500)


class DeviceHeartbeat(BaseModel):
    device_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")
    name: str = Field(min_length=1, max_length=120)
    device_type: str = Field(default="raspberry_pi", pattern="^(raspberry_pi|laptop_ai)$")
    status: str = Field(default="online", pattern="^(online|offline)$")
    software_version: str | None = Field(default=None, max_length=80)
    last_error: str | None = Field(default=None, max_length=500)
    cameras: list[CameraHeartbeat] = Field(default_factory=list, max_length=8)


class RecognitionView(BaseModel):
    result: str
    confidence: float
    user_id: str | None = None
    name: str | None = None
    event_id: str | None = None
    attendance_created: bool = False
    confirmation_count: int = 0
    confirmations_required: int = 1
    second_best_confidence: float | None = None


class FrameIngestResponse(BaseModel):
    frame_id: str
    camera_id: str
    faces_detected: int
    results: list[RecognitionView]


class UnknownReview(BaseModel):
    decision: str = Field(pattern="^(reviewed|dismissed)$")
    note: str | None = Field(default=None, max_length=500)


class AdminAccountView(BaseModel):
    uid: str
    email: str | None = None
    username: str | None = None
    display_name: str | None = None
    role: str
    email_verified: bool
    disabled: bool
    created_at: str | None = None
    last_sign_in_at: str | None = None


class AdminAccountUpdate(BaseModel):
    role: str | None = Field(default=None, pattern="^(admin|viewer)$")
    disabled: bool | None = None
