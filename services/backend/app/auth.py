from __future__ import annotations

import logging

from fastapi import Header, HTTPException, status
from firebase_admin import auth

LOG = logging.getLogger(__name__)


def require_admin(authorization: str | None = Header(default=None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="A Firebase ID token is required")
    token = authorization.removeprefix("Bearer ")
    try:
        decoded = auth.verify_id_token(token, check_revoked=True)
    except auth.ExpiredIdTokenError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="The Firebase ID token has expired") from exc
    except auth.RevokedIdTokenError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="This account session has been revoked") from exc
    except auth.InvalidIdTokenError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="The Firebase ID token is invalid") from exc
    except auth.CertificateFetchError as exc:
        LOG.warning("Could not fetch Firebase token-verification certificates: %s", exc)
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Firebase token verification is temporarily unavailable") from exc
    except Exception as exc:
        LOG.exception("Unexpected Firebase token-verification failure")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Firebase token verification failed") from exc
    if decoded.get("admin") is not True:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Administrator access is required")
    return decoded
