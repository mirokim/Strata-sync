"""
local_zep.py — Zep Cloud 로컬 대체 구현 (SQLite in-memory 기반)

sqlite3 표준 라이브러리의 in-memory DB를 사용하여
Zep Cloud의 에이전트 메모리 API를 재현합니다.

Zep Cloud API 대응:
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
    context: str        # 최근 메시지 컨텍스트 (Zep의 auto-summary 대응)


@dataclass
class ZepSearchResult:
    message: ZepMessage
    score: float


class LocalZepClient:
    """
    Zep Cloud client drop-in replacement (SQLite in-memory).

    인스턴스마다 독립된 in-memory SQLite DB를 사용합니다.
    시뮬레이션 1회 실행 범위 내에서 유효 — 인스턴스 소멸 시 DB도 소멸.
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

    # ── Zep Cloud API 대응 ────────────────────────────────────────────────────

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
        """Zep: client.memory.search() — 키워드 빈도 기반 관련도 점수"""
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
        """세션 메시지 삭제"""
        self._conn.execute("DELETE FROM messages WHERE session=?", (session_id,))
        self._conn.commit()

    def close(self) -> None:
        """DB 연결 종료 및 메모리 해제"""
        self._conn.close()
