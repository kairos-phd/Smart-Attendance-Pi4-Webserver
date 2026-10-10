"""Admin-only, fixed-target Pi API bridge. Credentials never reach the browser."""
from __future__ import annotations

import ipaddress
import os
import re
import time
from uuid import uuid4
from typing import Literal
from dataclasses import dataclass
from urllib.parse import urlsplit

import requests
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Path
from firebase_admin import db as realtime_db
from pydantic import BaseModel, ConfigDict, StrictBool, Field, model_validator

from .auth import require_admin


class ControlUpdate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    recognition_enabled: StrictBool | None = None
    camera_id: str | None = Field(default=None, min_length=1, max_length=80)

    @model_validator(mode='after')
    def require_update(self):
        if self.recognition_enabled is None and self.camera_id is None:
            raise ValueError('Specify recognition_enabled or camera_id')
        return self


@dataclass
class PiProxy:
    base: str
    token: str | None
    pi_id: str
    camera_ids: list[str]

    @classmethod
    def from_env(cls):
        base = os.getenv('PI_API_BASE_URL', '').rstrip('/')
        parsed = urlsplit(base)
        if not base:
            raise HTTPException(503, 'PI_API_BASE_URL is not configured on the backend')
        try:
            private = ipaddress.ip_address(parsed.hostname or '').is_private
        except ValueError:
            private = parsed.hostname in {'localhost'}
        if (parsed.scheme not in {'http', 'https'} or not parsed.hostname or parsed.username or parsed.password
                or parsed.query or parsed.fragment or parsed.path not in {'', '/'}
                or (parsed.scheme == 'http' and not private)):
            raise HTTPException(503, 'Invalid PI_API_BASE_URL: use an HTTPS origin or private-network HTTP origin')
        return cls(base, os.getenv('PI_API_TOKEN') or None, os.getenv('PI_ID', 'pi-classroom-01'),
                   [value.strip() for value in os.getenv('PI_CAMERA_IDS', 'icspring,jieli,sonix').split(',') if value.strip()])

    def request(self, method, path, authorization, **kwargs):
        if path not in {'/health', '/api/control/remote', '/api/recognition-events'}:
            raise HTTPException(400, 'Unsupported Pi route')
        headers = {'Authorization': f'Bearer {self.token}' if self.token else authorization or ''}
        try:
            response = requests.request(method, self.base + path, headers=headers, timeout=(3, 8),
                                        allow_redirects=False, **kwargs)
            if response.status_code != 200:
                raise HTTPException(502, f'Pi API returned HTTP {response.status_code}')
            return response.json()
        except (requests.RequestException, ValueError) as exc:
            raise HTTPException(502, 'Pi API unavailable or returned an invalid response') from exc


router = APIRouter(prefix='/api/pi', dependencies=[Depends(require_admin)])


@router.get('/status')
def pi_status(authorization: str | None = Header(default=None)):
    proxy = PiProxy.from_env()
    return {'pi_id': proxy.pi_id, 'camera_ids': proxy.camera_ids,
            'health': proxy.request('GET', '/health', authorization),
            'control': proxy.request('GET', '/api/control/remote', authorization)}


@router.patch('/control')
def pi_control(update: ControlUpdate, authorization: str | None = Header(default=None)):
    proxy = PiProxy.from_env()
    if update.camera_id is not None and update.camera_id not in proxy.camera_ids:
        raise HTTPException(422, 'camera_id is not in PI_CAMERA_IDS')
    return proxy.request('PATCH', '/api/control/remote', authorization, json=update.model_dump(exclude_none=True))


@router.get('/recognition-events')
def pi_events(limit: int = Query(default=100, ge=1, le=1000), authorization: str | None = Header(default=None)):
    return PiProxy.from_env().request('GET', '/api/recognition-events', authorization, params={'limit': limit})


class SessionOffer(BaseModel):
    model_config = ConfigDict(extra='forbid')
    type: Literal['offer']
    sdp: str = Field(min_length=1, max_length=100000)


class SessionCreate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    camera_id: str = Field(min_length=1, max_length=80)
    offer: SessionOffer


def _session_reference(uid: str, session_id: str):
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', uid):
        raise HTTPException(400, 'Firebase UID is not a supported session identifier')
    url = os.getenv('FIREBASE_DATABASE_URL', '').rstrip('/')
    parsed = urlsplit(url)
    if (parsed.scheme != 'https' or not parsed.hostname
            or not parsed.hostname.endswith(('.firebasedatabase.app', '.firebaseio.com'))
            or parsed.username or parsed.password or parsed.query or parsed.fragment
            or parsed.path not in {'', '/'} or parsed.netloc != parsed.hostname):
        raise HTTPException(503, 'Configure FIREBASE_DATABASE_URL as the matching Firebase RTDB HTTPS origin')
    return realtime_db.reference(f'webrtc/{uid}/{session_id}', url=url)


@router.post('/webrtc-sessions')
def create_webrtc_session(body: SessionCreate, admin: dict = Depends(require_admin)):
    proxy = PiProxy.from_env()
    if body.camera_id not in proxy.camera_ids:
        raise HTTPException(422, 'camera_id is not in PI_CAMERA_IDS')
    session_id = uuid4().hex
    try:
        reference = _session_reference(admin.get('uid', ''), session_id)
        reference.set({'offer': body.offer.model_dump(), 'camera_id': body.camera_id,
                       'pi_id': proxy.pi_id, 'created_at': int(time.time() * 1000), 'state': 'offer'})
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(502, 'Firebase signaling is unavailable; check backend RTDB credentials') from exc
    return {'session_id': session_id}


@router.delete('/webrtc-sessions/{session_id}')
def delete_webrtc_session(session_id: str = Path(pattern=r'^[0-9a-f]{32}$'), admin: dict = Depends(require_admin)):
    try:
        _session_reference(admin.get('uid', ''), session_id).delete()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(502, 'Firebase signaling cleanup is unavailable') from exc
    return {'deleted': True}
