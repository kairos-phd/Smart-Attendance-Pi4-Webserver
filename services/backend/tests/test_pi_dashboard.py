import os
import unittest
from unittest.mock import Mock, patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.pi_proxy import router


class DashboardProxyTests(unittest.TestCase):
    def setUp(self):
        app=FastAPI();app.include_router(router);self.client=TestClient(app)
        self.env=patch.dict(os.environ,{'PI_API_BASE_URL':'http://127.0.0.1:18080','PI_CONTROL_MODE':'legacy-loopback','PI_API_TOKEN':'private-fixture'});self.env.start()
        self.auth=patch('app.auth.auth.verify_id_token',return_value={'uid':'operator','admin':True});self.auth.start()
        self.headers={'Authorization':'Bearer website'}
    def tearDown(self):
        self.auth.stop();self.env.stop();self.client.close()
    def test_dashboard_auth_and_pagination_contract(self):
        with patch('app.pi_proxy.requests.request') as upstream:
            self.assertEqual(self.client.get('/api/pi/dashboard').status_code,401)
            upstream.assert_not_called()
            upstream.return_value=Mock(status_code=200,json=lambda:{'attendance':[]})
            result=self.client.get('/api/pi/dashboard?start_date=2026-10-11&after_attendance_id=-1&after_unknown_rowid=50',headers=self.headers)
            self.assertEqual(result.status_code,200)
            self.assertEqual(upstream.call_args.args[1],'http://127.0.0.1:18080/api/dashboard')
            self.assertEqual(upstream.call_args.kwargs['params']['after_attendance_id'],-1)
            self.assertEqual(upstream.call_args.kwargs['headers'],{'Authorization':'Bearer private-fixture'})
    def test_enrollment_and_deactivation_preserve_pi_identity_and_target(self):
        with patch('app.pi_proxy.requests.request') as upstream:
            upstream.return_value=Mock(status_code=201,json=lambda:{'user_id':'same-id','name':'Name','status':'active','student_id':'S1'})
            response=self.client.post('/api/pi/users',files=[('face_images',('a.jpg',b'photo','image/jpeg'))],data={'name':'Name','student_id':'S1'},headers=self.headers)
            self.assertEqual(response.status_code,201)
            self.assertEqual(response.json()['id'],'same-id')
            self.assertIn(b'photo',upstream.call_args.kwargs['data'])
            self.assertEqual(upstream.call_args.kwargs['timeout'],(3,90))
            upstream.return_value=Mock(status_code=200,json=lambda:{'status':'inactive'})
            self.assertEqual(self.client.delete('/api/pi/users/same-id',headers=self.headers).status_code,200)
            self.assertEqual(upstream.call_args.args[:2],('PATCH','http://127.0.0.1:18080/api/users/same-id/inactive'))
    def test_streamed_upload_limit_and_wrong_content_type(self):
        with patch('app.pi_proxy.requests.request') as upstream:
            self.assertEqual(self.client.post('/api/pi/users',content=b'x',headers=self.headers).status_code,415)
            self.assertEqual(self.client.get('/api/pi/dashboard?after_unknown_rowid=-2',headers=self.headers).status_code,422)
            upstream.assert_not_called()
    def test_enrollment_timeout_does_not_claim_rollback_or_retry(self):
        import requests
        with patch('app.pi_proxy.requests.request',side_effect=requests.ReadTimeout()) as upstream:
            response=self.client.post('/api/pi/users',files=[('face_images',('a.jpg',b'photo','image/jpeg'))],headers=self.headers)
            self.assertEqual(response.status_code,504)
            self.assertIn('Refresh registered users before retrying',response.json()['detail'])
            self.assertEqual(upstream.call_count,1)
