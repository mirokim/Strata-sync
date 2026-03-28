"""
progress_updater.py — Slack 봇 단계별 진행 메시지

각 파이프라인 단계에서 chat_update를 호출해 진행 상황을 표시합니다.
- 경과 시간을 2.5초마다 live 업데이트 (배경 스레드)
- 단계 수 (X/N 단계) 표시
- 단계별 실제 소요 시간은 step_timings.json에 EWMA로 누적
"""

from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from typing import Callable

# ── 단계 정의 (이름: 초기 예상 소요 시간 — ETA 제거됐지만 EWMA 학습용으로 유지) ──

STEPS = {
    "search":   ("🔍 볼트 검색 중...",               3),
    "analyze":  ("📚 문서 분석 중...",               10),
    "webcheck": ("🌐 웹 검색 필요 여부 판단 중...",   3),
    "websearch":("🌐 웹 정보 수집 중...",             6),
    "answer":   ("✍️ 답변 작성 중...",              12),
}

# Electron 통합 경로 (단일 큰 스텝)
ELECTRON_STEPS = {
    "electron": ("⚡ Electron RAG + LLM 처리 중...", 15),
}

_TIMINGS_PATH = Path(__file__).parent.parent / "step_timings.json"
_EWMA_ALPHA   = 0.3   # 지수 가중 이동 평균 계수
_TICK_INTERVAL = 2.5  # 경과시간 live 업데이트 주기 (초)


def _load_timings() -> dict[str, float]:
    try:
        if _TIMINGS_PATH.exists():
            return json.loads(_TIMINGS_PATH.read_text(encoding="utf-8"))
    except Exception:
        pass
    return {}


def _save_timings(timings: dict[str, float]) -> None:
    try:
        _TIMINGS_PATH.write_text(json.dumps(timings, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass


def _update_timing(step_key: str, actual_secs: float) -> None:
    """EWMA로 단계 소요 시간 갱신."""
    timings = _load_timings()
    all_steps = {**STEPS, **ELECTRON_STEPS}
    default = float(all_steps.get(step_key, ("?", 10))[1])
    prev = timings.get(step_key, default)
    timings[step_key] = _EWMA_ALPHA * actual_secs + (1 - _EWMA_ALPHA) * prev
    _save_timings(timings)


# ── ProgressUpdater ────────────────────────────────────────────────────────────

class ProgressUpdater:
    """
    Slack 메시지를 단계별로 업데이트하는 헬퍼.

    - 단계 시작/완료 시 즉시 Slack 메시지 업데이트
    - 배경 스레드가 2.5초마다 경과 시간을 갱신 (live 업데이트)
    - "N/M 단계" 형태로 진행도 표시, ETA 없음

    사용법:
        pu = ProgressUpdater(web, channel, ts, name="Chief", emoji="🗺️", is_electron=True)
        pu.start("search")
        # ... 검색 수행 ...
        pu.done("search")
        pu.start("answer")
        # ... 답변 생성 ...
        pu.done("answer")
    """

    def __init__(
        self,
        web,
        channel: str,
        ts: str,
        name: str = "Assistant",
        emoji: str = "✦",
        is_electron: bool = True,
        log_fn: Callable[[str], None] | None = None,
    ):
        self._web     = web
        self._channel = channel
        self._ts      = ts
        self._name    = name
        self._emoji   = emoji
        self._log     = log_fn or (lambda _: None)
        self._start   = time.perf_counter()

        remaining_keys = list(ELECTRON_STEPS.keys()) if is_electron else list(STEPS.keys())
        self._remaining: list[str] = remaining_keys
        self._total_steps   = len(remaining_keys)
        self._completed_steps = 0

        self._step_start:    float | None = None
        self._current_key:   str   | None = None
        self._current_label: str         = "처리 중..."

        # 배경 ticker (경과시간 live 업데이트)
        self._ticker_stop:   threading.Event  = threading.Event()
        self._ticker_thread: threading.Thread | None = None

    # ── 공개 API ──────────────────────────────────────────────────────────────

    def start(self, step_key: str) -> None:
        """단계 시작 — Slack 메시지 업데이트 + ticker 시작."""
        self._stop_ticker()

        self._current_key   = step_key
        self._step_start    = time.perf_counter()
        self._current_label = self._label(step_key)

        # 이 단계부터 남은 단계로 재설정
        if step_key in self._remaining:
            idx = self._remaining.index(step_key)
            self._remaining = self._remaining[idx:]

        self._update_message()
        self._start_ticker()

    def set_message(self, label: str) -> None:
        """단계 흐름 밖에서 임의 상태 텍스트로 메시지를 직접 업데이트."""
        self._stop_ticker()
        self._current_label = label
        self._update_message()

    def done(self, step_key: str) -> None:
        """단계 완료 — EWMA 학습 + ticker 중지."""
        self._stop_ticker()

        if self._step_start is not None:
            actual = time.perf_counter() - self._step_start
            _update_timing(step_key, actual)

        if step_key in self._remaining:
            self._remaining.remove(step_key)

        self._completed_steps += 1
        self._step_start  = None
        self._current_key = None

    # ── 내부 ─────────────────────────────────────────────────────────────────

    def _start_ticker(self) -> None:
        self._ticker_stop.clear()
        self._ticker_thread = threading.Thread(target=self._tick, daemon=True)
        self._ticker_thread.start()

    def _stop_ticker(self) -> None:
        if self._ticker_thread and self._ticker_thread.is_alive():
            self._ticker_stop.set()
            self._ticker_thread.join(timeout=1.0)
        self._ticker_thread = None

    def _tick(self) -> None:
        """배경 스레드: _TICK_INTERVAL초마다 경과시간 갱신."""
        while not self._ticker_stop.wait(_TICK_INTERVAL):
            self._update_message()

    def _update_message(self) -> None:
        elapsed     = time.perf_counter() - self._start
        step_num    = self._completed_steps + 1
        elapsed_str = f"{elapsed:.0f}s"
        blocks = [
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"{self._emoji}  *{self._name}*\n{self._current_label}",
                },
            },
            {
                "type": "context",
                "elements": [
                    {
                        "type": "mrkdwn",
                        "text": f"⏱ {elapsed_str}  •  {step_num}/{self._total_steps}단계",
                    }
                ],
            },
        ]
        fallback = f"{self._emoji} {self._name} — {self._current_label} ({elapsed_str})"
        try:
            self._web.chat_update(
                channel=self._channel, ts=self._ts,
                blocks=blocks, text=fallback,
            )
        except Exception as e:
            self._log(f"[Progress] chat_update 실패 (무시): {e}")

    def _label(self, step_key: str) -> str:
        all_steps = {**STEPS, **ELECTRON_STEPS}
        return all_steps.get(step_key, ("⏳ 처리 중...", 0))[0]
