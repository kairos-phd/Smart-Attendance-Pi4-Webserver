from pathlib import Path

from attendance_edge.local_store import LocalStore


def test_attendance_cooldown_and_queue(tmp_path: Path) -> None:
    store = LocalStore(tmp_path / "edge.db")
    assert store.accept_attendance("camera-1", "user-1", 60)
    assert not store.accept_attendance("camera-1", "user-1", 60)
    assert store.accept_attendance("camera-2", "user-1", 60)
    assert store.accept_attendance("camera-3", "user-1", 60)
    assert not store.accept_attendance("camera-3", "user-1", 60)
    store.enqueue("attendance", {"user_id": "user-1"})
    assert len(store.pending()) == 1
    store.close()


def test_user_cache(tmp_path: Path) -> None:
    from attendance_edge.models import RegisteredUser

    store = LocalStore(tmp_path / "edge.db")
    users = [
        RegisteredUser("u1", "Alice", [0.1, 0.2, 0.3], "ST01"),
        RegisteredUser("u2", "Bob", [0.4, 0.5, 0.6], None),
    ]
    store.save_users(users)
    loaded = store.load_users()
    assert len(loaded) == 2
    assert loaded[0].user_id == "u1"
    assert loaded[0].name == "Alice"
    assert loaded[0].embedding == [0.1, 0.2, 0.3]
    assert loaded[0].student_id == "ST01"
    assert loaded[1].user_id == "u2"
    assert loaded[1].name == "Bob"
    assert loaded[1].embedding == [0.4, 0.5, 0.6]
    assert loaded[1].student_id is None

    # Overwrite / update cache
    users_updated = [RegisteredUser("u3", "Charlie", [0.7, 0.8, 0.9])]
    store.save_users(users_updated)
    loaded2 = store.load_users()
    assert len(loaded2) == 1
    assert loaded2[0].user_id == "u3"
    store.close()


def test_failed_and_retry_limits(tmp_path: Path) -> None:
    store = LocalStore(tmp_path / "edge.db")
    store.enqueue("attendance", {"user_id": "u1"})
    rows = store.pending()
    assert len(rows) == 1
    row_id = rows[0]["id"]

    for _ in range(4):
        store.mark_retry(row_id)
        assert len(store.pending()) == 1

    # 5th retry exceeds MAX_RETRIES
    store.mark_retry(row_id)
    assert len(store.pending()) == 0
    assert len(store.failed()) == 1

    # Explicit mark_failed
    store.enqueue("attendance", {"user_id": "u2"})
    rows = store.pending()
    assert len(rows) == 1
    store.mark_failed(rows[0]["id"])
    assert len(store.pending()) == 0
    assert len(store.failed()) == 2
    store.close()
