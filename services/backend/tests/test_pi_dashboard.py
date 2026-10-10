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

    def test_unknown_review_is_admin_only_and_uses_fixed_target_and_server_token(self):
        identifier = 'a'*32
        path = '/api/pi/unknown-events/'+identifier+'/review'
        with patch('app.pi_proxy.requests.request') as upstream:
            self.assertEqual(self.client.patch(path,json={'decision':'reviewed'}).status_code,401)
            with patch('app.auth.auth.verify_id_token',return_value={'uid':'viewer','admin':False}):
                self.assertEqual(self.client.patch(path,headers=self.headers,json={'decision':'reviewed'}).status_code,403)
            upstream.assert_not_called()
            upstream.return_value = Mock(status_code=200,json=lambda:{'observation_id':identifier,'review_status':'reviewed','reviewed_at':'2026-10-10T00:00:00+00:00','reviewed_by':'shared-token-admin'})
            response = self.client.patch(path,headers=self.headers,json={'decision':'reviewed'})
            self.assertEqual(response.status_code,200)
            self.assertEqual(response.json()['review_status'],'reviewed')
            self.assertEqual(upstream.call_args.args,('PATCH','http://127.0.0.1:18080/api/unknown-events/'+identifier+'/review'))
            self.assertEqual(upstream.call_args.kwargs['headers'],{'Authorization':'Bearer private-fixture'})
            self.assertEqual(upstream.call_args.kwargs['json'],{'decision':'reviewed'})
            self.assertFalse(upstream.call_args.kwargs['allow_redirects'])

    def test_unknown_review_validates_identifier_body_and_private_token(self):
        path = '/api/pi/unknown-events/'+'a'*32+'/review'
        with patch('app.pi_proxy.requests.request') as upstream:
            for body in [{'decision':'pending'},{'decision':True},{'decision':'reviewed','uid':'victim'},{'decision':'reviewed','url':'https://attacker.example'}]:
                self.assertEqual(self.client.patch(path,headers=self.headers,json=body).status_code,422)
            self.assertEqual(self.client.patch('/api/pi/unknown-events/bad-id/review',headers=self.headers,json={'decision':'reviewed'}).status_code,422)
            with patch.dict(os.environ,{'PI_API_TOKEN':''}):
                self.assertEqual(self.client.patch(path,headers=self.headers,json={'decision':'reviewed'}).status_code,503)
            upstream.assert_not_called()

    def test_unknown_review_preserves_generic_upstream_failure(self):
        with patch('app.pi_proxy.requests.request') as upstream:
            upstream.return_value = Mock(status_code=404,text='private details')
            response = self.client.patch('/api/pi/unknown-events/'+'a'*32+'/review',headers=self.headers,json={'decision':'dismissed'})
            self.assertEqual(response.status_code,404)
            self.assertEqual(response.json(),{'detail':'Pi API returned HTTP 404'})
