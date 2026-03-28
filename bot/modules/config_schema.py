"""
config_schema.py — BotConfig TypedDict (SSOT)

Defines the config.json schema as types.
Reference this when gradually migrating bot.py from cfg: dict to cfg: BotConfig.

total=False: all keys are optional (only some may exist at load time)
"""
from typing import TypedDict

from .constants import DEFAULT_HAIKU_MODEL, KEYWORD_INDEX_REL_PATH


class BotConfig(TypedDict, total=False):
    # ── Vault ─────────────────────────────────────────────────────────────────
    vault_path:                 str    # Obsidian vault absolute path
    keyword_index_path:         str    # Keyword index relative path within vault (default: KEYWORD_INDEX_REL_PATH)
    max_files_per_keyword_scan: int    # Max files per keyword scan (default: 20)

    # ── API Keys (secrets — .env or UI input) ─────────────────────────────────
    claude_api_key:   str   # Anthropic API key
    slack_bot_token:  str   # Slack Bot OAuth token
    slack_app_token:  str   # Slack App-Level token (Socket Mode)

    # ── Slack Bot Behavior ────────────────────────────────────────────────────
    slack_notify_channel: str   # Notification channel ID
    slack_rag_top_n:      int   # Top N RAG search results (default: 5)

    # ── Scheduler ─────────────────────────────────────────────────────────────
    interval_hours: int    # Auto-run interval (hours)
    auto_run:       bool   # Whether to auto-run on startup

    # ── Model ─────────────────────────────────────────────────────────────────
    worker_model: str   # Worker LLM model ID (default: DEFAULT_HAIKU_MODEL)

    # ── External Tools ────────────────────────────────────────────────────────
    wkhtmltopdf_path: str   # PDF conversion tool path (Windows default exists)


def default_config() -> BotConfig:
    """Return default values dictionary before loading config.json."""
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
