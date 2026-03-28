"""
persona_config.py — Slack bot persona configuration

Persona name/emoji/system prompts are dynamically loaded from the Electron /settings API.
When Electron is not running, only minimal fallback (name/emoji) is provided.
Can be further overridden via the personas section in config.json.
"""
from __future__ import annotations

from .rag_electron import get_persona_for_tag

PERSONA_ALIASES: dict[str, str] = {
    "chief": "chief",
    "pm":    "chief",
    "수석":  "chief",      # Korean alias: lead
    "디렉터": "chief",    # Korean alias: director
    "art":   "art",
    "아트":  "art",        # Korean alias: art
    "spec":  "spec",
    "기획":  "spec",       # Korean alias: design/planning
    "tech":  "tech",
    "기술":  "tech",       # Korean alias: tech
    "프로그": "tech",     # Korean alias: programming
}


def resolve_persona(tag: str, custom_personas: dict | None = None) -> dict:
    key = PERSONA_ALIASES.get(tag.lower(), tag.lower())
    if custom_personas and key in custom_personas:
        return custom_personas[key]
    return get_persona_for_tag(key)
