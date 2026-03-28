"""
constants.py — 프로젝트 전역 상수 (SSOT)

모델명·경로 기본값 등 여러 파일에서 공유하는 상수를 한 곳에 정의합니다.
변경이 필요하면 이 파일만 수정하면 됩니다.
"""

# ── LLM 모델 ID ──────────────────────────────────────────────────────────────
DEFAULT_HAIKU_MODEL  = "claude-haiku-4-5-20251001"   # Worker / brief 생성 / MiroFish
DEFAULT_SONNET_MODEL = "claude-sonnet-4-6"            # Vision / chief (기본 폴백)

# ── 볼트 내 상대 경로 ─────────────────────────────────────────────────────────
KEYWORD_INDEX_REL_PATH = ".strata-sync/keyword_index.json"
