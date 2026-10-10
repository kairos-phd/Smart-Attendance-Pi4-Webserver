"""Firebase dashboard account administration without loading the AI backend."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Path
from firebase_admin import auth as firebase_auth, firestore
from pydantic import BaseModel, ConfigDict, StrictBool

from .auth import require_admin
from .schemas import AdminAccountView


router = APIRouter(prefix="/api/pi/admin/accounts")


class GatewayAccountUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Literal["admin", "viewer"] | None = None
    disabled: StrictBool | None = None


AccountUid = Annotated[str, Path(min_length=1, max_length=128, pattern=r"^[^/\\\x00-\x1f\x7f]+$")]


def _millis(value: int | None) -> str | None:
    return datetime.fromtimestamp(value / 1000, timezone.utc).isoformat() if value is not None else None


def _account_view(user, account: dict | None) -> AdminAccountView:
    return AdminAccountView(
        uid=user.uid, email=user.email, username=(account or {}).get("username"),
        display_name=user.display_name,
        role="admin" if (user.custom_claims or {}).get("admin") is True else "viewer",
        email_verified=user.email_verified, disabled=user.disabled,
        created_at=_millis(user.user_metadata.creation_timestamp),
        last_sign_in_at=_millis(user.user_metadata.last_sign_in_timestamp),
    )


@router.get("", response_model=list[AdminAccountView])
def list_accounts(_: dict = Depends(require_admin)) -> list[AdminAccountView]:
    try:
        documents = {document.id: document.to_dict() for document in firestore.client().collection("accounts").stream()}
        accounts = [_account_view(user, documents.get(user.uid)) for user in firebase_auth.list_users().iterate_all()]
        return sorted(accounts, key=lambda account: (account.email or account.username or account.uid).lower())
    except Exception as exc:
        raise HTTPException(503, "Firebase account administration is temporarily unavailable") from exc


@router.patch("/{uid}", response_model=AdminAccountView)
def update_account(uid: AccountUid, update: GatewayAccountUpdate, admin: dict = Depends(require_admin)) -> AdminAccountView:
    if uid in {".", ".."}:
        raise HTTPException(422, "Invalid account UID")
    if uid == admin.get("uid"):
        raise HTTPException(400, "Administrators cannot change their own role or disabled state")
    if update.role is None and update.disabled is None:
        raise HTTPException(400, "No account changes were supplied")
    try:
        user = firebase_auth.get_user(uid)
        # Resolve Firestore before mutations so unavailable account metadata does
        # not prevent revocation after a successful Firebase Auth update.
        document = firestore.client().collection("accounts").document(uid).get()
        account = document.to_dict() if document.exists else {}
        try:
            if update.role is not None:
                claims = dict(user.custom_claims or {})
                if update.role == "admin":
                    claims["admin"] = True
                else:
                    claims.pop("admin", None)
                firebase_auth.set_custom_user_claims(uid, claims or None)
            if update.disabled is not None:
                firebase_auth.update_user(uid, disabled=update.disabled)
        finally:
            # Invalidate sessions even when only part of a combined update succeeds.
            firebase_auth.revoke_refresh_tokens(uid)
        return _account_view(firebase_auth.get_user(uid), account)
    except firebase_auth.UserNotFoundError as exc:
        raise HTTPException(404, "Dashboard account not found") from exc
    except Exception as exc:
        raise HTTPException(503, "Firebase account administration is temporarily unavailable") from exc
