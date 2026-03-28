"""
tests/test_slack_utils.py — slack_utils.py 유닛 테스트

실행: python -m pytest bot/tests/ -v
"""
import sys
import unittest
from unittest.mock import MagicMock, patch, call
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from modules.slack_utils import extract_slack_files, download_slack_file


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

PNG_MAGIC  = b"\x89PNG\r\n\x1a\n" + b"\x00" * 50
JPEG_MAGIC = b"\xff\xd8\xff\xe0" + b"\x00" * 50
HTML_PAGE  = b"<!DOCTYPE html><html lang=\"en-US\"><head>"


def _mock_response(content: bytes, status_code: int = 200, ok: bool = True, url: str = "https://example.com") -> MagicMock:
    m = MagicMock()
    m.content    = content
    m.status_code = status_code
    m.ok         = ok
    m.url        = url
    return m


# ─────────────────────────────────────────────────────────────────────────────
# extract_slack_files
# ─────────────────────────────────────────────────────────────────────────────

class TestExtractSlackFiles(unittest.TestCase):

    def test_returns_files_array_when_present(self):
        event = {"files": [{"id": "F1", "mimetype": "image/png"}]}
        result = extract_slack_files(event)
        self.assertEqual(result, [{"id": "F1", "mimetype": "image/png"}])

    def test_returns_single_file_wrapped_in_list(self):
        """구형 API는 'file' 단수 필드 사용."""
        event = {"file": {"id": "F1", "mimetype": "image/jpeg"}}
        result = extract_slack_files(event)
        self.assertEqual(result, [{"id": "F1", "mimetype": "image/jpeg"}])

    def test_returns_none_when_no_files(self):
        result = extract_slack_files({"text": "hello", "type": "message"})
        self.assertIsNone(result)

    def test_returns_none_for_empty_dict(self):
        self.assertIsNone(extract_slack_files({}))

    def test_prefers_files_array_over_file_singular(self):
        """files와 file 둘 다 있으면 files 우선."""
        event = {
            "files": [{"id": "F1"}, {"id": "F2"}],
            "file":  {"id": "F3"},
        }
        result = extract_slack_files(event)
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]["id"], "F1")

    def test_falls_through_to_file_singular_when_files_is_empty_list(self):
        """files=[] 은 falsy → file 단수로 낙하."""
        event = {"files": [], "file": {"id": "F9"}}
        result = extract_slack_files(event)
        self.assertEqual(result, [{"id": "F9"}])

    def test_returns_none_when_both_absent(self):
        self.assertIsNone(extract_slack_files({"channel_type": "im"}))

    def test_multiple_files_preserved(self):
        imgs = [{"id": f"F{i}"} for i in range(5)]
        result = extract_slack_files({"files": imgs})
        self.assertEqual(result, imgs)


# ─────────────────────────────────────────────────────────────────────────────
# download_slack_file
# ─────────────────────────────────────────────────────────────────────────────

class TestDownloadSlackFile(unittest.TestCase):

    def test_method1_success_returns_image_bytes(self):
        """방법1(Authorization 헤더)으로 PNG 다운로드 성공."""
        with patch("requests.Session.get", return_value=_mock_response(PNG_MAGIC)):
            result = download_slack_file("https://files.slack.com/image.png", "xoxb-token")
        self.assertEqual(result, PNG_MAGIC)

    def test_method1_jpeg_success(self):
        with patch("requests.Session.get", return_value=_mock_response(JPEG_MAGIC)):
            result = download_slack_file("https://files.slack.com/photo.jpg", "xoxb-token")
        self.assertEqual(result, JPEG_MAGIC)

    def test_method1_html_falls_back_to_method2(self):
        """방법1이 HTML 반환 → 방법2(token 쿼리 파라미터)로 폴백."""
        with patch("requests.Session.get", return_value=_mock_response(HTML_PAGE)):
            with patch("requests.get", return_value=_mock_response(PNG_MAGIC)) as mock_get:
                result = download_slack_file("https://files.slack.com/image.png", "xoxb-abc")
        self.assertEqual(result, PNG_MAGIC)
        mock_get.assert_called_once()

    def test_method1_http_error_falls_back_to_method2(self):
        """방법1이 403 → 방법2로 폴백."""
        with patch("requests.Session.get", return_value=_mock_response(b"", status_code=403, ok=False)):
            with patch("requests.get", return_value=_mock_response(JPEG_MAGIC)):
                result = download_slack_file("https://files.slack.com/photo.jpg", "xoxb-token")
        self.assertEqual(result, JPEG_MAGIC)

    def test_both_methods_html_returns_none(self):
        """두 방법 모두 HTML → None 반환."""
        with patch("requests.Session.get", return_value=_mock_response(HTML_PAGE)):
            with patch("requests.get", return_value=_mock_response(HTML_PAGE)):
                result = download_slack_file("https://files.slack.com/image.png", "xoxb-token")
        self.assertIsNone(result)

    def test_both_methods_exception_returns_none(self):
        """두 방법 모두 예외 발생 → None 반환."""
        with patch("requests.Session.get", side_effect=ConnectionError("refused")):
            with patch("requests.get", side_effect=ConnectionError("refused")):
                result = download_slack_file("https://files.slack.com/image.png", "xoxb-token")
        self.assertIsNone(result)

    def test_method2_appends_question_mark_token_to_plain_url(self):
        """쿼리 파라미터 없는 URL에 ?token=... 추가."""
        called_urls: list[str] = []

        def _capture(url, **kwargs):
            called_urls.append(url)
            return _mock_response(PNG_MAGIC)

        with patch("requests.Session.get", return_value=_mock_response(HTML_PAGE)):
            with patch("requests.get", side_effect=_capture):
                download_slack_file("https://files.slack.com/image.png", "xoxb-xyz")

        self.assertTrue(called_urls, "방법2가 호출되지 않음")
        self.assertIn("?token=xoxb-xyz", called_urls[0])

    def test_method2_appends_ampersand_token_when_query_exists(self):
        """기존 쿼리 파라미터가 있으면 &token=... 추가."""
        called_urls: list[str] = []

        def _capture(url, **kwargs):
            called_urls.append(url)
            return _mock_response(PNG_MAGIC)

        with patch("requests.Session.get", return_value=_mock_response(HTML_PAGE)):
            with patch("requests.get", side_effect=_capture):
                download_slack_file("https://files.slack.com/img.png?foo=bar", "xoxb-xyz")

        self.assertTrue(called_urls)
        self.assertIn("&token=xoxb-xyz", called_urls[0])
        self.assertNotIn("?token=", called_urls[0])  # ? 가 두 번 붙지 않아야 함

    def test_log_fn_called_with_status(self):
        """log_fn이 전달되면 상태 로그가 출력되는지 확인."""
        logs: list[str] = []
        with patch("requests.Session.get", return_value=_mock_response(PNG_MAGIC)):
            download_slack_file("https://files.slack.com/img.png", "xoxb-t", log_fn=logs.append)
        self.assertTrue(any("방법1" in msg for msg in logs))

    def test_method1_empty_content_falls_back(self):
        """빈 바이트 응답 → None 취급 → 방법2로 폴백."""
        with patch("requests.Session.get", return_value=_mock_response(b"", ok=True)):
            with patch("requests.get", return_value=_mock_response(PNG_MAGIC)):
                result = download_slack_file("https://files.slack.com/img.png", "xoxb-t")
        self.assertEqual(result, PNG_MAGIC)


# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    unittest.main(verbosity=2)
