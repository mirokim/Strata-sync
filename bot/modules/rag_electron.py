"""
rag_electron.py — Strata Sync Electron RAG API Client

When the Electron app is running, uses TF-IDF + wiki-link graph BFS search
on localhost:7331.
Returns None when not running, so the caller falls back to rag_simple.
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
_CONNECT_TIMEOUT  = 1.5    # Connection check (fast fallback)
_PING_TIMEOUT     = 2.0    # is_electron_alive() TCP connection check
_SEARCH_TIMEOUT   = 12.0   # Actual search (TF-IDF + BFS)
_ASK_TIMEOUT      = 65.0   # Full RAG + LLM generation wait
_ASK_VISION_TIMEOUT = 95.0 # Vision + RAG + LLM generation wait (with images)
_MIROFISH_TIMEOUT = 300.0  # MiroFish simulation (N personas x M rounds)

# Slack tag → settingsStore DirectorId mapping
TAG_TO_DIRECTOR: dict[str, str] = {
    "chief": "chief_director",
    "art":   "art_director",
    "spec":  "plan_director",
    "tech":  "prog_director",
}

import time as _time

_cached_settings: dict | None = None
_settings_fetched_at: float = 0.0
_SETTINGS_TTL = 300.0  # 5-minute TTL — auto-reflects settings changes from Electron


def is_electron_alive(timeout: float = _PING_TIMEOUT) -> bool:
    """
    Check if the Electron app is ready to handle HTTP requests.
    Must receive an actual HTTP response from /settings to return True.
    Returns False if only TCP is open but HTTP is not responding (during restart) — prevents 65s wait.
    """
    try:
        req = urllib.request.Request(RAG_SETTINGS_URL)
        with urllib.request.urlopen(req, timeout=timeout):
            return True
    except Exception:
        return False


def get_electron_settings(timeout: float = 3.0) -> dict | None:
    """
    Return the current Electron app settings.
    {personaModels: {chief_director: 'model-id', ...}}
    Uses 5-minute TTL cache. Returns None on failure.
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
        return _cached_settings  # Return stale cache on failure


_PERSONA_FALLBACK: dict[str, dict] = {
    "chief": {"name": "PM",               "emoji": "🎯"},
    "art":   {"name": "Art Director",         "emoji": "🎨"},
    "spec":  {"name": "Design Director",     "emoji": "📐"},
    "tech":  {"name": "Programming Director", "emoji": "⚙️"},
}


def get_persona_for_tag(tag: str) -> dict:
    """
    Return the persona for the given tag (chief/art/spec/tech) from Electron settings.
    Returns a {name, emoji, system} dict.
    Returns minimal fallback (name, emoji only) when Electron is not running.
    """
    settings = get_electron_settings()
    if settings:
        persona = settings.get("personas", {}).get(tag)
        if persona:
            return persona
    return dict(_PERSONA_FALLBACK.get(tag, {"name": tag, "emoji": "🤖"}))


def get_api_key_from_settings(provider: str = "anthropic") -> str | None:
    """
    Return the API key for a specific provider from Electron Settings.
    Returns None if not found → caller falls back to config.json key.
    """
    settings = get_electron_settings()
    if settings:
        return settings.get("apiKeys", {}).get(provider) or None
    return None


def get_model_for_tag(tag: str, fallback: str = "claude-sonnet-4-6") -> str:
    """Return the Electron settings model for the given tag (chief/art/spec/tech)."""
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
    Send a question to the Electron app and receive a completed AI answer.
    Uses Strata Sync's BFS RAG + persona LLM pipeline directly.
    history: [{"role": "user"|"assistant", "content": "..."}] previous conversation history.
    images: [{"data": "<base64>", "mediaType": "image/png"}] attached images.
    Returns None on failure/not running → caller handles fallback.
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
    Search for image absolute paths by filename in the Electron vault.
    Returns empty list on failure/not running.
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
    Request a MiroFish simulation from the Electron app.
    Returns {feed: [...], report: "..."} on success, None on failure/not running.
    context: Background info found via vault RAG search (injected into persona prompts if present).
    images: [{"data": "<base64>", "mediaType": "image/png"}] directly provided images.
    segment: Target segment hint (e.g. "core gamers") — reflected in persona generation.
    preset_personas: Preset persona array — used as-is without LLM auto-generation when provided.
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
    Save MiroFish simulation results as an MD file in the Electron vault.
    Returns {ok, path, filename} on success, None on failure/not running.
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
    Send a search request to the Electron RAG API.
    Returns a result list on success, None on failure/not running.

    Result dict format:
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
