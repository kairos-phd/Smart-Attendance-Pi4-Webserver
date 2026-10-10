import os
import subprocess
import sys
import unittest
from tempfile import NamedTemporaryFile
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient


ENV = {
    'FIREBASE_SERVICE_ACCOUNT': '/private/website.json',
    'FIREBASE_PROJECT_ID': 'sicccc-30fed',
    'FIREBASE_DATABASE_URL': 'https://sicccc-30fed-default-rtdb.asia-southeast1.firebasedatabase.app',
    'PI_API_BASE_URL': 'http://127.0.0.1:5000',
    'PI_CONTROL_MODE': 'legacy-loopback',
}


class LegacyProxyTests(unittest.TestCase):
    def test_legacy_mode_uses_loopback_control_without_browser_headers(self):
        from app.pi_proxy import PiProxy
        with patch.dict(os.environ, ENV, clear=True):
            proxy = PiProxy.from_env()
        with patch('app.pi_proxy.requests.request') as outbound:
            outbound.return_value.status_code = 200
            outbound.return_value.json.return_value = {'recognition_enabled': True}
            proxy.request('GET', proxy.control_path, 'Bearer website-user')
            self.assertEqual(outbound.call_args.args[1], 'http://127.0.0.1:5000/api/control')
            self.assertEqual(outbound.call_args.kwargs['headers'], {})

    def test_legacy_mode_rejects_remote_dns_tls_and_missing_port(self):
        from app.pi_proxy import PiProxy
        for url in ['http://192.168.1.2:5000', 'https://127.0.0.1:5000', 'http://localhost:5000', 'http://127.0.0.1', 'http://127.0.0.1:0']:
            with self.subTest(url=url), patch.dict(os.environ, {**ENV, 'PI_API_BASE_URL': url}, clear=True):
                with self.assertRaises(HTTPException):
                    PiProxy.from_env()

    def test_legacy_browser_origin_and_host_are_not_forwarded(self):
        from fastapi import FastAPI
        from app.pi_proxy import router
        app = FastAPI()
        app.include_router(router)
        with patch.dict(os.environ, ENV, clear=True), patch('app.auth.auth.verify_id_token', return_value={'uid': 'admin', 'admin': True}), patch('app.pi_proxy.requests.request') as outbound:
            outbound.return_value.status_code = 200
            outbound.return_value.json.side_effect = [{'status': 'ok'}, {'recognition_enabled': True}]
            response = TestClient(app).get('/api/pi/status', headers={'Authorization': 'Bearer website-admin', 'Origin': 'https://sic4b.io.vn', 'Host': 'media.sic4b.io.vn'})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(outbound.call_args.args[1], 'http://127.0.0.1:5000/api/control')
            self.assertEqual(outbound.call_args.kwargs['headers'], {})

    def test_remote_mode_cannot_request_local_control(self):
        from app.pi_proxy import PiProxy
        with patch.dict(os.environ, {'PI_API_BASE_URL': 'https://pi.example'}, clear=True):
            proxy = PiProxy.from_env()
        with self.assertRaises(HTTPException):
            proxy.request('GET', '/api/control', 'Bearer user')


class GatewayTests(unittest.TestCase):
    def test_import_does_not_load_attendance_or_ai(self):
        result = subprocess.run([sys.executable, '-c', "import sys; import app.pi_gateway; assert not any(name in sys.modules for name in ('app.main', 'app.face_engine', 'cv2', 'numpy', 'insightface', 'onnxruntime'))"], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_health_reports_initialized_media_service_and_admin_is_required(self):
        from app.pi_gateway import create_app
        with patch.dict(os.environ, ENV, clear=True), patch('app.pi_gateway.credentials.Certificate') as certificate, patch('app.pi_gateway.firebase_admin.initialize_app') as initialize, patch('app.pi_gateway.firebase_admin.delete_app'), patch('app.pi_proxy.requests.request') as outbound:
            certificate.return_value.project_id = 'sicccc-30fed'
            with TestClient(create_app()) as client:
                response = client.get('/health')
                self.assertEqual(response.json(), {'status': 'ok', 'service': 'sic-pi-media-gateway', 'firebase': 'initialized'})
                self.assertEqual(client.get('/api/pi/status').status_code, 401)
                with patch('app.auth.auth.verify_id_token', return_value={'uid': 'viewer', 'admin': False}):
                    self.assertEqual(client.get('/api/pi/status', headers={'Authorization': 'Bearer viewer'}).status_code, 403)
                outbound.assert_not_called()
                self.assertEqual(initialize.call_args.args[1]['projectId'], 'sicccc-30fed')

    def test_gateway_rejects_mismatched_credentials_and_missing_database_before_init(self):
        from app.pi_gateway import create_app
        for overrides, credential_project in [({}, 'other-project'), ({'FIREBASE_DATABASE_URL': ''}, 'sicccc-30fed'), ({'FIREBASE_DATABASE_URL': 'https://attacker.example'}, 'sicccc-30fed')]:
            with self.subTest(overrides=overrides, credential_project=credential_project), patch.dict(os.environ, {**ENV, **overrides}, clear=True), patch('app.pi_gateway.credentials.Certificate') as certificate, patch('app.pi_gateway.firebase_admin.initialize_app') as initialize:
                certificate.return_value.project_id = credential_project
                with self.assertRaises(RuntimeError):
                    with TestClient(create_app()):
                        pass
                initialize.assert_not_called()

    def test_explicit_env_file_preserves_operator_environment(self):
        from app.pi_gateway import create_app
        with NamedTemporaryFile(mode='w', suffix='.env') as handle:
            handle.write('CORS_ORIGINS=https://from-file.example\nPI_ID=from-file\n')
            handle.flush()
            with patch.dict(os.environ, {'GATEWAY_ENV_FILE': handle.name, 'PI_ID': 'operator-value'}, clear=True):
                create_app()
                self.assertEqual(os.environ['CORS_ORIGINS'], 'https://from-file.example')
                self.assertEqual(os.environ['PI_ID'], 'operator-value')
        with patch.dict(os.environ, {'GATEWAY_ENV_FILE': '/missing/sic-media.env'}, clear=True):
            with self.assertRaises(RuntimeError):
                create_app()

    def test_health_without_lifespan_does_not_claim_initialization(self):
        from app.pi_gateway import create_app
        with patch.dict(os.environ, ENV, clear=True):
            response = TestClient(create_app()).get('/health')
            self.assertEqual(response.status_code, 503)
            self.assertEqual(response.json()['firebase'], 'not_initialized')

    def test_gateway_cors_only_allows_configured_https_origins(self):
        from app.pi_gateway import create_app
        with patch.dict(os.environ, {**ENV, 'CORS_ORIGINS': 'http://unsafe.example'}, clear=True):
            with self.assertRaises(RuntimeError):
                create_app()
        with patch.dict(os.environ, ENV, clear=True):
            client = TestClient(create_app())
            good = client.options('/api/pi/status', headers={'Origin': 'https://sic4b.io.vn', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization'})
            bad = client.options('/api/pi/status', headers={'Origin': 'https://attacker.example', 'Access-Control-Request-Method': 'GET'})
            self.assertEqual(good.status_code, 200)
            self.assertEqual(bad.status_code, 400)

class PcHostingTests(unittest.TestCase):
    def test_static_files_spa_and_reserved_api_paths(self):
        from tempfile import TemporaryDirectory
        from pathlib import Path
        from app.pi_gateway import create_app
        with TemporaryDirectory() as directory, TemporaryDirectory() as outside:
            root = Path(directory)
            (root / 'index.html').write_text('<html>SIC SPA</html>')
            (root / 'asset.js').write_text('const sic = true;')
            secret = Path(outside) / 'secret.txt'
            secret.write_text('private-secret')
            (root / 'escape.txt').symlink_to(secret)
            with patch.dict(os.environ, {**ENV, 'WEB_STATIC_DIR': directory}, clear=True):
                client = TestClient(create_app())
                self.assertEqual(client.get('/asset.js').text, 'const sic = true;')
                self.assertIn('SIC SPA', client.get('/recog').text)
                for path in ['/api/absent', '/api', '/escape.txt', '/%2e%2e/secret.txt']:
                    response = client.get(path)
                    self.assertEqual(response.status_code, 404, path)
                    self.assertNotIn('text/html', response.headers.get('content-type', ''))
                self.assertEqual(client.post('/recog').status_code, 405)

    def test_attendance_proxy_preserves_status_body_and_only_allowed_headers(self):
        from app.pi_gateway import create_app
        with patch.dict(os.environ, ENV, clear=True), patch('app.pi_gateway.requests.request') as outbound:
            outbound.return_value.status_code = 401
            outbound.return_value.content = b'{"detail":"token rejected"}'
            outbound.return_value.headers = {'Content-Type': 'application/json'}
            response = TestClient(create_app()).post('/attendance-api/api/users?limit=7', content=b'payload', headers={
                'Authorization': 'Bearer verified', 'Content-Type': 'application/octet-stream', 'X-Device-Key': 'device-key',
                'Host': 'sic4b.io.vn', 'Origin': 'https://sic4b.io.vn', 'Cookie': 'unwanted',
            })
            self.assertEqual(response.status_code, 401)
            self.assertEqual(response.json()['detail'], 'token rejected')
            self.assertEqual(outbound.call_args.args, ('POST', 'http://127.0.0.1:8000/api/users?limit=7'))
            self.assertEqual(outbound.call_args.kwargs['data'], b'payload')
            self.assertEqual(outbound.call_args.kwargs['headers'], {'Authorization': 'Bearer verified', 'Content-Type': 'application/octet-stream', 'X-Device-Key': 'device-key'})
            self.assertFalse(outbound.call_args.kwargs['allow_redirects'])

    def test_attendance_proxy_missing_backend_is_503_and_not_html(self):
        import requests
        from app.pi_gateway import create_app
        with patch.dict(os.environ, ENV, clear=True), patch('app.pi_gateway.requests.request', side_effect=requests.ConnectionError('private details')):
            response = TestClient(create_app()).get('/attendance-api/health')
            self.assertEqual(response.status_code, 503)
            self.assertNotIn('private details', response.text)

    def test_attendance_proxy_rejects_non_loopback_origins_and_oversized_body(self):
        from app.pi_gateway import create_app
        for origin in ['https://127.0.0.1:8000', 'http://192.168.1.2:8000', 'http://user:pass@127.0.0.1:8000', 'http://127.0.0.1:8000/prefix']:
            with patch.dict(os.environ, {**ENV, 'ATTENDANCE_API_BASE_URL': origin}, clear=True), self.assertRaises(RuntimeError):
                create_app()
        with patch.dict(os.environ, ENV, clear=True), patch('app.pi_gateway.requests.request') as outbound:
            client = TestClient(create_app())
            response = client.post('/attendance-api/api/users', content=b'x', headers={'Content-Length': str(64 * 1024 * 1024 + 1)})
            self.assertEqual(response.status_code, 413)
            outbound.assert_not_called()


    def test_attendance_proxy_limits_chunked_body_without_content_length(self):
        from app.pi_gateway import create_app
        with patch.dict(os.environ, ENV, clear=True), patch('app.pi_gateway.MAX_PROXY_BODY_BYTES', 8), patch('app.pi_gateway.requests.request') as outbound:
            response = TestClient(create_app()).post('/attendance-api/api/users', content=iter([b'12345', b'67890']))
            self.assertEqual(response.status_code, 413)
            outbound.assert_not_called()


class PersistedPiAttendanceTests(unittest.TestCase):
    def test_pi_attendance_uses_saved_rows_shared_token_and_bounds(self):
        from fastapi import FastAPI
        from app.pi_proxy import router
        app = FastAPI()
        app.include_router(router)
        row = {'attendance_id': 7, 'session_id': 'session-1', 'user_id': 'student-1', 'name': 'Student', 'student_id': 'S001', 'occurred_at': '2026-10-10T10:00:00Z', 'camera_ids': ['icspring'], 'similarity': .95, 'sync_state': 'pending'}
        with patch.dict(os.environ, {**ENV, 'PI_API_TOKEN': 'pi-shared-key'}, clear=True), patch('app.auth.auth.verify_id_token', return_value={'uid': 'admin', 'admin': True}), patch('app.pi_proxy.requests.request') as outbound:
            outbound.return_value.status_code = 200
            outbound.return_value.json.return_value = [row]
            client = TestClient(app)
            response = client.get('/api/pi/attendance?limit=100', headers={'Authorization': 'Bearer website-admin'})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), [row])
            self.assertEqual(outbound.call_args.args[1], 'http://127.0.0.1:5000/api/attendance')
            self.assertEqual(outbound.call_args.kwargs['headers'], {'Authorization': 'Bearer pi-shared-key'})
            self.assertEqual(outbound.call_args.kwargs['params'], {'limit': 100})
            self.assertEqual(client.get('/api/pi/attendance?limit=501', headers={'Authorization': 'Bearer website-admin'}).status_code, 422)
            self.assertEqual(client.get('/api/pi/attendance').status_code, 401)


if __name__ == '__main__':
    unittest.main()
