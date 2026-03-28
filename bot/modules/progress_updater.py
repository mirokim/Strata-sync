"""
progress_updater.py — Slack bot step-by-step progress messages

Calls chat_update at each pipeline step to display progress.
- Live updates elapsed time every 2.5s (background thread)
- Shows step count (X/N steps)
- Actual time per step is accumulated via EWMA in step_timings.json
"""

from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from typing import Callable

# ── Step definitions (name: initial estimated duration — ETA removed but kept for EWMA learning) ──

STEPS = {
    "search":   ("🔍 Searching vault...",                     3),
    "analyze":  ("📚 Analyzing documents...",                 10),
    "webcheck": ("🌐 Determining web search necessity...",     3),
    "websearch":("🌐 Collecting web information...",           6),
    "answer":   ("✍️ Writing answer...",                     12),
}

# Electron integration path (single large step)
ELECTRON_STEPS = {
    "electron": ("⚡ Electron RAG + LLM processing...", 15),
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
    """Update step duration via EWMA."""
    timings = _load_timings()
    all_steps = {**STEPS, **ELECTRON_STEPS}
    default = float(all_steps.get(step_key, ("?", 10))[1])
    prev = timings.get(step_key, default)
    timings[step_key] = _EWMA_ALPHA * actual_secs + (1 - _EWMA_ALPHA) * prev
    _save_timings(timings)


# ── ProgressUpdater ────────────────────────────────────────────────────────────

class ProgressUpdater:
    """
    Helper that updates Slack messages step by step.

    - Immediately updates Slack message on step start/complete
    - Background thread refreshes elapsed time every 2.5s (live update)
    - Shows progress as "N/M steps", no ETA

    Usage:
        pu = ProgressUpdater(web, channel, ts, name="Chief", emoji="🗺️", is_electron=True)
        pu.start("search")
        # ... perform search ...
        pu.done("search")
        pu.start("answer")
        # ... generate answer ...
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
        self._current_label: str         = "Processing..."

        # Background ticker (live elapsed time update)
        self._ticker_stop:   threading.Event  = threading.Event()
        self._ticker_thread: threading.Thread | None = None

    # ── Public API ─────────────────────────────────────────────────────────────

    def start(self, step_key: str) -> None:
        """Step start — update Slack message + start ticker."""
        self._stop_ticker()

        self._current_key   = step_key
        self._step_start    = time.perf_counter()
        self._current_label = self._label(step_key)

        # Reset remaining steps from this step onwards
        if step_key in self._remaining:
            idx = self._remaining.index(step_key)
            self._remaining = self._remaining[idx:]

        self._update_message()
        self._start_ticker()

    def set_message(self, label: str) -> None:
        """Directly update message with arbitrary status text outside the step flow."""
        self._stop_ticker()
        self._current_label = label
        self._update_message()

    def done(self, step_key: str) -> None:
        """Step complete — EWMA learning + stop ticker."""
        self._stop_ticker()

        if self._step_start is not None:
            actual = time.perf_counter() - self._step_start
            _update_timing(step_key, actual)

        if step_key in self._remaining:
            self._remaining.remove(step_key)

        self._completed_steps += 1
        self._step_start  = None
        self._current_key = None

    # ── Internal ──────────────────────────────────────────────────────────────

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
        """Background thread: refresh elapsed time every _TICK_INTERVAL seconds."""
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
                        "text": f"⏱ {elapsed_str}  •  step {step_num}/{self._total_steps}",
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
            self._log(f"[Progress] chat_update failed (ignored): {e}")

    def _label(self, step_key: str) -> str:
        all_steps = {**STEPS, **ELECTRON_STEPS}
        return all_steps.get(step_key, ("⏳ Processing...", 0))[0]
