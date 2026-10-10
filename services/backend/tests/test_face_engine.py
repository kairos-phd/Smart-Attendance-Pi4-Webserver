from types import SimpleNamespace
import unittest
import os
import tempfile

import numpy as np

from app.face_engine import FaceEngine


def face(bounds: tuple[int, int, int, int], score: float = 0.9) -> SimpleNamespace:
    return SimpleNamespace(bbox=np.asarray(bounds), det_score=score)


class EnrollmentFaceSelectionTests(unittest.TestCase):
    def test_small_background_face_is_ignored(self) -> None:
        primary = face((100, 50, 400, 450))
        background = face((10, 10, 80, 90), 0.8)

        selected, ignored = FaceEngine._select_enrollment_face([background, primary], 500, 500)

        self.assertIs(selected, primary)
        self.assertEqual(ignored, 1)

    def test_similarly_sized_second_face_is_rejected(self) -> None:
        first = face((20, 20, 220, 320))
        second = face((250, 30, 440, 310), 0.85)

        with self.assertRaisesRegex(ValueError, "More than one prominent face"):
            FaceEngine._select_enrollment_face([first, second], 500, 400)

    def test_empty_detection_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "No face"):
            FaceEngine._select_enrollment_face([], 500, 400)

    def test_face_crop_is_padded_and_bounded(self) -> None:
        image = np.zeros((100, 120, 3), dtype=np.uint8)
        crop = FaceEngine._expanded_face_crop(image, (5, 10, 55, 70))

        self.assertGreater(crop.shape[0], 60)
        self.assertGreater(crop.shape[1], 50)
        self.assertLessEqual(crop.shape[0], 100)
        self.assertLessEqual(crop.shape[1], 120)


from pathlib import Path
from unittest.mock import MagicMock, patch

from app.face_engine import RegisteredUser
from app.main import _update_confirmation_history, state
from app.settings import BackendSettings
from app.unknown_store import UnknownImageStore


class FaceEngineBboxAndCachingTests(unittest.TestCase):
    def test_crash_02_recognize_clamps_bbox_coordinates(self) -> None:
        engine = FaceEngine("buffalo_sc", Path("./models"), 320, 0.45)
        mock_face = SimpleNamespace(
            bbox=np.asarray([-20, -10, 600, 500]),
            det_score=0.9,
            normed_embedding=np.zeros(512, dtype=np.float32),
        )
        engine._app = SimpleNamespace(get=MagicMock(return_value=[mock_face]))

        image = np.zeros((400, 500, 3), dtype=np.uint8)
        recognitions = engine.recognize(image, [])

        self.assertEqual(len(recognitions), 1)
        self.assertEqual(recognitions[0].bbox, (0, 0, 500, 400))

    def test_perf_03_centroid_caching(self) -> None:
        engine = FaceEngine("buffalo_sc", Path("./models"), 320, 0.45)
        vec1 = [1.0, 0.0, 0.0]
        vec2 = [0.0, 1.0, 0.0]
        user = RegisteredUser("user_1", "Alice", [vec1, vec2])

        users_list = [user]
        matrix1 = engine._get_profile_matrix(users_list)
        self.assertIsNotNone(matrix1)
        self.assertIn("user_1", engine._centroid_cache)

        # Same list instance should return cached matrix object
        matrix2 = engine._get_profile_matrix(users_list)
        self.assertIs(matrix1, matrix2)

        # Precomputed centroid in RegisteredUser is used directly
        precomputed = [0.0, 0.0, 1.0]
        user_with_centroid = RegisteredUser("user_2", "Bob", [], centroid=precomputed)
        engine._get_profile_matrix([user_with_centroid])
        self.assertIn("user_2", engine._centroid_cache)
        np.testing.assert_allclose(engine._centroid_cache["user_2"], precomputed)

        # Cache clear resets properly
        engine.clear_centroid_cache()
        self.assertEqual(len(engine._centroid_cache), 0)
        self.assertIsNone(engine._cached_profile_matrix)


class ConfirmationHistoryTests(unittest.TestCase):
    def setUp(self) -> None:
        state.settings = BackendSettings.from_env()
        state.recognition_history.clear()
        state.unknown_history.clear()

    def test_logic_01_user_history_not_wiped_on_single_miss(self) -> None:
        camera_id = "cam-01"
        user_id = "user-123"

        counts, _ = _update_confirmation_history(camera_id, {user_id}, False, 1.0)
        self.assertEqual(counts.get(user_id), 1)

        counts, _ = _update_confirmation_history(camera_id, set(), False, 2.0)
        self.assertEqual(counts.get(user_id, 0), 0)
        self.assertIn((camera_id, user_id), state.recognition_history)
        self.assertEqual(state.recognition_history[(camera_id, user_id)], [1.0])

        counts, _ = _update_confirmation_history(camera_id, {user_id}, False, 3.0)
        self.assertEqual(counts.get(user_id), 2)

        counts, _ = _update_confirmation_history(camera_id, {user_id}, False, 20.0)
        self.assertEqual(counts.get(user_id), 1)


class UnknownStoreCleanupTests(unittest.TestCase):
    def test_crash_01_cleanup_handles_oserror(self) -> None:
        import os
        import tempfile

        with tempfile.TemporaryDirectory() as tmp_dir:
            store = UnknownImageStore(Path(tmp_dir), 30)
            f1 = store.root / "locked.jpg"
            f2 = store.root / "unlocked.jpg"
            f1.write_bytes(b"dummy")
            f2.write_bytes(b"dummy")

            past_time = 1000.0
            os.utime(f1, (past_time, past_time))
            os.utime(f2, (past_time, past_time))

            real_unlink = Path.unlink

            def mocked_unlink(path_obj: Path, *args, **kwargs):
                if path_obj.name == "locked.jpg":
                    raise OSError("File locked by process")
                return real_unlink(path_obj, *args, **kwargs)

            with patch.object(Path, "unlink", side_effect=mocked_unlink, autospec=True):
                removed = store.cleanup()
                self.assertEqual(removed, 1)


class IngestFrameThrottlingAndPerfTests(unittest.IsolatedAsyncioTestCase):
    @patch("app.main._write_heartbeat")
    @patch("app.main._require_database")
    @patch("app.main._require_ai")
    @patch("app.main._decode_image")
    @patch("app.main._active_users", return_value=[])
    async def test_cost_01_heartbeat_throttled_to_60s(
        self, mock_users, mock_decode, mock_ai, mock_db, mock_heartbeat
    ) -> None:
        import io
        from fastapi import UploadFile
        from app.main import ingest_frame

        state.settings = BackendSettings.from_env()
        state.device_heartbeats.clear()
        mock_ai.return_value.recognize.return_value = []
        mock_decode.return_value = np.zeros((100, 100, 3), dtype=np.uint8)

        fake_upload1 = UploadFile(file=io.BytesIO(b"fake-bytes"), filename="frame1.jpg", headers={"content-type": "image/jpeg"})
        fake_upload2 = UploadFile(file=io.BytesIO(b"fake-bytes"), filename="frame2.jpg", headers={"content-type": "image/jpeg"})

        # Frame 1: heartbeat is recorded
        await ingest_frame(
            frame=fake_upload1,
            camera_id="cam-01",
            raspberry_pi_id="rpi-01",
        )
        self.assertEqual(mock_heartbeat.call_count, 1)

        # Frame 2 immediately after: heartbeat is throttled
        await ingest_frame(
            frame=fake_upload2,
            camera_id="cam-01",
            raspberry_pi_id="rpi-01",
        )
        self.assertEqual(mock_heartbeat.call_count, 1)


class EnvConfigTests(unittest.TestCase):
    def test_int_02_service_account_path(self) -> None:
        # Configuration is operator-owned; tests must not require private .env files.
        with tempfile.TemporaryDirectory() as directory:
            credential_path = Path(directory) / "service-account.json"
            with patch.dict(os.environ, {"FIREBASE_SERVICE_ACCOUNT": str(credential_path)}):
                settings = BackendSettings.from_env()
            self.assertEqual(settings.firebase_service_account, credential_path.resolve())
            self.assertFalse(credential_path.exists())


if __name__ == "__main__":
    unittest.main()
