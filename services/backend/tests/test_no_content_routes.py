"""Regression: 204 routes must import and return an empty body across FastAPI versions."""
import unittest
from unittest.mock import MagicMock, patch


class NoContentRouteTests(unittest.TestCase):
    def test_all_204_operations_return_empty_responses(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from app import main
        app = FastAPI()
        app.include_router(main.app.router)
        app.dependency_overrides[main.require_admin] = lambda: {'uid': 'admin', 'admin': True}
        app.dependency_overrides[main._require_device] = lambda: None
        database = MagicMock()
        database.collection.return_value.document.return_value.get.return_value.exists = True
        with patch.object(main, '_require_database', return_value=database), patch.object(main, '_write_heartbeat'), patch.object(main.state, 'unknown_store', MagicMock()):
            client = TestClient(app)
            operations = [
                ('DELETE', '/api/users/user-01', None),
                ('POST', '/api/devices/heartbeat', {'device_id': 'pi-01', 'name': 'Pi', 'device_type': 'raspberry_pi', 'cameras': []}),
                ('PATCH', '/api/unknown-events/event-01/review', {'decision': 'reviewed'}),
                ('DELETE', '/api/unknown-events/event-01/image', None),
            ]
            for method, path, payload in operations:
                with self.subTest(path=path):
                    response = client.request(method, path, json=payload)
                    self.assertEqual(response.status_code, 204, response.text)
                    self.assertEqual(response.content, b'')
                    self.assertNotIn('content-type', response.headers)

if __name__ == '__main__':
    unittest.main()
