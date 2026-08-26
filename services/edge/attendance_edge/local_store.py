from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any


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
                  created_at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS attendance_cooldowns (
                  user_id TEXT NOT NULL,
                  last_seen REAL NOT NULL,
                  PRIMARY KEY (user_id)
                );
                """
            )

    def enqueue(self, event_type: str, payload: dict[str, Any]) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT INTO pending_events(event_type, payload, created_at) VALUES (?, ?, ?)",
                (event_type, json.dumps(payload), time.time()),
            )

    def pending(self, limit: int = 50) -> list[sqlite3.Row]:
        with self._lock:
            return list(self._conn.execute("SELECT * FROM pending_events ORDER BY id LIMIT ?", (limit,)))

    def complete(self, row_id: int) -> None:
        with self._lock, self._conn:
            self._conn.execute("DELETE FROM pending_events WHERE id = ?", (row_id,))

    def mark_retry(self, row_id: int) -> None:
        with self._lock, self._conn:
            self._conn.execute("UPDATE pending_events SET attempts = attempts + 1 WHERE id = ?", (row_id,))

    def accept_attendance(self, camera_id: str, user_id: str, cooldown_seconds: int) -> bool:
        now = time.time()
        with self._lock, self._conn:
            row = self._conn.execute("SELECT last_seen FROM attendance_cooldowns WHERE user_id = ?", (user_id,)).fetchone()
            if row and now - float(row["last_seen"]) < cooldown_seconds:
                return False
            self._conn.execute(
                "INSERT INTO attendance_cooldowns(user_id, last_seen) VALUES (?, ?) "
                "ON CONFLICT(user_id) DO UPDATE SET last_seen = excluded.last_seen",
                (user_id, now),
            )
            return True

    def close(self) -> None:
        with self._lock:
            self._conn.close()
