"""
paths.py — 봇 캐시·데이터 디렉토리 경로 (SSOT)

모든 파일 경로는 이 모듈을 통해 참조합니다.
경로 구조 변경 시 이 파일만 수정하면 됩니다.
"""
import os

# bot/ 패키지 루트 (modules/ 의 부모)
_BOT_ROOT = os.path.dirname(os.path.dirname(__file__))

# ── 캐시 디렉토리 ─────────────────────────────────────────────────────────────
CACHE_DIR            = os.path.join(_BOT_ROOT, "cache")
VAULT_ACCESS_PATH    = os.path.join(CACHE_DIR, "vault_access.json")
RAG_CHECKPOINTS_DIR  = os.path.join(CACHE_DIR, "rag_checkpoints")
