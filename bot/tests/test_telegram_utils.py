"""test_telegram_utils.py — Telegram utility unit tests"""
import pytest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from modules.telegram_utils import (
    extract_text_and_files,
    parse_persona_command,
)


class TestExtractTextAndFiles:
    def test_plain_text(self):
        msg = {"text": "hello world"}
        text, files = extract_text_and_files(msg)
        assert text == "hello world"
        assert files == []

    def test_photo_message(self):
        msg = {
            "caption": "사진 설명",
            "photo": [
                {"file_id": "small", "width": 90, "height": 90},
                {"file_id": "large", "width": 800, "height": 600},
            ],
        }
        text, files = extract_text_and_files(msg)
        assert text == "사진 설명"
        assert len(files) == 1
        assert files[0]["file_id"] == "large"
        assert files[0]["mime_type"] == "image/jpeg"

    def test_document_message(self):
        msg = {
            "text": "",
            "document": {
                "file_id": "doc123",
                "file_name": "report.pdf",
                "mime_type": "application/pdf",
            },
        }
        text, files = extract_text_and_files(msg)
        assert len(files) == 1
        assert files[0]["file_name"] == "report.pdf"

    def test_empty_message(self):
        text, files = extract_text_and_files({})
        assert text == ""
        assert files == []


class TestParsePersonaCommand:
    def test_ask_with_persona(self):
        tag, query = parse_persona_command("/ask chief 이번 이슈 정리해줘")
        assert tag == "chief"
        assert query == "이번 이슈 정리해줘"

    def test_ask_without_persona(self):
        tag, query = parse_persona_command("/ask 그냥 질문합니다")
        assert tag == "chief"
        assert "그냥 질문합니다" in query

    def test_ask_art(self):
        tag, query = parse_persona_command("/ask art 캐릭터 컨셉")
        assert tag == "art"
        assert query == "캐릭터 컨셉"

    def test_search_command(self):
        tag, query = parse_persona_command("/search 밸런스 패치")
        assert tag == "__search__"
        assert query == "밸런스 패치"

    def test_debate_command(self):
        tag, query = parse_persona_command("/debate PvP 밸런스")
        assert tag == "__debate__"
        assert query == "PvP 밸런스"

    def test_help_command(self):
        tag, query = parse_persona_command("/help")
        assert tag == "__help__"

    def test_start_command(self):
        tag, query = parse_persona_command("/start")
        assert tag == "__help__"

    def test_plain_text(self):
        tag, query = parse_persona_command("그냥 메시지")
        assert tag == ""
        assert query == "그냥 메시지"

    def test_bot_username_suffix(self):
        tag, query = parse_persona_command("/ask@mybot chief 질문")
        assert tag == "chief"
        assert query == "질문"

    def test_korean_command(self):
        tag, query = parse_persona_command("/질문 tech 기술 스택")
        assert tag == "tech"
        assert query == "기술 스택"

    def test_mirofish_command(self):
        tag, query = parse_persona_command("/mirofish 시뮬레이션 주제")
        assert tag == "__mirofish__"
        assert query == "시뮬레이션 주제"
