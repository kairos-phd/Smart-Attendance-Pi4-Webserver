import os
import unittest
from unittest.mock import patch

from fastapi import HTTPException

class PiProxyTests(unittest.TestCase):
    def test_missing_config_is_actionable(self):
        from app.pi_proxy import PiProxy
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(HTTPException) as error:
                PiProxy.from_env()
            self.assertEqual(error.exception.status_code, 503)
            self.assertIn('PI_API_BASE_URL', error.exception.detail)

    def test_rejects_unsafe_config(self):
        from app.pi_proxy import PiProxy
        for url in ['file:///etc/passwd', 'http://public.example', 'https://user:secret@pi.example', 'https://pi.example/?url=x', 'https://pi.example/#x']:
            with self.subTest(url=url), patch.dict(os.environ, {'PI_API_BASE_URL': url}):
                with self.assertRaises(HTTPException):
                    PiProxy.from_env()

    def test_proxy_fixed_path_token_and_no_redirect(self):
        from app.pi_proxy import PiProxy
        with patch.dict(os.environ, {'PI_API_BASE_URL': 'https://pi.example', 'PI_API_TOKEN': 'server-secret', 'PI_CAMERA_IDS': 'cam0,cam1'}):
            proxy = PiProxy.from_env()
        with patch('app.pi_proxy.requests.request') as request:
            request.return_value.status_code = 200
            request.return_value.json.return_value = {'recognition_enabled': True}
            result = proxy.request('GET', '/api/control/remote', 'Bearer firebase-user')
            self.assertTrue(result['recognition_enabled'])
            self.assertEqual(request.call_args.args, ('GET', 'https://pi.example/api/control/remote'))
            self.assertEqual(request.call_args.kwargs['headers']['Authorization'], 'Bearer server-secret')
            self.assertFalse(request.call_args.kwargs['allow_redirects'])

    def test_control_validates_camera_and_strict_boolean(self):
        from app.pi_proxy import ControlUpdate
        from pydantic import ValidationError
        for value in [{'recognition_enabled': 'false'}, {}, {'camera_id': ''}, {'url': 'https://elsewhere'}]:
            with self.subTest(value=value), self.assertRaises(ValidationError):
                ControlUpdate(**value)


class PiRouteTests(unittest.TestCase):
    def setUp(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from app.pi_proxy import router
        app = FastAPI()
        app.include_router(router)
        self.client = TestClient(app)

    def test_unauthenticated_and_viewer_denied_without_contacting_pi(self):
        with patch('app.pi_proxy.requests.request') as outbound:
            self.assertEqual(self.client.get('/api/pi/status').status_code, 401)
            with patch('app.auth.auth.verify_id_token', return_value={'uid': 'viewer', 'admin': False}):
                self.assertEqual(self.client.get('/api/pi/status', headers={'Authorization': 'Bearer viewer'}).status_code, 403)
            outbound.assert_not_called()

    def test_admin_camera_allowlist_and_limit_validation(self):
        with patch('app.auth.auth.verify_id_token', return_value={'uid': 'admin', 'admin': True}), patch.dict(os.environ, {'PI_API_BASE_URL': 'https://pi.example', 'PI_CAMERA_IDS': 'icspring,jieli,sonix'}), patch('app.pi_proxy.requests.request') as outbound:
            headers = {'Authorization': 'Bearer verified-user'}
            self.assertEqual(self.client.patch('/api/pi/control', json={'camera_id': 'unlisted'}, headers=headers).status_code, 422)
            self.assertEqual(self.client.get('/api/pi/recognition-events?limit=0', headers=headers).status_code, 422)
            outbound.assert_not_called()

    def test_verified_admin_token_forwarded_without_shared_key(self):
        from app.pi_proxy import PiProxy
        with patch.dict(os.environ, {'PI_API_BASE_URL': 'http://192.168.1.10:5000'}, clear=True):
            proxy = PiProxy.from_env()
        with patch('app.pi_proxy.requests.request') as outbound:
            outbound.return_value.status_code = 200
            outbound.return_value.json.return_value = []
            self.assertEqual(proxy.request('GET', '/api/recognition-events', 'Bearer verified-user'), [])
            self.assertEqual(outbound.call_args.kwargs['headers'], {'Authorization': 'Bearer verified-user'})

    def test_upstream_errors_sanitized(self):
        from app.pi_proxy import PiProxy
        import requests
        proxy = PiProxy('https://pi.example', 'secret', 'pi', ['cam'])
        for failure in [requests.Timeout('sensitive URL secret'), ValueError('sensitive response')]:
            with patch('app.pi_proxy.requests.request', side_effect=failure), self.assertRaises(HTTPException) as error:
                proxy.request('GET', '/health', None)
            self.assertEqual(error.exception.status_code, 502)
            self.assertNotIn('secret', error.exception.detail)

    def test_status_and_control_contract(self):
        with patch('app.auth.auth.verify_id_token', return_value={'uid': 'admin', 'admin': True}), patch.dict(os.environ, {'PI_API_BASE_URL': 'https://pi.example', 'PI_CAMERA_IDS': 'icspring,jieli,sonix', 'PI_ID': 'pi-classroom-01'}), patch('app.pi_proxy.requests.request') as outbound:
            headers = {'Authorization': 'Bearer verified-user'}
            outbound.return_value.status_code = 200
            outbound.return_value.json.side_effect = [{'status': 'ok'}, {'recognition_enabled': True, 'selected_camera_id': 'icspring'}, {'recognition_enabled': False, 'selected_camera_id': 'jieli'}]
            status = self.client.get('/api/pi/status', headers=headers)
            self.assertEqual(status.status_code, 200)
            self.assertEqual(status.json()['camera_ids'], ['icspring', 'jieli', 'sonix'])
            self.assertEqual(status.json()['control']['selected_camera_id'], 'icspring')
            changed = self.client.patch('/api/pi/control', json={'recognition_enabled': False, 'camera_id': 'jieli'}, headers=headers)
            self.assertEqual(changed.status_code, 200)
            self.assertFalse(changed.json()['recognition_enabled'])
            self.assertEqual(outbound.call_args.kwargs['json'], {'recognition_enabled': False, 'camera_id': 'jieli'})


class PiSignalingTests(unittest.TestCase):
    setUp = PiRouteTests.setUp
    def test_session_creation_uses_verified_uid_config_and_server_time(self):
        with patch('app.auth.auth.verify_id_token', return_value={'uid': 'owner-1', 'admin': True}), patch.dict(os.environ, {'PI_API_BASE_URL': 'https://pi.example', 'PI_ID': 'pi-classroom-01', 'PI_CAMERA_IDS': 'icspring', 'FIREBASE_DATABASE_URL': 'https://project-default-rtdb.asia-southeast1.firebasedatabase.app'}), patch('app.pi_proxy.realtime_db.reference') as reference:
            response = self.client.post('/api/pi/webrtc-sessions', headers={'Authorization': 'Bearer verified'}, json={'camera_id': 'icspring', 'offer': {'type': 'offer', 'sdp': 'v=0'}})
            self.assertEqual(response.status_code, 200)
            session_id = response.json()['session_id']
            self.assertRegex(session_id, r'^[0-9a-f]{32}$')
            self.assertEqual(reference.call_args.args[0], f'webrtc/owner-1/{session_id}')
            record = reference.return_value.set.call_args.args[0]
            self.assertEqual(record['pi_id'], 'pi-classroom-01')
            self.assertEqual(record['state'], 'offer')
            self.assertIsInstance(record['created_at'], int)

    def test_session_rejects_identity_injection_and_unlisted_camera(self):
        with patch('app.auth.auth.verify_id_token', return_value={'uid': 'owner-1', 'admin': True}), patch.dict(os.environ, {'PI_API_BASE_URL': 'https://pi.example', 'PI_CAMERA_IDS': 'icspring'}), patch('app.pi_proxy.realtime_db.reference') as reference:
            for body in [{'camera_id': 'other', 'offer': {'type': 'offer', 'sdp': 'x'}}, {'camera_id': 'icspring', 'uid': 'victim', 'offer': {'type': 'offer', 'sdp': 'x'}}, {'camera_id': 'icspring', 'offer': {'type': 'answer', 'sdp': 'x'}}, {'camera_id': 'icspring', 'offer': {'type': 'offer', 'sdp': 'x' * 100001}}]:
                with self.subTest(body=str(body)[:80]):
                    self.assertEqual(self.client.post('/api/pi/webrtc-sessions', headers={'Authorization': 'Bearer verified'}, json=body).status_code, 422)
            reference.assert_not_called()

    def test_session_delete_scoped_to_current_uid(self):
        with patch('app.auth.auth.verify_id_token', return_value={'uid': 'owner-1', 'admin': True}), patch.dict(os.environ, {'FIREBASE_DATABASE_URL': 'https://project.firebaseio.com'}), patch('app.pi_proxy.realtime_db.reference') as reference:
            session_id = 'a' * 32
            self.assertEqual(self.client.delete(f'/api/pi/webrtc-sessions/{session_id}', headers={'Authorization': 'Bearer verified'}).status_code, 200)
            self.assertEqual(reference.call_args.args[0], f'webrtc/owner-1/{session_id}')
            reference.return_value.delete.assert_called_once()
            self.assertEqual(self.client.delete('/api/pi/webrtc-sessions/bad-id', headers={'Authorization': 'Bearer verified'}).status_code, 422)

    def test_no_session_write_without_current_admin_authorization(self):
        from firebase_admin import auth
        with patch('app.pi_proxy.realtime_db.reference') as reference:
            payload = {'camera_id': 'icspring', 'offer': {'type': 'offer', 'sdp': 'v=0'}}
            self.assertEqual(self.client.post('/api/pi/webrtc-sessions', json=payload).status_code, 401)
            with patch('app.auth.auth.verify_id_token', side_effect=auth.RevokedIdTokenError('revoked')):
                self.assertEqual(self.client.post('/api/pi/webrtc-sessions', headers={'Authorization': 'Bearer revoked'}, json=payload).status_code, 401)
            reference.assert_not_called()

    def test_signaling_config_uid_and_backend_errors_are_sanitized(self):
        headers = {'Authorization': 'Bearer verified'}
        session_id = 'a' * 32
        with patch('app.auth.auth.verify_id_token', return_value={'uid': 'owner', 'admin': True}), patch('app.pi_proxy.realtime_db.reference') as reference:
            for url in ['', 'http://project.firebaseio.com', 'https://attacker.example', 'https://user:secret@project.firebaseio.com', 'https://project.firebaseio.com?target=x']:
                with self.subTest(url=url), patch.dict(os.environ, {'FIREBASE_DATABASE_URL': url}):
                    response = self.client.delete(f'/api/pi/webrtc-sessions/{session_id}', headers=headers)
                    self.assertEqual(response.status_code, 503)
            reference.assert_not_called()
            with patch.dict(os.environ, {'FIREBASE_DATABASE_URL': 'https://project.firebaseio.com'}), patch('app.auth.auth.verify_id_token', return_value={'uid': 'victim/other', 'admin': True}):
                self.assertEqual(self.client.delete(f'/api/pi/webrtc-sessions/{session_id}', headers=headers).status_code, 400)
            reference.assert_not_called()
            with patch.dict(os.environ, {'FIREBASE_DATABASE_URL': 'https://project.firebaseio.com'}):
                reference.return_value.delete.side_effect = RuntimeError('secret internal path')
                response = self.client.delete(f'/api/pi/webrtc-sessions/{session_id}', headers=headers)
                self.assertEqual(response.status_code, 502)
                self.assertNotIn('secret', response.text)

if __name__ == '__main__':
    unittest.main()
