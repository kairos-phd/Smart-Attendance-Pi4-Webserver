from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any


from .models import RegisteredUser


class LocalStore:
    """Durable local queue and attendance cooldown state for network interruptions."""

    def __init__(self, database_path: Path) -> None:
        database_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(database_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        with self._conn:
            self._conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS pending_events (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  event_type TEXT NOT NULL,
                  payload TEXT NOT NULL,
                  attempts INTEGER NOT NULL DEFAULT 0,
                  status TEXT NOT NULL DEFAULT 'pending',
                  created_at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS attendance_cooldowns (
                  camera_id TEXT NOT NULL,
                  user_id TEXT NOT NULL,
                  last_seen REAL NOT NULL,
                  PRIMARY KEY (camera_id, user_id)
                );
                CREATE TABLE IF NOT EXISTS local_users (
                  user_id TEXT PRIMARY KEY,
                  name TEXT NOT NULL,
                  embedding TEXT NOT NULL,
                  student_id TEXT
                );
                """
            )
            try:
                self._conn.execute("ALTER TABLE pending_events ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'")
            except sqlite3.OperationalError:
                pass

    def enqueue(self, event_type: str, payload: dict[str, Any]) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT INTO pending_events(event_type, payload, created_at) VALUES (?, ?, ?)",
                (event_type, json.dumps(payload), time.time()),
            )

    def pending(self, limit: int = 50, max_attempts: int = 5) -> list[sqlite3.Row]:
        with self._lock:
            return list(
                self._conn.execute(
                    "SELECT * FROM pending_events WHERE status = 'pending' AND attempts < ? ORDER BY id LIMIT ?",
                    (max_attempts, limit),
                )
            )

    def complete(self, row_id: int) -> None:
        with self._lock, self._conn:
            self._conn.execute("DELETE FROM pending_events WHERE id = ?", (row_id,))

    def mark_retry(self, row_id: int) -> None:
        with self._lock, self._conn:
            self._conn.execute("UPDATE pending_events SET attempts = attempts + 1 WHERE id = ?", (row_id,))

    def mark_failed(self, row_id: int) -> None:
        with self._lock, self._conn:
            self._conn.execute("UPDATE pending_events SET status = 'failed' WHERE id = ?", (row_id,))

    def failed(self, limit: int = 50) -> list[sqlite3.Row]:
        with self._lock:
            return list(
                self._conn.execute(
                    "SELECT * FROM pending_events WHERE status = 'failed' OR attempts >= 5 ORDER BY id LIMIT ?",
                    (limit,),
                )
            )

    def save_users(self, users: list[RegisteredUser | dict[str, Any]]) -> None:
        rows = []
        for u in users:
            if isinstance(u, RegisteredUser):
                rows.append((u.user_id, u.name, json.dumps(u.embedding), u.student_id))
            elif isinstance(u, dict):
                emb = u["embedding"] if isinstance(u["embedding"], str) else json.dumps(u["embedding"])
                rows.append((u["user_id"], u["name"], emb, u.get("student_id")))
        with self._lock, self._conn:
            self._conn.execute("DELETE FROM local_users")
            self._conn.executemany(
                "INSERT INTO local_users(user_id, name, embedding, student_id) VALUES (?, ?, ?, ?)",
                rows,
            )

    def load_users(self) -> list[RegisteredUser]:
        with self._lock:
            cursor = self._conn.execute(
                "SELECT user_id, name, embedding, student_id FROM local_users ORDER BY user_id"
            )
            return [
                RegisteredUser(
                    user_id=row["user_id"],
                    name=row["name"],
                    embedding=json.loads(row["embedding"]),
                    student_id=row["student_id"],
                )
                for row in cursor.fetchall()
            ]

    def accept_attendance(self, camera_id: str, user_id: str, cooldown_seconds: int) -> bool:
        now = time.time()
        with self._lock, self._conn:
            row = self._conn.execute(
                "SELECT last_seen FROM attendance_cooldowns WHERE camera_id = ? AND user_id = ?",
                (camera_id, user_id),
            ).fetchone()
            if row and now - float(row["last_seen"]) < cooldown_seconds:
                return False
            self._conn.execute(
                "INSERT INTO attendance_cooldowns(camera_id, user_id, last_seen) VALUES (?, ?, ?) "
                "ON CONFLICT(camera_id, user_id) DO UPDATE SET last_seen = excluded.last_seen",
                (camera_id, user_id, now),
            )
            return True

    def close(self) -> None:
        with self._lock:
            self._conn.close()
