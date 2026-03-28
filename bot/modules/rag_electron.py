"""
rag_electron.py — Strata Sync Electron RAG API 클라이언트

Electron 앱이 실행 중일 때 localhost:7331에서
TF-IDF + wiki-link 그래프 BFS 검색을 사용합니다.
실행 중이 아니면 None을 반환 → 호출 측에서 rag_simple로 폴백.
"""
import json
import urllib.request
import urllib.parse

from .constants import DEFAULT_HAIKU_MODEL

RAG_API_BASE      = "http://127.0.0.1:7331"
RAG_API_URL       = RAG_API_BASE + "/search"
RAG_ASK_URL       = RAG_API_BASE + "/ask"
RAG_SETTINGS_URL  = RAG_API_BASE + "/settings"
RAG_IMAGES_URL    = RAG_API_BASE + "/images"
RAG_MIROFISH_URL  = RAG_API_BASE + "/mirofish"
_CONNECT_TIMEOUT  = 1.5    # 연결 확인용 (빠른 폴백)
_PING_TIMEOUT     = 2.0    # is_electron_alive() TCP 연결 확인
_SEARCH_TIMEOUT   = 12.0   # 실제 검색 (TF-IDF + BFS)
_ASK_TIMEOUT      = 65.0   # 전체 RAG + LLM 생성 대기
_ASK_VISION_TIMEOUT = 95.0 # Vision + RAG + LLM 생성 대기 (이미지 포함 시)
_MIROFISH_TIMEOUT = 300.0  # MiroFish 시뮬레이션 (N명 × M라운드)

# Slack 태그 → settingsStore DirectorId 매핑
TAG_TO_DIRECTOR: dict[str, str] = {
    "chief": "chief_director",
    "art":   "art_director",
    "spec":  "plan_director",
    "tech":  "prog_director",
}

import time as _time

_cached_settings: dict | None = None
_settings_fetched_at: float = 0.0
_SETTINGS_TTL = 300.0  # 5분 TTL — Electron에서 설정 변경 시 자동 반영


def is_electron_alive(timeout: float = _PING_TIMEOUT) -> bool:
    """
    Electron 앱이 HTTP 요청을 처리할 준비가 됐는지 확인.
    /settings 엔드포인트로 실제 HTTP 응답을 받아야 True 반환.
    TCP만 열려있고 HTTP 미응답(재시동 중)이면 False — 65초 대기 방지.
    """
    try:
        req = urllib.request.Request(RAG_SETTINGS_URL)
        with urllib.request.urlopen(req, timeout=timeout):
            return True
    except Exception:
        return False


def get_electron_settings(timeout: float = 3.0) -> dict | None:
    """
    Electron 앱의 현재 설정 반환.
    {personaModels: {chief_director: 'model-id', ...}}
    5분 TTL 캐시 적용. 실패 시 None 반환.
    """
    global _cached_settings, _settings_fetched_at
    now = _time.monotonic()
    if _cached_settings is not None and (now - _settings_fetched_at) < _SETTINGS_TTL:
        return _cached_settings
    try:
        with urllib.request.urlopen(RAG_SETTINGS_URL, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            _cached_settings = data
            _settings_fetched_at = now
            return data
    except Exception:
        return _cached_settings  # 실패 시 만료된 캐시라도 반환


_PERSONA_FALLBACK: dict[str, dict] = {
    "chief": {"name": "PM",               "emoji": "🎯"},
    "art":   {"name": "아트 디렉터",       "emoji": "🎨"},
    "spec":  {"name": "기획 디렉터",       "emoji": "📐"},
    "tech":  {"name": "프로그래밍 디렉터", "emoji": "⚙️"},
}


def get_persona_for_tag(tag: str) -> dict:
    """
    Electron settings에서 태그(chief/art/spec/tech)에 해당하는 페르소나 반환.
    {name, emoji, system} 딕셔너리.
    Electron 미실행 시 최소 폴백(name, emoji만) 반환.
    """
    settings = get_electron_settings()
    if settings:
        persona = settings.get("personas", {}).get(tag)
        if persona:
            return persona
    return dict(_PERSONA_FALLBACK.get(tag, {"name": tag, "emoji": "🤖"}))


def get_api_key_from_settings(provider: str = "anthropic") -> str | None:
    """
    Electron Settings에서 특정 provider의 API 키를 반환.
    Settings에 없으면 None 반환 → 호출 측에서 config.json 키로 폴백.
    """
    settings = get_electron_settings()
    if settings:
        return settings.get("apiKeys", {}).get(provider) or None
    return None


def get_model_for_tag(tag: str, fallback: str = "claude-sonnet-4-6") -> str:
    """태그(chief/art/spec/tech)에 해당하는 Electron 설정 모델 반환."""
    settings = get_electron_settings()
    if settings:
        director_id = TAG_TO_DIRECTOR.get(tag, "chief_director")
        model = settings.get("personaModels", {}).get(director_id)
        if model:
            return model
    return fallback


def ask_via_electron(
    query: str,
    tag: str = "chief",
    history: list[dict] | None = None,
    images: list[dict] | None = None,
) -> str | None:
    """
    Electron 앱에 질문을 보내고 완성된 AI 답변을 받아옴.
    렘브란트 맵의 BFS RAG + 페르소나 LLM 파이프라인을 그대로 사용.
    history: [{"role": "user"|"assistant", "content": "..."}] 이전 대화 히스토리.
    images: [{"data": "<base64>", "mediaType": "image/png"}] 첨부 이미지.
    실패/미실행 시 None 반환 → 호출 측에서 폴백.
    """
    director_id = TAG_TO_DIRECTOR.get(tag, "chief_director")
    payload: dict = {"q": query, "director": director_id}
    if history:
        payload["history"] = history
    if images:
        payload["images"] = images
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    try:
        req = urllib.request.Request(
            RAG_ASK_URL,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        timeout = _ASK_VISION_TIMEOUT if images else _ASK_TIMEOUT
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            if isinstance(result, dict):
                return result.get("answer"), result.get("imagePaths", [])
            return None, []
    except Exception:
        return None, []


def get_images_via_electron(query: str) -> list[str]:
    """
    Electron 볼트에서 파일명 기반으로 이미지 절대 경로 검색.
    실패/미실행 시 빈 리스트 반환.
    """
    params = urllib.parse.urlencode({"q": query})
    url = f"{RAG_IMAGES_URL}?{params}"
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=5.0) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("paths", []) if isinstance(data, dict) else []
    except Exception:
        return []


def mirofish_via_electron(
    topic: str,
    num_personas: int = 5,
    num_rounds: int = 3,
    model_id: str = DEFAULT_HAIKU_MODEL,
    context: str | None = None,
    images: list[dict] | None = None,
    segment: str | None = None,
    preset_personas: list[dict] | None = None,
) -> dict | None:
    """
    Electron 앱에 MiroFish 시뮬레이션 요청.
    성공 시 {feed: [...], report: "..."} 반환, 실패/미실행 시 None 반환.
    context: 볼트 RAG 검색으로 찾은 배경 정보 (있으면 페르소나 프롬프트에 주입).
    images: [{"data": "<base64>", "mediaType": "image/png"}] 직접 전달 이미지.
    segment: 타겟 세그먼트 힌트 (e.g. "코어 게이머") — 페르소나 생성에 반영.
    preset_personas: 프리셋 페르소나 배열 — 전달 시 LLM 자동 생성 없이 그대로 사용.
    """
    payload: dict = {
        "topic": topic,
        "numPersonas": num_personas,
        "numRounds": num_rounds,
        "modelId": model_id,
    }
    if context:
        payload["context"] = context
    if images:
        payload["images"] = images
    if segment:
        payload["segment"] = segment
    if preset_personas:
        payload["presetPersonas"] = preset_personas
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    try:
        req = urllib.request.Request(
            RAG_MIROFISH_URL,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=_MIROFISH_TIMEOUT) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            return result if isinstance(result, dict) else None
    except Exception:
        return None


RAG_MIROFISH_SAVE_URL = RAG_API_BASE + "/mirofish-save"


def save_mirofish_to_vault(
    topic: str,
    report: str,
    feed: list[dict],
    brief: str | None = None,
) -> dict | None:
    """
    MiroFish 시뮬레이션 결과를 Electron 볼트에 MD 파일로 저장.
    성공 시 {ok, path, filename} 반환, 실패/미실행 시 None 반환.
    """
    payload: dict = {"topic": topic, "report": report, "feed": feed}
    if brief:
        payload["brief"] = brief
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    try:
        req = urllib.request.Request(
            RAG_MIROFISH_SAVE_URL,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10.0) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            return result if isinstance(result, dict) else None
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {e.code}: {body[:200]}")
    except Exception:
        return None


def search_via_electron(
    query: str,
    top_n: int = 5,
) -> list[dict] | None:
    """
    Electron RAG API에 검색 요청.
    성공 시 결과 list 반환, 실패/미실행 시 None 반환.

    결과 dict 형식:
      {doc_id, filename, stem, title, date, tags, body, score}
    """
    params = urllib.parse.urlencode({"q": query, "n": top_n})
    url = f"{RAG_API_URL}?{params}"
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=_SEARCH_TIMEOUT) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data if isinstance(data, list) else None
    except Exception:
        return None
