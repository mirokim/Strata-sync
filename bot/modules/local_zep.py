"""
local_zep.py — Local replacement for Zep Cloud (SQLite in-memory based)

Uses sqlite3 standard library's in-memory DB to replicate
the Zep Cloud agent memory API.

Zep Cloud API correspondence:
  client.add(session_id, messages)          → LocalZepClient.add()
  client.get(session_id)                    → LocalZepClient.get()
  client.search(session_id, text, limit)    → LocalZepClient.search()
"""
from __future__ import annotations

import json
import sqlite3
import time
from dataclasses import dataclass, field


@dataclass
class ZepMessage:
    role: str           # 'user' | 'assistant' | 'system'
    content: str
    metadata: dict = field(default_factory=dict)


@dataclass
class ZepMemory:
    messages: list[ZepMessage]
    context: str        # Recent message context (corresponds to Zep's auto-summary)


@dataclass
class ZepSearchResult:
    message: ZepMessage
    score: float


class LocalZepClient:
    """
    Zep Cloud client drop-in replacement (SQLite in-memory).

    Each instance uses an independent in-memory SQLite DB.
    Valid within a single simulation run — DB is destroyed when the instance is destroyed.
    """

    DDL = """
        CREATE TABLE messages (
            id       INTEGER PRIMARY KEY AUTOINCREMENT,
            session  TEXT    NOT NULL,
            role     TEXT    NOT NULL,
            content  TEXT    NOT NULL,
            metadata TEXT    DEFAULT '{}',
            created  REAL    NOT NULL
        );
        CREATE INDEX idx_session ON messages(session);
    """

    def __init__(self) -> None:
        self._conn = sqlite3.connect(":memory:")
        self._conn.row_factory = sqlite3.Row
        self._conn.executescript(self.DDL)
        self._conn.commit()

    # ── Zep Cloud API correspondence ────────────────────────────────────────────

    def add(self, session_id: str, messages: list[ZepMessage]) -> None:
        """Zep: client.memory.add(session_id, messages=[...])"""
        self._conn.executemany(
            "INSERT INTO messages (session, role, content, metadata, created) VALUES (?,?,?,?,?)",
            [
                (session_id, m.role, m.content, json.dumps(m.metadata), time.time())
                for m in messages
            ],
        )
        self._conn.commit()

    def get(self, session_id: str) -> ZepMemory:
        """Zep: client.memory.get(session_id) → ZepMemory"""
        rows = self._conn.execute(
            "SELECT role, content, metadata FROM messages WHERE session=? ORDER BY id",
            (session_id,),
        ).fetchall()
        messages = [
            ZepMessage(role=r["role"], content=r["content"],
                       metadata=json.loads(r["metadata"] or "{}"))
            for r in rows
        ]
        context = "\n".join(f"{m.role}: {m.content}" for m in messages[-10:])
        return ZepMemory(messages=messages, context=context)

    def search(
        self, session_id: str, text: str, limit: int = 5
    ) -> list[ZepSearchResult]:
        """Zep: client.memory.search() — keyword frequency based relevance score"""
        words = text.lower().split()
        if not words:
            return []
        memory = self.get(session_id)
        scored: list[ZepSearchResult] = []
        for msg in memory.messages:
            low = msg.content.lower()
            score = sum(1 for w in words if w in low) / len(words)
            if score > 0:
                scored.append(ZepSearchResult(message=msg, score=score))
        return sorted(scored, key=lambda r: r.score, reverse=True)[:limit]

    def delete(self, session_id: str) -> None:
        """Delete session messages"""
        self._conn.execute("DELETE FROM messages WHERE session=?", (session_id,))
        self._conn.commit()

    def close(self) -> None:
        """Close DB connection and release memory"""
        self._conn.close()
