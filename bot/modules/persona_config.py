"""
persona_config.py — Slack 봇 페르소나 설정

페르소나 이름·이모지·시스템 프롬프트는 Electron /settings API에서 동적으로 로드됩니다.
Electron 미실행 시 name/emoji만 최소 폴백 제공.
config.json의 personas 섹션으로 추가 재정의 가능.
"""
from __future__ import annotations

from .rag_electron import get_persona_for_tag

PERSONA_ALIASES: dict[str, str] = {
    "chief": "chief",
    "pm":    "chief",
    "수석":  "chief",
    "디렉터": "chief",
    "art":   "art",
    "아트":  "art",
    "spec":  "spec",
    "기획":  "spec",
    "tech":  "tech",
    "기술":  "tech",
    "프로그": "tech",
}


def resolve_persona(tag: str, custom_personas: dict | None = None) -> dict:
    key = PERSONA_ALIASES.get(tag.lower(), tag.lower())
    if custom_personas and key in custom_personas:
        return custom_personas[key]
    return get_persona_for_tag(key)
