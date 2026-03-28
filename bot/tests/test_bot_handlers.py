"""
tests/test_bot_handlers.py — SlackBotRunner event handler logic unit tests

Verifies filter logic and history key format for handle_dm / handle_mention.
Tests extracted inline logic without importing all of bot.py.

Run: python -m pytest bot/tests/ -v
"""
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock

sys.path.insert(0, str(Path(__file__).parent.parent))

from modules.slack_utils import extract_slack_files


# ─────────────────────────────────────────────────────────────────────────────
# handle_dm 필터 로직 (bot.py의 handle_dm 조건 추출)
# ─────────────────────────────────────────────────────────────────────────────

def _dm_should_process(event: dict) -> bool:
    """handle_dm filter conditions — needs to stay in sync with bot.py."""
    if event.get("channel_type") != "im":
        return False
    subtype = event.get("subtype")
    if event.get("bot_id") or (subtype and subtype != "file_share"):
        return False
    return True


class TestHandleDmFilter(unittest.TestCase):

    def test_normal_dm_passes(self):
        self.assertTrue(_dm_should_process({"channel_type": "im", "text": "안녕"}))

    def test_non_im_channel_filtered(self):
        self.assertFalse(_dm_should_process({"channel_type": "channel", "text": "hello"}))

    def test_missing_channel_type_filtered(self):
        self.assertFalse(_dm_should_process({"text": "hello"}))

    def test_bot_message_filtered(self):
        self.assertFalse(_dm_should_process({"channel_type": "im", "bot_id": "B123"}))

    def test_file_share_subtype_passes(self):
        self.assertTrue(_dm_should_process({
            "channel_type": "im",
            "subtype": "file_share",
            "files": [{"id": "F1"}],
        }))

    def test_message_changed_subtype_filtered(self):
        self.assertFalse(_dm_should_process({
            "channel_type": "im",
            "subtype": "message_changed",
        }))

    def test_message_deleted_subtype_filtered(self):
        self.assertFalse(_dm_should_process({
            "channel_type": "im",
            "subtype": "message_deleted",
        }))

    def test_none_subtype_passes(self):
        """subtype=None is a normal message."""
        self.assertTrue(_dm_should_process({"channel_type": "im", "subtype": None}))

    def test_bot_id_with_file_share_still_filtered(self):
        """Files uploaded by the bot itself should not be processed."""
        self.assertFalse(_dm_should_process({
            "channel_type": "im",
            "bot_id": "B123",
            "subtype": "file_share",
        }))


# ─────────────────────────────────────────────────────────────────────────────
# History Key Format
# ─────────────────────────────────────────────────────────────────────────────

class TestConvHistoryKey(unittest.TestCase):

    def _make_key(self, channel: str, thread_ts: str | None) -> str:
        return f"{channel}:{thread_ts or 'dm'}"

    def test_dm_key_uses_dm_suffix(self):
        self.assertEqual(self._make_key("D12345", None), "D12345:dm")

    def test_thread_key_uses_thread_ts(self):
        self.assertEqual(
            self._make_key("C12345", "1711234567.123456"),
            "C12345:1711234567.123456",
        )

    def test_empty_thread_ts_treated_as_dm(self):
        self.assertEqual(self._make_key("D99999", ""), "D99999:dm")

    def test_different_channels_produce_different_keys(self):
        k1 = self._make_key("D111", None)
        k2 = self._make_key("D222", None)
        self.assertNotEqual(k1, k2)

    def test_same_channel_different_thread_produces_different_keys(self):
        k1 = self._make_key("C999", "100.0")
        k2 = self._make_key("C999", "200.0")
        self.assertNotEqual(k1, k2)


# ─────────────────────────────────────────────────────────────────────────────
# _conv_history management (memory leak prevention logic)
# ─────────────────────────────────────────────────────────────────────────────

class TestConvHistoryManagement(unittest.TestCase):

    def _apply_history_update(
        self,
        conv_history: dict,
        hist_key: str,
        history: list,
        query: str,
        answer: str,
        max_keys: int = 1000,
    ) -> None:
        """Extracted history update logic from bot.py."""
        conv_history[hist_key] = (history + [
            {"role": "user",      "content": query},
            {"role": "assistant", "content": answer},
        ])[-40:]
        if len(conv_history) > max_keys:
            for old_key in list(conv_history)[:len(conv_history) - max_keys]:
                del conv_history[old_key]

    def test_history_grows_to_40_messages(self):
        h = {}
        history: list = []
        for i in range(25):
            self._apply_history_update(h, "k", history, f"q{i}", f"a{i}")
            history = h["k"]
        self.assertLessEqual(len(h["k"]), 40)

    def test_history_truncated_at_40(self):
        h = {}
        history: list = []
        for i in range(30):  # 30턴 = 60 메시지 → 40으로 truncate
            self._apply_history_update(h, "k", history, f"q{i}", f"a{i}")
            history = h["k"]
        self.assertEqual(len(h["k"]), 40)

    def test_old_keys_evicted_at_max(self):
        h = {}
        max_k = 5
        for i in range(7):
            self._apply_history_update(h, f"key:{i}", [], "q", "a", max_keys=max_k)
        self.assertLessEqual(len(h), max_k)

    def test_most_recent_keys_kept_after_eviction(self):
        h = {}
        max_k = 3
        for i in range(5):
            self._apply_history_update(h, f"key:{i}", [], "q", "a", max_keys=max_k)
        # Most recent keys should be preserved
        self.assertIn("key:4", h)
        self.assertIn("key:3", h)
        self.assertIn("key:2", h)

    def test_no_eviction_below_max(self):
        h = {}
        for i in range(5):
            self._apply_history_update(h, f"key:{i}", [], "q", "a", max_keys=10)
        self.assertEqual(len(h), 5)


# ─────────────────────────────────────────────────────────────────────────────
# respond()의 image_files 필터 (mimetype 확인)
# ─────────────────────────────────────────────────────────────────────────────

class TestImageFilesFilter(unittest.TestCase):

    def _get_image_files(self, files: list) -> list:
        """Extracted image_files filter from respond()."""
        return [f for f in (files or []) if f.get("mimetype", "").startswith("image/")]

    def test_png_included(self):
        files = [{"mimetype": "image/png", "id": "F1"}]
        self.assertEqual(len(self._get_image_files(files)), 1)

    def test_jpeg_included(self):
        files = [{"mimetype": "image/jpeg", "id": "F1"}]
        self.assertEqual(len(self._get_image_files(files)), 1)

    def test_pdf_excluded(self):
        files = [{"mimetype": "application/pdf", "id": "F1"}]
        self.assertEqual(self._get_image_files(files), [])

    def test_mixed_keeps_only_images(self):
        files = [
            {"mimetype": "image/png",        "id": "F1"},
            {"mimetype": "application/pdf",  "id": "F2"},
            {"mimetype": "image/gif",        "id": "F3"},
            {"mimetype": "text/plain",       "id": "F4"},
        ]
        result = self._get_image_files(files)
        self.assertEqual(len(result), 2)
        ids = [f["id"] for f in result]
        self.assertIn("F1", ids)
        self.assertIn("F3", ids)

    def test_none_files_returns_empty(self):
        self.assertEqual(self._get_image_files(None), [])

    def test_missing_mimetype_excluded(self):
        files = [{"id": "F1"}]  # mimetype 없음
        self.assertEqual(self._get_image_files(files), [])


# ─────────────────────────────────────────────────────────────────────────────
# Image Request Detection Logic
# ─────────────────────────────────────────────────────────────────────────────

_IMAGE_KEYWORDS = ["이미지 보여줘", "이미지 있어", "사진 보여줘", "이미지 주세요", "이미지 검색", "사진 검색"]


def _is_image_request(query: str) -> tuple[bool, str]:
    """Image request detection + search term extraction logic from bot.py (needs sync with bot.py)."""
    is_req = any(kw in query for kw in _IMAGE_KEYWORDS)
    if not is_req:
        return False, query
    img_query = query
    for kw in _IMAGE_KEYWORDS:
        img_query = img_query.replace(kw, "").strip()
    return True, img_query or query


class TestImageRequestDetection(unittest.TestCase):

    def test_이미지_보여줘_detected(self):
        is_req, term = _is_image_request("캐릭터A 이미지 보여줘")
        self.assertTrue(is_req)
        self.assertEqual(term, "캐릭터A")

    def test_이미지_있어_detected(self):
        is_req, term = _is_image_request("이미지 있어 아트워크")
        self.assertTrue(is_req)
        self.assertEqual(term, "아트워크")

    def test_사진_보여줘_detected(self):
        is_req, term = _is_image_request("사진 보여줘")
        self.assertTrue(is_req)

    def test_이미지_검색_detected(self):
        is_req, term = _is_image_request("이미지 검색 배경")
        self.assertTrue(is_req)
        self.assertEqual(term, "배경")

    def test_normal_query_not_detected(self):
        is_req, _ = _is_image_request("캐릭터A가 어떻게 생겼어?")
        self.assertFalse(is_req)

    def test_term_falls_back_to_full_query_when_only_keyword(self):
        """Returns original query when only keyword is present with no other text."""
        is_req, term = _is_image_request("이미지 보여줘")
        self.assertTrue(is_req)
        self.assertEqual(term, "이미지 보여줘")  # Original returned

    def test_multiple_keywords_stripped(self):
        is_req, term = _is_image_request("이미지 보여줘 캐릭터B 이미지 있어")
        self.assertTrue(is_req)
        self.assertEqual(term, "캐릭터B")


# ─────────────────────────────────────────────────────────────────────────────
# _upload_images_to_slack 업로드 로직
# ─────────────────────────────────────────────────────────────────────────────

class TestUploadImagesToSlack(unittest.TestCase):
    """Directly test core logic of _upload_images_to_slack."""

    def _make_web_client(self, upload_url="https://files.slack.com/upload/v1/abc"):
        """Mock WebClient that succeeds on upload."""
        web = MagicMock()
        web.files_getUploadURLExternal.return_value = {
            "upload_url": upload_url,
            "file_id": "F_TEST_001",
        }
        web.files_completeUploadExternal.return_value = {"ok": True}
        return web

    def _upload(self, web, image_paths, channel="C123", thread_ts=None):
        """Inline _upload_images_to_slack logic (needs sync with bot.py)."""
        import os
        uploaded = 0
        for path in image_paths[:3]:
            try:
                with open(path, "rb") as f:
                    content = f.read()
                filename = os.path.basename(path)
                resp = web.files_getUploadURLExternal(filename=filename, length=len(content))
                upload_url = resp["upload_url"]
                file_id = resp["file_id"]
                # requests.post replaced by mock (no actual HTTP requests)
                kw: dict = {"files": [{"id": file_id, "title": filename}], "channel_id": channel}
                if thread_ts:
                    kw["thread_ts"] = thread_ts
                web.files_completeUploadExternal(**kw)
                uploaded += 1
            except Exception:
                pass
        return uploaded

    def test_uploads_single_image(self):
        import tempfile, os
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            f.write(b"\x89PNG\r\n\x1a\n" + b"\x00" * 100)
            tmp = f.name
        try:
            web = self._make_web_client()
            n = self._upload(web, [tmp], channel="C123")
            self.assertEqual(n, 1)
            web.files_getUploadURLExternal.assert_called_once()
            web.files_completeUploadExternal.assert_called_once()
        finally:
            os.unlink(tmp)

    def test_limits_to_3_images(self):
        import tempfile, os
        tmps = []
        for _ in range(5):
            f = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
            f.write(b"\x89PNG\r\n\x1a\n" + b"\x00" * 10)
            f.close()
            tmps.append(f.name)
        try:
            web = self._make_web_client()
            n = self._upload(web, tmps)
            self.assertEqual(n, 3)
            self.assertEqual(web.files_getUploadURLExternal.call_count, 3)
        finally:
            for p in tmps:
                os.unlink(p)

    def test_thread_ts_passed_to_complete(self):
        import tempfile, os
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            f.write(b"\x89PNG\r\n\x1a\n" + b"\x00" * 10)
            tmp = f.name
        try:
            web = self._make_web_client()
            self._upload(web, [tmp], thread_ts="1711234567.001")
            call_kwargs = web.files_completeUploadExternal.call_args.kwargs
            self.assertEqual(call_kwargs.get("thread_ts"), "1711234567.001")
        finally:
            os.unlink(tmp)

    def test_no_thread_ts_when_none(self):
        import tempfile, os
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            f.write(b"\x89PNG\r\n\x1a\n" + b"\x00" * 10)
            tmp = f.name
        try:
            web = self._make_web_client()
            self._upload(web, [tmp], thread_ts=None)
            call_kwargs = web.files_completeUploadExternal.call_args.kwargs
            self.assertNotIn("thread_ts", call_kwargs)
        finally:
            os.unlink(tmp)

    def test_missing_file_skipped_gracefully(self):
        web = self._make_web_client()
        n = self._upload(web, ["/nonexistent/path/image.png"])
        self.assertEqual(n, 0)
        web.files_getUploadURLExternal.assert_not_called()

    def test_empty_list_returns_zero(self):
        web = self._make_web_client()
        n = self._upload(web, [])
        self.assertEqual(n, 0)


# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    unittest.main(verbosity=2)
