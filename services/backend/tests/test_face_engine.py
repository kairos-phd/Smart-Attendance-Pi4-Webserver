from types import SimpleNamespace
import unittest

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


if __name__ == "__main__":
    unittest.main()
