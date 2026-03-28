"""
paths.py — Bot cache and data directory paths (SSOT)

All file paths should be referenced through this module.
Only modify this file when changing path structure.
"""
import os

# bot/ package root (parent of modules/)
_BOT_ROOT = os.path.dirname(os.path.dirname(__file__))

# ── Cache directories ─────────────────────────────────────────────────────────
CACHE_DIR            = os.path.join(_BOT_ROOT, "cache")
VAULT_ACCESS_PATH    = os.path.join(CACHE_DIR, "vault_access.json")
RAG_CHECKPOINTS_DIR  = os.path.join(CACHE_DIR, "rag_checkpoints")
