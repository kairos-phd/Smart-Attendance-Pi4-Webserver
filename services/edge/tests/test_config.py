import os
from unittest import mock
from pathlib import Path

from attendance_edge.config import Settings


def test_cameras_default_to_three() -> None:
    env = {
        "FIREBASE_SERVICE_ACCOUNT": "dummy-sa.json",
        "DATA_DIR": "./data",
    }
    with mock.patch.dict(os.environ, env, clear=True):
        settings = Settings.from_env()
        assert len(settings.cameras) == 3
        assert settings.cameras[0].camera_id == "camera-1"
        assert settings.cameras[1].camera_id == "camera-2"
        assert settings.cameras[2].camera_id == "camera-3"


def test_cameras_count_override_one() -> None:
    env = {
        "FIREBASE_SERVICE_ACCOUNT": "dummy-sa.json",
        "DATA_DIR": "./data",
        "CAMERAS_COUNT": "1",
    }
    with mock.patch.dict(os.environ, env, clear=True):
        settings = Settings.from_env()
        assert len(settings.cameras) == 1
        assert settings.cameras[0].camera_id == "camera-1"


def test_cameras_count_override_two() -> None:
    env = {
        "FIREBASE_SERVICE_ACCOUNT": "dummy-sa.json",
        "DATA_DIR": "./data",
        "CAMERAS_COUNT": "2",
    }
    with mock.patch.dict(os.environ, env, clear=True):
        settings = Settings.from_env()
        assert len(settings.cameras) == 2
        assert settings.cameras[0].camera_id == "camera-1"
        assert settings.cameras[1].camera_id == "camera-2"


def test_cameras_individual_disable() -> None:
    env = {
        "FIREBASE_SERVICE_ACCOUNT": "dummy-sa.json",
        "DATA_DIR": "./data",
        "CAMERAS_COUNT": "3",
        "CAMERA_2_ENABLED": "false",
    }
    with mock.patch.dict(os.environ, env, clear=True):
        settings = Settings.from_env()
        assert len(settings.cameras) == 2
        assert settings.cameras[0].camera_id == "camera-1"
        assert settings.cameras[1].camera_id == "camera-3"
