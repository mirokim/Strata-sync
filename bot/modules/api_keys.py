"""
api_keys.py — Single source of truth for API key loading priority (SSOT)

Priority: Electron Settings > config.json > Environment variables (.env)

All API key access should go through this module.
Do not use cfg.get("claude_api_key") directly in bot.py.
"""
import os


def get_anthropic_key(cfg: dict) -> str:
    """
    Return the Anthropic API key using a single priority logic.

    Priority:
      1. Electron /settings API (when running)
      2. config.json (cfg["claude_api_key"])
      3. ANTHROPIC_API_KEY environment variable

    Returns empty string if no key is found.
    """
    # 1. Electron settings (only valid when running)
    try:
        from .rag_electron import get_api_key_from_settings
        key = get_api_key_from_settings("anthropic")
        if key:
            return key
    except Exception:
        pass

    # 2. config.json key
    key = cfg.get("claude_api_key", "").strip()
    if key:
        return key

    # 3. Environment variable
    return os.getenv("ANTHROPIC_API_KEY", "")
