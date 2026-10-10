"""Standalone authenticated Pi media gateway; no attendance or AI startup."""
from __future__ import annotations

from contextlib import asynccontextmanager
import os
import ipaddress
from pathlib import Path, PurePosixPath
from urllib.parse import quote, urlsplit

from dotenv import load_dotenv
import firebase_admin
import requests
from firebase_admin import credentials
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from starlette.concurrency import run_in_threadpool

from .pi_proxy import PiProxy, router, signaling_database_url
from .gateway_accounts import router as accounts_router


MAX_PROXY_BODY_BYTES = 64 * 1024 * 1024


def create_app() -> FastAPI:
    env_file = os.getenv('GATEWAY_ENV_FILE', '').strip()
    if env_file:
        if not Path(env_file).is_file():
            raise RuntimeError('GATEWAY_ENV_FILE does not identify a readable environment file')
        load_dotenv(env_file, override=False)
    origins = [value.strip().rstrip('/') for value in os.getenv(
        'CORS_ORIGINS', 'https://sic4b.io.vn,https://sicccc-30fed.web.app,https://sicccc-30fed.firebaseapp.com'
    ).split(',') if value.strip()]
    for origin in origins:
        parsed = urlsplit(origin)
        if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
                or parsed.query or parsed.fragment or parsed.path):
            raise RuntimeError('CORS_ORIGINS must contain explicit HTTPS origins')

    attendance_base = os.getenv('ATTENDANCE_API_BASE_URL', 'http://127.0.0.1:8000').rstrip('/')
    parsed = urlsplit(attendance_base)
    try:
        loopback = parsed.hostname == 'localhost' or ipaddress.ip_address(parsed.hostname or '').is_loopback
        port = parsed.port
    except ValueError:
        loopback, port = False, None
    if (parsed.scheme != 'http' or not loopback or not port or parsed.username or parsed.password
            or parsed.path or parsed.query or parsed.fragment):
        raise RuntimeError('ATTENDANCE_API_BASE_URL must be a fixed HTTP loopback origin with a port')
    static_directory = os.getenv('WEB_STATIC_DIR', '').strip()
    static_root = Path(static_directory).resolve() if static_directory else None
    if static_root is not None and not static_root.is_dir():
        raise RuntimeError('WEB_STATIC_DIR must identify the built website directory')

    @asynccontextmanager
    async def lifespan(app):
        project = os.getenv('FIREBASE_PROJECT_ID', '').strip()
        account = os.getenv('FIREBASE_SERVICE_ACCOUNT', '').strip()
        if not project or not account:
            raise RuntimeError('Configure FIREBASE_PROJECT_ID and FIREBASE_SERVICE_ACCOUNT for website authentication')
        try:
            database_url = signaling_database_url()
            PiProxy.from_env()
        except HTTPException as exc:
            raise RuntimeError(exc.detail) from exc
        certificate = credentials.Certificate(account)
        if certificate.project_id != project:
            raise RuntimeError('Firebase service-account project does not match FIREBASE_PROJECT_ID')
        firebase_app = firebase_admin.initialize_app(certificate, {'projectId': project, 'databaseURL': database_url})
        app.state.firebase_initialized = True
        try:
            yield
        finally:
            app.state.firebase_initialized = False
            firebase_admin.delete_app(firebase_app)

    app = FastAPI(title='SIC Pi Media Gateway', lifespan=lifespan)
    app.state.firebase_initialized = False
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=['GET', 'POST', 'PATCH', 'DELETE'],
                       allow_headers=['Authorization', 'Content-Type'])
    app.include_router(router)
    app.include_router(accounts_router)

    @app.get('/health')
    def health():
        initialized = app.state.firebase_initialized
        return JSONResponse(status_code=200 if initialized else 503, content={
            'status': 'ok' if initialized else 'not_initialized',
            'service': 'sic-pi-media-gateway',
            'firebase': 'initialized' if initialized else 'not_initialized',
        })

    @app.api_route('/attendance-api/{path:path}', methods=['GET', 'POST', 'PATCH', 'DELETE'])
    async def attendance_proxy(path: str, request: Request):
        # Never derive an origin or outbound headers from the browser's Host/Origin.
        if '..' in PurePosixPath(path.replace('\\', '/')).parts:
            raise HTTPException(400, 'Invalid attendance API path')
        maximum = MAX_PROXY_BODY_BYTES
        declared = request.headers.get('content-length')
        if declared:
            try:
                if int(declared) > maximum:
                    raise HTTPException(413, 'Attendance upload exceeds 64 MB')
            except ValueError as exc:
                raise HTTPException(400, 'Invalid Content-Length') from exc
        chunks = []
        length = 0
        async for chunk in request.stream():
            length += len(chunk)
            if length > maximum:
                raise HTTPException(413, 'Attendance upload exceeds 64 MB')
            chunks.append(chunk)
        headers = {name: request.headers[name] for name in ('Authorization', 'Content-Type', 'X-Device-Key')
                   if name in request.headers}
        target = attendance_base + '/' + quote(path, safe='/')
        if request.url.query:
            target += '?' + request.url.query
        try:
            upstream = await run_in_threadpool(requests.request, request.method, target, headers=headers,
                                               data=b''.join(chunks), timeout=(3, 20), allow_redirects=False)
        except requests.RequestException as exc:
            raise HTTPException(503, 'Attendance API is unavailable') from exc
        content_type = upstream.headers.get('Content-Type')
        return Response(upstream.content, status_code=upstream.status_code,
                        headers={'Content-Type': content_type} if content_type else {})

    if static_root is not None:
        @app.get('/{path:path}')
        def website(path: str):
            normalized = path.replace('\\', '/')
            if (normalized.startswith('/') or '..' in PurePosixPath(normalized).parts
                    or normalized.split('/')[0] in {'api', 'health', 'attendance-api'}):
                raise HTTPException(404, 'Not Found')
            candidate = (static_root / normalized).resolve()
            if not candidate.is_relative_to(static_root):
                raise HTTPException(404, 'Not Found')
            if candidate.is_file():
                return FileResponse(candidate)
            if candidate.suffix:
                raise HTTPException(404, 'Not Found')
            index = (static_root / 'index.html').resolve()
            if not index.is_relative_to(static_root) or not index.is_file():
                raise HTTPException(404, 'Website build is unavailable')
            return FileResponse(index)

    return app


app = create_app()
