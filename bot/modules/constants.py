"""
constants.py — Project-wide constants (SSOT)

Defines constants shared across multiple files such as model names and default paths.
Only modify this file when changes are needed.
"""

# ── LLM Model IDs ────────────────────────────────────────────────────────────
DEFAULT_HAIKU_MODEL  = "claude-haiku-4-5-20251001"   # Worker / brief generation / MiroFish
DEFAULT_SONNET_MODEL = "claude-sonnet-4-6"            # Vision / chief (default fallback)

# ── Relative paths within vault ───────────────────────────────────────────────
KEYWORD_INDEX_REL_PATH = ".strata-sync/keyword_index.json"
