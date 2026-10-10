import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from firebase_admin import auth

from app.gateway_accounts import router


def firebase_user(uid="target", **overrides):
    fields = dict(uid=uid, email=f"{uid}@example.com", display_name="Account",
                  custom_claims={"admin": True, "department": "science"},
                  email_verified=True, disabled=False,
                  user_metadata=SimpleNamespace(creation_timestamp=0, last_sign_in_timestamp=None))
    fields.update(overrides)
    return SimpleNamespace(**fields)


class GatewayAccountTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(router)
        self.client = TestClient(app)
        self.headers = {"Authorization": "Bearer valid-session"}
        self.verify = self.enterContext(patch("app.auth.auth.verify_id_token", return_value={"uid": "operator", "admin": True}))
        self.db = self.enterContext(patch("app.gateway_accounts.firestore.client"))
        self.get_user = self.enterContext(patch("app.gateway_accounts.firebase_auth.get_user", return_value=firebase_user()))
        self.list_users = self.enterContext(patch("app.gateway_accounts.firebase_auth.list_users"))
        self.claims = self.enterContext(patch("app.gateway_accounts.firebase_auth.set_custom_user_claims"))
        self.update = self.enterContext(patch("app.gateway_accounts.firebase_auth.update_user"))
        self.revoke = self.enterContext(patch("app.gateway_accounts.firebase_auth.revoke_refresh_tokens"))
        document = self.db.return_value.collection.return_value.document.return_value.get.return_value
        document.exists = True
        document.to_dict.return_value = {"username": "target-name"}

    def request_update(self, body, uid="target"):
        return self.client.patch(f"/api/pi/admin/accounts/{uid}", headers=self.headers, json=body)

    def test_real_auth_dependency_rejects_missing_viewer_and_revoked_sessions(self):
        for method, path, kwargs in [("get", "/api/pi/admin/accounts", {}),
                                     ("patch", "/api/pi/admin/accounts/target", {"json": {"disabled": True}})]:
            request = getattr(self.client, method)
            with self.subTest(method=method):
                self.assertEqual(request(path, **kwargs).status_code, 401)
                self.verify.return_value = {"uid": "viewer", "admin": False}
                self.assertEqual(request(path, headers=self.headers, **kwargs).status_code, 403)
                self.verify.side_effect = auth.RevokedIdTokenError("revoked")
                self.assertEqual(request(path, headers=self.headers, **kwargs).status_code, 401)
                self.verify.assert_called_with("valid-session", check_revoked=True)
                self.verify.side_effect = None
        self.db.assert_not_called()
        self.get_user.assert_not_called()

    def test_lists_auth_users_and_joins_firestore_usernames(self):
        document = Mock(id="zeta")
        document.to_dict.return_value = {"username": "zeta-name"}
        orphan = Mock(id="orphan")
        orphan.to_dict.return_value = {"username": "not-an-auth-user"}
        self.db.return_value.collection.return_value.stream.return_value = [document, orphan]
        self.list_users.return_value.iterate_all.return_value = [firebase_user("zeta"), firebase_user("alpha", custom_claims={"admin": "true"})]
        response = self.client.get("/api/pi/admin/accounts", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        values = response.json()
        self.assertEqual([value["uid"] for value in values], ["alpha", "zeta"])
        self.assertEqual(values[0]["role"], "viewer")
        self.assertIsNone(values[0]["username"])
        self.assertEqual(values[1]["username"], "zeta-name")
        self.assertEqual(values[0]["created_at"], "1970-01-01T00:00:00+00:00")

    def test_demotes_without_losing_other_claims_and_revokes_sessions(self):
        self.get_user.side_effect = [firebase_user(), firebase_user(custom_claims={"department": "science"}, disabled=True)]
        response = self.request_update({"role": "viewer", "disabled": True})
        self.assertEqual(response.status_code, 200)
        self.claims.assert_called_once_with("target", {"department": "science"})
        self.update.assert_called_once_with("target", disabled=True)
        self.revoke.assert_called_once_with("target")
        self.assertEqual(response.json()["role"], "viewer")
        self.assertTrue(response.json()["disabled"])
        self.assertEqual(response.json()["username"], "target-name")

    def test_promotes_preserving_claims(self):
        self.get_user.return_value = firebase_user(custom_claims={"department": "science"})
        self.assertEqual(self.request_update({"role": "admin"}).status_code, 200)
        self.claims.assert_called_once_with("target", {"department": "science", "admin": True})
        self.revoke.assert_called_once_with("target")

    def test_self_changes_empty_and_invalid_body_rejected_before_access(self):
        for body, uid, expected in [({"role": "viewer"}, "operator", 400),
                                    ({"disabled": True}, "operator", 400),
                                    ({}, "target", 400), ({"role": None, "disabled": None}, "target", 400),
                                    ({"role": "owner"}, "target", 422),
                                    ({"disabled": "false"}, "target", 422),
                                    ({"disabled": 1}, "target", 422),
                                    ({"unknown": True}, "target", 422),
                                    ({"role": "admin"}, "x" * 129, 422),
                                    ({"role": "admin"}, "bad%5Cuid", 422),
                                    ({"role": "admin"}, "%2E%2E", 422)]:
            with self.subTest(body=body, uid=uid):
                self.assertEqual(self.request_update(body, uid).status_code, expected)
        self.get_user.assert_not_called()
        self.db.assert_not_called()
        self.claims.assert_not_called()
        self.update.assert_not_called()
        self.revoke.assert_not_called()

    def test_unknown_user_is_safe_404(self):
        self.get_user.side_effect = auth.UserNotFoundError("secret service details")
        response = self.request_update({"disabled": True})
        self.assertEqual(response.status_code, 404)
        self.assertNotIn("secret", response.text)
        self.revoke.assert_not_called()

    def test_partial_mutation_failure_still_revokes_and_hides_details(self):
        self.update.side_effect = RuntimeError("private credential location")
        response = self.request_update({"role": "viewer", "disabled": True})
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("credential", response.text)
        self.claims.assert_called_once()
        self.revoke.assert_called_once_with("target")

    def test_firestore_outage_prevents_mutation_and_hides_details(self):
        self.db.side_effect = RuntimeError("private credential location")
        response = self.request_update({"disabled": False})
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("credential", response.text)
        self.update.assert_not_called()
        self.revoke.assert_not_called()
        response = self.client.get("/api/pi/admin/accounts", headers=self.headers)
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("credential", response.text)


if __name__ == "__main__":
    unittest.main()
