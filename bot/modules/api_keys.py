"""
api_keys.py — API 키 로드 우선순위 단일 정의 (SSOT)

우선순위: Electron Settings > config.json > 환경변수(.env)

모든 API 키 접근은 이 모듈을 통해 수행합니다.
bot.py에서 직접 cfg.get("claude_api_key") 하지 마세요.
"""
import os


def get_anthropic_key(cfg: dict) -> str:
    """
    Anthropic API 키를 단일 우선순위 로직으로 반환.

    우선순위:
      1. Electron /settings API (실행 중일 때)
      2. config.json (cfg["claude_api_key"])
      3. 환경변수 ANTHROPIC_API_KEY

    반환값이 빈 문자열이면 키 없음.
    """
    # 1. Electron 설정 (실행 중일 때만 유효)
    try:
        from .rag_electron import get_api_key_from_settings
        key = get_api_key_from_settings("anthropic")
        if key:
            return key
    except Exception:
        pass

    # 2. config.json
    key = cfg.get("claude_api_key", "").strip()
    if key:
        return key

    # 3. 환경변수
    return os.getenv("ANTHROPIC_API_KEY", "")
