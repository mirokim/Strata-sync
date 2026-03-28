"""
config_schema.py — BotConfig TypedDict (SSOT)

config.json 의 스키마를 타입으로 정의합니다.
bot.py 의 cfg: dict → cfg: BotConfig 로 점진적으로 전환할 때 참조하세요.

total=False: 모든 키가 선택적 (로드 시 일부만 존재할 수 있음)
"""
from typing import TypedDict

from .constants import DEFAULT_HAIKU_MODEL, KEYWORD_INDEX_REL_PATH


class BotConfig(TypedDict, total=False):
    # ── 볼트 ──────────────────────────────────────────────────────────────────
    vault_path:                 str    # Obsidian 볼트 절대 경로
    keyword_index_path:         str    # 볼트 내 키워드 인덱스 상대 경로 (기본: KEYWORD_INDEX_REL_PATH)
    max_files_per_keyword_scan: int    # 키워드 스캔 최대 파일 수 (기본: 20)

    # ── API 키 (시크릿 — .env 또는 UI 입력) ──────────────────────────────────
    claude_api_key:   str   # Anthropic API 키
    slack_bot_token:  str   # Slack Bot OAuth 토큰
    slack_app_token:  str   # Slack App-Level 토큰 (Socket Mode)

    # ── Slack 봇 동작 ─────────────────────────────────────────────────────────
    slack_notify_channel: str   # 알림 채널 ID
    slack_rag_top_n:      int   # RAG 검색 결과 상위 N개 (기본: 5)

    # ── 스케줄러 ─────────────────────────────────────────────────────────────
    interval_hours: int    # 자동 실행 주기 (시간)
    auto_run:       bool   # 시작 시 자동 실행 여부

    # ── 모델 ──────────────────────────────────────────────────────────────────
    worker_model: str   # Worker LLM 모델 ID (기본: DEFAULT_HAIKU_MODEL)

    # ── 외부 도구 ─────────────────────────────────────────────────────────────
    wkhtmltopdf_path: str   # PDF 변환 도구 경로 (Windows 기본값 존재)


def default_config() -> BotConfig:
    """config.json 로드 전 기본값 딕셔너리 반환."""
    return BotConfig(
        vault_path                 = "",
        claude_api_key             = "",
        interval_hours             = 1,
        auto_run                   = False,
        keyword_index_path         = KEYWORD_INDEX_REL_PATH,
        max_files_per_keyword_scan = 20,
        worker_model               = DEFAULT_HAIKU_MODEL,
        wkhtmltopdf_path           = r"C:\Program Files (x86)\wkhtmltopdf\bin\wkhtmltopdf.exe",
    )
