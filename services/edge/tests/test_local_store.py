from pathlib import Path

from attendance_edge.local_store import LocalStore


def test_attendance_cooldown_and_queue(tmp_path: Path) -> None:
    store = LocalStore(tmp_path / "edge.db")
    assert store.accept_attendance("camera-1", "user-1", 60)
    assert not store.accept_attendance("camera-1", "user-1", 60)
    assert store.accept_attendance("camera-2", "user-1", 60)
    store.enqueue("attendance", {"user_id": "user-1"})
    assert len(store.pending()) == 1
    store.close()
