"""
telegram_utils.py — Telegram 이벤트 파싱 + 파일 다운로드 유틸리티

Slack 봇과 동일한 RAG 파이프라인을 Telegram에서 사용하기 위한 어댑터.
"""
from __future__ import annotations

import json
import logging
import urllib.request
import urllib.error

logger = logging.getLogger(__name__)

TELEGRAM_API = "https://api.telegram.org/bot{token}"
TELEGRAM_FILE_API = "https://api.telegram.org/file/bot{token}"


def tg_api(token: str, method: str, data: dict | None = None, timeout: float = 30.0) -> dict:
    """Telegram Bot API 호출."""
    url = f"{TELEGRAM_API.format(token=token)}/{method}"
    if data:
        payload = json.dumps(data).encode("utf-8")
        req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
    else:
        req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def send_message(token: str, chat_id: int | str, text: str,
                 parse_mode: str = "Markdown", reply_to: int | None = None) -> dict:
    """텍스트 메시지 전송. 4096자 초과 시 분할 전송."""
    MAX_LEN = 4096
    results = []
    for i in range(0, len(text), MAX_LEN):
        chunk = text[i:i + MAX_LEN]
        data: dict = {"chat_id": chat_id, "text": chunk}
        if parse_mode:
            data["parse_mode"] = parse_mode
        if reply_to and i == 0:
            data["reply_to_message_id"] = reply_to
        try:
            results.append(tg_api(token, "sendMessage", data))
        except Exception:
            # Markdown 파싱 실패 시 plain text로 재시도
            data.pop("parse_mode", None)
            results.append(tg_api(token, "sendMessage", data))
    return results[-1] if results else {}


def send_typing(token: str, chat_id: int | str) -> None:
    """typing 상태 표시."""
    try:
        tg_api(token, "sendChatAction", {"chat_id": chat_id, "action": "typing"}, timeout=5.0)
    except Exception:
        pass


def download_file(token: str, file_id: str) -> tuple[bytes | None, str]:
    """
    Telegram 파일 다운로드.
    Returns: (파일 바이트, 파일 경로) 또는 (None, "")
    """
    try:
        info = tg_api(token, "getFile", {"file_id": file_id})
        file_path = info.get("result", {}).get("file_path", "")
        if not file_path:
            return None, ""
        url = f"{TELEGRAM_FILE_API.format(token=token)}/{file_path}"
        with urllib.request.urlopen(url, timeout=30) as resp:
            return resp.read(), file_path
    except Exception as e:
        logger.error("Telegram 파일 다운로드 실패: %s", e)
        return None, ""


def extract_text_and_files(message: dict) -> tuple[str, list[dict]]:
    """
    Telegram 메시지에서 텍스트와 파일 정보 추출.
    Returns: (텍스트, [{file_id, file_name, mime_type}])
    """
    text = message.get("text", "") or message.get("caption", "") or ""
    files = []

    # 문서 첨부
    if "document" in message:
        doc = message["document"]
        files.append({
            "file_id": doc["file_id"],
            "file_name": doc.get("file_name", "document"),
            "mime_type": doc.get("mime_type", ""),
        })

    # 사진 (가장 큰 해상도)
    if "photo" in message and message["photo"]:
        photo = message["photo"][-1]  # 최대 해상도
        files.append({
            "file_id": photo["file_id"],
            "file_name": "photo.jpg",
            "mime_type": "image/jpeg",
        })

    return text, files


def parse_persona_command(text: str) -> tuple[str, str]:
    """
    페르소나 커맨드 파싱.
    '/ask chief 어떤 질문' → ('chief', '어떤 질문')
    '/ask 그냥 질문' → ('chief', '그냥 질문')  # 기본 페르소나
    일반 텍스트 → ('', 텍스트)
    """
    from .persona_config import PERSONA_ALIASES

    if not text.startswith("/"):
        return "", text

    parts = text.split(None, 2)
    cmd = parts[0].lower().split("@")[0]  # /ask@botname → /ask

    if cmd in ("/ask", "/질문", "/q"):
        if len(parts) >= 3 and parts[1].lower() in PERSONA_ALIASES:
            return parts[1].lower(), parts[2]
        elif len(parts) >= 2:
            return "chief", " ".join(parts[1:])
        return "chief", ""

    if cmd in ("/debate", "/토론"):
        topic = " ".join(parts[1:]) if len(parts) > 1 else ""
        return "__debate__", topic

    if cmd in ("/mirofish", "/시뮬"):
        topic = " ".join(parts[1:]) if len(parts) > 1 else ""
        return "__mirofish__", topic

    if cmd in ("/search", "/검색"):
        query = " ".join(parts[1:]) if len(parts) > 1 else ""
        return "__search__", query

    if cmd in ("/help", "/도움"):
        return "__help__", ""

    if cmd == "/start":
        return "__help__", ""

    return "", text
