from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass(frozen=True)
class RegisteredUser:
    user_id: str
    name: str
    embedding: list[float]
    student_id: str | None = None


@dataclass(frozen=True)
class Recognition:
    confidence: float
    bbox: tuple[int, int, int, int]
    user: RegisteredUser | None


@dataclass(frozen=True)
class Event:
    event_type: str
    camera_id: str
    occurred_at: datetime
    confidence: float
    user_id: str | None = None
    name: str | None = None
    image_path: str | None = None
    # The same ID is retained if a cloud write is retried after a timeout.
    event_id: str = field(default_factory=lambda: uuid4().hex)

    def payload(self) -> dict[str, Any]:
        result = asdict(self)
        result["occurred_at"] = self.occurred_at.isoformat()
        return result
