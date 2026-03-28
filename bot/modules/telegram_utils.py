"""
telegram_utils.py — Telegram event parsing + file download utilities

Adapter for using the same RAG pipeline as the Slack bot on Telegram.
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
    """Call the Telegram Bot API."""
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
    """Send a text message. Split into chunks if exceeding 4096 characters."""
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
            # Retry as plain text if Markdown parsing fails
            data.pop("parse_mode", None)
            results.append(tg_api(token, "sendMessage", data))
    return results[-1] if results else {}


def send_typing(token: str, chat_id: int | str) -> None:
    """Show typing indicator."""
    try:
        tg_api(token, "sendChatAction", {"chat_id": chat_id, "action": "typing"}, timeout=5.0)
    except Exception:
        pass


def download_file(token: str, file_id: str) -> tuple[bytes | None, str]:
    """
    Download a Telegram file.
    Returns: (file bytes, file path) or (None, "")
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
        logger.error("Telegram file download failed: %s", e)
        return None, ""


def extract_text_and_files(message: dict) -> tuple[str, list[dict]]:
    """
    Extract text and file info from a Telegram message.
    Returns: (text, [{file_id, file_name, mime_type}])
    """
    text = message.get("text", "") or message.get("caption", "") or ""
    files = []

    # Document attachment
    if "document" in message:
        doc = message["document"]
        files.append({
            "file_id": doc["file_id"],
            "file_name": doc.get("file_name", "document"),
            "mime_type": doc.get("mime_type", ""),
        })

    # Photo (highest resolution)
    if "photo" in message and message["photo"]:
        photo = message["photo"][-1]  # Maximum resolution
        files.append({
            "file_id": photo["file_id"],
            "file_name": "photo.jpg",
            "mime_type": "image/jpeg",
        })

    return text, files


def parse_persona_command(text: str) -> tuple[str, str]:
    """
    Parse persona commands.
    '/ask chief some question' → ('chief', 'some question')
    '/ask just a question' → ('chief', 'just a question')  # default persona
    plain text → ('', text)
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
