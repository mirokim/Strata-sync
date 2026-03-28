"""
tests/test_rag_electron.py — rag_electron.py 유닛 테스트

실행: python -m pytest bot/tests/ -v
(또는 bot/ 디렉토리에서 python -m pytest tests/ -v)
"""
import json
import sys
import time
import unittest
from io import BytesIO
from unittest.mock import patch, MagicMock
from pathlib import Path

# bot/modules 경로 추가
sys.path.insert(0, str(Path(__file__).parent.parent))

import modules.rag_electron as rag


def _make_response(data: object, status: int = 200) -> MagicMock:
    """urllib.request.urlopen 반환값 흉내."""
    body = json.dumps(data).encode("utf-8")
    mock = MagicMock()
    mock.read.return_value = body
    mock.status = status
    mock.__enter__ = lambda s: s
    mock.__exit__ = MagicMock(return_value=False)
    return mock


class TestGetElectronSettings(unittest.TestCase):
    def setUp(self):
        # 각 테스트 전 캐시 초기화
        rag._cached_settings = None
        rag._settings_fetched_at = 0.0

    def test_returns_settings_on_success(self):
        payload = {"personaModels": {"chief_director": "claude-opus-4-6"}}
        with patch("urllib.request.urlopen", return_value=_make_response(payload)):
            result = rag.get_electron_settings()
        self.assertEqual(result, payload)

    def test_returns_none_when_electron_offline(self):
        import urllib.error
        with patch("urllib.request.urlopen", side_effect=urllib.error.URLError("refused")):
            result = rag.get_electron_settings()
        self.assertIsNone(result)

    def test_cache_is_used_within_ttl(self):
        payload = {"personaModels": {"chief_director": "model-a"}}
        with patch("urllib.request.urlopen", return_value=_make_response(payload)) as mock_open:
            rag.get_electron_settings()
            rag.get_electron_settings()  # 두 번째는 캐시 사용
        mock_open.assert_called_once()

    def test_cache_expires_after_ttl(self):
        payload1 = {"personaModels": {"chief_director": "model-a"}}
        payload2 = {"personaModels": {"chief_director": "model-b"}}
        responses = [_make_response(payload1), _make_response(payload2)]
        with patch("urllib.request.urlopen", side_effect=responses):
            r1 = rag.get_electron_settings()
            # TTL 만료 시뮬레이션
            rag._settings_fetched_at -= rag._SETTINGS_TTL + 1
            r2 = rag.get_electron_settings()
        self.assertEqual(r1["personaModels"]["chief_director"], "model-a")
        self.assertEqual(r2["personaModels"]["chief_director"], "model-b")

    def test_stale_cache_returned_on_failure(self):
        """Electron 재시작 전 실패 시 만료 캐시라도 반환."""
        import urllib.error
        payload = {"personaModels": {"chief_director": "model-a"}}
        with patch("urllib.request.urlopen", return_value=_make_response(payload)):
            rag.get_electron_settings()
        # TTL 만료 후 재요청 실패
        rag._settings_fetched_at -= rag._SETTINGS_TTL + 1
        with patch("urllib.request.urlopen", side_effect=urllib.error.URLError("refused")):
            result = rag.get_electron_settings()
        self.assertIsNotNone(result)
        self.assertEqual(result["personaModels"]["chief_director"], "model-a")


class TestGetModelForTag(unittest.TestCase):
    def setUp(self):
        rag._cached_settings = None
        rag._settings_fetched_at = 0.0

    def test_resolves_chief_tag(self):
        settings = {"personaModels": {"chief_director": "claude-opus-4-6"}}
        with patch.object(rag, "get_electron_settings", return_value=settings):
            model = rag.get_model_for_tag("chief")
        self.assertEqual(model, "claude-opus-4-6")

    def test_resolves_art_tag(self):
        settings = {"personaModels": {"art_director": "gpt-4o"}}
        with patch.object(rag, "get_electron_settings", return_value=settings):
            model = rag.get_model_for_tag("art")
        self.assertEqual(model, "gpt-4o")

    def test_resolves_spec_to_plan_director(self):
        settings = {"personaModels": {"plan_director": "gemini-2.0-flash"}}
        with patch.object(rag, "get_electron_settings", return_value=settings):
            model = rag.get_model_for_tag("spec")
        self.assertEqual(model, "gemini-2.0-flash")

    def test_resolves_tech_to_prog_director(self):
        settings = {"personaModels": {"prog_director": "grok-3"}}
        with patch.object(rag, "get_electron_settings", return_value=settings):
            model = rag.get_model_for_tag("tech")
        self.assertEqual(model, "grok-3")

    def test_fallback_when_electron_offline(self):
        with patch.object(rag, "get_electron_settings", return_value=None):
            model = rag.get_model_for_tag("chief", fallback="claude-sonnet-4-6")
        self.assertEqual(model, "claude-sonnet-4-6")

    def test_fallback_for_unknown_tag(self):
        settings = {"personaModels": {"chief_director": "claude-opus-4-6"}}
        with patch.object(rag, "get_electron_settings", return_value=settings):
            # 알 수 없는 태그 → chief_director로 폴백
            model = rag.get_model_for_tag("unknown_tag")
        self.assertEqual(model, "claude-opus-4-6")

    def test_fallback_when_model_key_missing(self):
        # personaModels가 비어있는 경우
        settings = {"personaModels": {}}
        with patch.object(rag, "get_electron_settings", return_value=settings):
            model = rag.get_model_for_tag("chief", fallback="my-fallback")
        self.assertEqual(model, "my-fallback")


class TestSearchViaElectron(unittest.TestCase):
    def test_returns_list_on_success(self):
        docs = [{"doc_id": "d1", "stem": "test", "score": 0.9}]
        with patch("urllib.request.urlopen", return_value=_make_response(docs)):
            result = rag.search_via_electron("test query")
        self.assertEqual(result, docs)

    def test_returns_none_when_electron_offline(self):
        import urllib.error
        with patch("urllib.request.urlopen", side_effect=urllib.error.URLError("refused")):
            result = rag.search_via_electron("test")
        self.assertIsNone(result)

    def test_returns_none_when_response_is_not_list(self):
        with patch("urllib.request.urlopen", return_value=_make_response({"error": "bad"})):
            result = rag.search_via_electron("test")
        self.assertIsNone(result)

    def test_url_contains_query_and_top_n(self):
        import urllib.request
        docs = []
        captured_urls = []

        def fake_urlopen(req, timeout=None):
            captured_urls.append(req.full_url if hasattr(req, 'full_url') else str(req))
            return _make_response(docs)

        with patch("urllib.request.urlopen", side_effect=fake_urlopen):
            rag.search_via_electron("hello world", top_n=3)

        self.assertTrue(any("q=hello+world" in u or "q=hello%20world" in u for u in captured_urls))
        self.assertTrue(any("n=3" in u for u in captured_urls))


class TestAskViaElectron(unittest.TestCase):
    """ask_via_electron은 (answer, image_paths) 튜플을 반환."""

    def test_returns_answer_and_empty_paths_on_success(self):
        payload = {"answer": "이것은 테스트 답변입니다."}
        with patch("urllib.request.urlopen", return_value=_make_response(payload)):
            answer, paths = rag.ask_via_electron("질문", tag="chief")
        self.assertEqual(answer, "이것은 테스트 답변입니다.")
        self.assertEqual(paths, [])

    def test_returns_answer_with_image_paths(self):
        payload = {"answer": "답변", "imagePaths": ["/vault/img/art.png", "/vault/img/ref.png"]}
        with patch("urllib.request.urlopen", return_value=_make_response(payload)):
            answer, paths = rag.ask_via_electron("캐릭터 보여줘")
        self.assertEqual(answer, "답변")
        self.assertEqual(paths, ["/vault/img/art.png", "/vault/img/ref.png"])

    def test_returns_none_tuple_when_electron_offline(self):
        import urllib.error
        with patch("urllib.request.urlopen", side_effect=urllib.error.URLError("refused")):
            answer, paths = rag.ask_via_electron("질문")
        self.assertIsNone(answer)
        self.assertEqual(paths, [])

    def test_tag_mapped_to_correct_director(self):
        """POST body에 director=art_director 포함 확인."""
        payload = {"answer": "답변"}
        captured_bodies = []

        def fake_urlopen(req, timeout=None):
            if hasattr(req, "data") and req.data:
                captured_bodies.append(json.loads(req.data.decode("utf-8")))
            return _make_response(payload)

        with patch("urllib.request.urlopen", side_effect=fake_urlopen):
            rag.ask_via_electron("질문", tag="art")

        self.assertTrue(any(b.get("director") == "art_director" for b in captured_bodies))

    def test_spec_tag_mapped_to_plan_director(self):
        """POST body에 director=plan_director 포함 확인."""
        payload = {"answer": "답변"}
        captured_bodies = []

        def fake_urlopen(req, timeout=None):
            if hasattr(req, "data") and req.data:
                captured_bodies.append(json.loads(req.data.decode("utf-8")))
            return _make_response(payload)

        with patch("urllib.request.urlopen", side_effect=fake_urlopen):
            rag.ask_via_electron("기획 질문", tag="spec")

        self.assertTrue(any(b.get("director") == "plan_director" for b in captured_bodies))

    def test_history_included_in_post_body(self):
        """history가 POST body에 포함되어 전송되는지 확인."""
        payload = {"answer": "답변"}
        captured_bodies = []

        def fake_urlopen(req, timeout=None):
            if hasattr(req, "data") and req.data:
                captured_bodies.append(json.loads(req.data.decode("utf-8")))
            return _make_response(payload)

        history = [{"role": "user", "content": "이전 질문"}, {"role": "assistant", "content": "이전 답변"}]
        with patch("urllib.request.urlopen", side_effect=fake_urlopen):
            rag.ask_via_electron("현재 질문", tag="chief", history=history)

        self.assertTrue(any("history" in b for b in captured_bodies))
        self.assertEqual(captured_bodies[0]["history"], history)

    def test_no_history_key_when_empty(self):
        """history가 없으면 POST body에 history 키가 없어야 함."""
        payload = {"answer": "답변"}
        captured_bodies = []

        def fake_urlopen(req, timeout=None):
            if hasattr(req, "data") and req.data:
                captured_bodies.append(json.loads(req.data.decode("utf-8")))
            return _make_response(payload)

        with patch("urllib.request.urlopen", side_effect=fake_urlopen):
            rag.ask_via_electron("질문")  # history=None

        self.assertNotIn("history", captured_bodies[0])

    def test_returns_none_answer_when_answer_key_missing(self):
        payload = {"result": "no answer key here"}
        with patch("urllib.request.urlopen", return_value=_make_response(payload)):
            answer, paths = rag.ask_via_electron("질문")
        self.assertIsNone(answer)
        self.assertEqual(paths, [])

    def test_returns_none_tuple_on_json_error(self):
        mock = MagicMock()
        mock.read.return_value = b"not valid json{"
        mock.__enter__ = lambda s: s
        mock.__exit__ = MagicMock(return_value=False)
        with patch("urllib.request.urlopen", return_value=mock):
            answer, paths = rag.ask_via_electron("질문")
        self.assertIsNone(answer)
        self.assertEqual(paths, [])


class TestGetImagesViaElectron(unittest.TestCase):
    """get_images_via_electron — /images 엔드포인트 클라이언트."""

    def test_returns_paths_on_success(self):
        payload = {"paths": ["/vault/img/art.png", "/vault/img/ref.jpg"]}
        with patch("urllib.request.urlopen", return_value=_make_response(payload)):
            result = rag.get_images_via_electron("캐릭터A")
        self.assertEqual(result, ["/vault/img/art.png", "/vault/img/ref.jpg"])

    def test_returns_empty_list_when_no_paths(self):
        payload = {"paths": []}
        with patch("urllib.request.urlopen", return_value=_make_response(payload)):
            result = rag.get_images_via_electron("없는캐릭터")
        self.assertEqual(result, [])

    def test_returns_empty_list_when_electron_offline(self):
        import urllib.error
        with patch("urllib.request.urlopen", side_effect=urllib.error.URLError("refused")):
            result = rag.get_images_via_electron("캐릭터")
        self.assertEqual(result, [])

    def test_returns_empty_list_on_unexpected_response_shape(self):
        with patch("urllib.request.urlopen", return_value=_make_response(["not", "a", "dict"])):
            result = rag.get_images_via_electron("캐릭터")
        self.assertEqual(result, [])

    def test_url_contains_query(self):
        captured_urls = []

        def fake_urlopen(req, timeout=None):
            captured_urls.append(req.full_url if hasattr(req, "full_url") else str(req))
            return _make_response({"paths": []})

        with patch("urllib.request.urlopen", side_effect=fake_urlopen):
            rag.get_images_via_electron("캐릭터A 일러스트")

        self.assertTrue(len(captured_urls) > 0)
        self.assertIn("/images", captured_urls[0])


class TestTagToDirectorMapping(unittest.TestCase):
    def test_all_known_tags_mapped(self):
        known = {"chief": "chief_director", "art": "art_director",
                 "spec": "plan_director", "tech": "prog_director"}
        self.assertEqual(rag.TAG_TO_DIRECTOR, known)

    def test_get_defaults_to_chief_for_unknown_tag(self):
        self.assertEqual(rag.TAG_TO_DIRECTOR.get("unknown", "chief_director"), "chief_director")


if __name__ == "__main__":
    unittest.main(verbosity=2)
