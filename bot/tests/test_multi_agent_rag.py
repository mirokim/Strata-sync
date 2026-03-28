"""
tests/test_multi_agent_rag.py — multi_agent_rag.py 유닛 테스트

실행: python -m pytest bot/tests/ -v
"""
import json
import os
import sys
import tempfile
import time
import threading
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent))

import modules.multi_agent_rag as mar
from modules.multi_agent_rag import (
    _make_checkpoint_key,
    _load_checkpoint,
    _save_checkpoint,
    _clear_stale_checkpoints,
    _analyze_doc,
    SubAgentResult,
)
from modules.rag_simple import RagResult


def _make_rag_result(title: str = "테스트 문서", score: float = 5.0) -> RagResult:
    return {
        "title": title,
        "stem": title.replace(" ", "_").lower(),
        "body": "테스트 본문 내용입니다.",
        "score": score,
        "date": "2026-01-01",
        "tags": [],
        "doc_type": "reference",
    }


def _make_client(response: str = '{"score": 7, "summary": "요약", "key_points": ["포인트1"]}') -> MagicMock:
    client = MagicMock()
    client.complete.return_value = response
    return client


class TestCheckpointKey(unittest.TestCase):
    def test_same_input_same_key(self):
        k1 = _make_checkpoint_key("query", ["a", "b"])
        k2 = _make_checkpoint_key("query", ["a", "b"])
        self.assertEqual(k1, k2)

    def test_order_independent(self):
        """stems 순서가 달라도 같은 키여야 한다 (sorted 적용)."""
        k1 = _make_checkpoint_key("query", ["a", "b", "c"])
        k2 = _make_checkpoint_key("query", ["c", "a", "b"])
        self.assertEqual(k1, k2)

    def test_different_query_different_key(self):
        k1 = _make_checkpoint_key("query1", ["a"])
        k2 = _make_checkpoint_key("query2", ["a"])
        self.assertNotEqual(k1, k2)


class TestCheckpointSaveLoad(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()
        self.orig_dir = mar._CHECKPOINT_DIR
        mar._CHECKPOINT_DIR = self.tmp_dir

    def tearDown(self):
        mar._CHECKPOINT_DIR = self.orig_dir

    def test_save_and_load(self):
        analyses = [
            {"idx": 0, "score": 8.0, "summary": "요약1", "key_points": ["p1"], "doc": _make_rag_result()},
            {"idx": 1, "score": 5.0, "summary": "요약2", "key_points": [],     "doc": _make_rag_result()},
        ]
        _save_checkpoint("testkey", analyses)
        loaded = _load_checkpoint("testkey")
        self.assertEqual(len(loaded), 2)
        self.assertEqual(loaded[0]["score"], 8.0)
        self.assertEqual(loaded[1]["summary"], "요약2")

    def test_load_missing_returns_empty(self):
        self.assertEqual(_load_checkpoint("nonexistent"), [])

    def test_ttl_expired_returns_empty(self):
        analyses = [{"idx": 0, "score": 1.0, "summary": "s", "key_points": [], "doc": _make_rag_result()}]
        _save_checkpoint("expiredkey", analyses)
        # 파일 mtime을 과거로 조작
        path = os.path.join(self.tmp_dir, "expiredkey.json")
        old_time = time.time() - mar._CHECKPOINT_TTL_SECS - 10
        os.utime(path, (old_time, old_time))
        self.assertEqual(_load_checkpoint("expiredkey"), [])

    def test_ttl_valid_returns_data(self):
        analyses = [{"idx": 0, "score": 3.0, "summary": "s", "key_points": [], "doc": _make_rag_result()}]
        _save_checkpoint("validkey", analyses)
        loaded = _load_checkpoint("validkey")
        self.assertEqual(len(loaded), 1)


class TestClearStaleCheckpoints(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()
        self.orig_dir = mar._CHECKPOINT_DIR
        self.orig_max = mar._CHECKPOINT_MAX_MB
        mar._CHECKPOINT_DIR = self.tmp_dir

    def tearDown(self):
        mar._CHECKPOINT_DIR = self.orig_dir
        mar._CHECKPOINT_MAX_MB = self.orig_max

    def test_removes_expired_files(self):
        path = os.path.join(self.tmp_dir, "old.json")
        with open(path, "w") as f:
            json.dump([], f)
        old_time = time.time() - mar._CHECKPOINT_TTL_SECS - 10
        os.utime(path, (old_time, old_time))

        _clear_stale_checkpoints()
        self.assertFalse(os.path.exists(path))

    def test_keeps_fresh_files(self):
        path = os.path.join(self.tmp_dir, "fresh.json")
        with open(path, "w") as f:
            json.dump([], f)
        _clear_stale_checkpoints()
        self.assertTrue(os.path.exists(path))

    def test_lru_removes_oldest_when_over_limit(self):
        """용량 초과 시 오래된 파일부터 삭제."""
        mar._CHECKPOINT_MAX_MB = 0  # 0MB 제한 → 모든 파일 삭제 대상

        paths = []
        for i in range(3):
            p = os.path.join(self.tmp_dir, f"file{i}.json")
            with open(p, "w") as f:
                json.dump({"data": "x" * 100}, f)
            paths.append(p)
            time.sleep(0.01)  # mtime 차이

        _clear_stale_checkpoints()
        # 제한이 0이므로 파일이 남아있지 않아야 함
        remaining = list(Path(self.tmp_dir).glob("*.json"))
        self.assertEqual(len(remaining), 0)


class TestAnalyzeDoc(unittest.TestCase):
    def _run_analyze(self, client, doc=None):
        results: list = []
        lock = threading.Lock()
        doc = doc or _make_rag_result()
        _analyze_doc(client, "테스트 쿼리", doc, 0, results, lock)
        return results

    def test_success_parses_json(self):
        client = _make_client('{"score": 8, "summary": "좋은 문서", "key_points": ["핵심1", "핵심2"]}')
        results = self._run_analyze(client)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["score"], 8.0)
        self.assertEqual(results[0]["summary"], "좋은 문서")
        self.assertEqual(results[0]["key_points"], ["핵심1", "핵심2"])

    def test_json_in_markdown_codeblock(self):
        response = '```json\n{"score": 6, "summary": "요약", "key_points": []}\n```'
        client = _make_client(response)
        results = self._run_analyze(client)
        self.assertEqual(results[0]["score"], 6.0)

    def test_invalid_json_falls_back(self):
        """JSON 파싱 실패 시 원본 score 기반 폴백."""
        client = _make_client("이것은 JSON이 아닙니다")
        doc = _make_rag_result(score=5.0)
        results = self._run_analyze(client, doc)
        self.assertEqual(len(results), 1)
        # 폴백: score * 0.8 = 4.0, summary는 본문 앞 150자
        self.assertAlmostEqual(results[0]["score"], 4.0, places=1)
        self.assertTrue(len(results[0]["summary"]) > 0)

    def test_network_error_retries_and_falls_back(self):
        """네트워크 오류 발생 시 재시도 후 폴백."""
        client = MagicMock()
        client.complete.side_effect = ConnectionError("연결 실패")
        logs = []
        results: list = []
        lock = threading.Lock()
        _analyze_doc(client, "쿼리", _make_rag_result(), 0, results, lock, log_fn=logs.append)
        # 재시도(_MAX_RETRIES=2)까지 complete가 호출됨
        self.assertGreaterEqual(client.complete.call_count, 1)
        # 폴백으로 결과는 존재
        self.assertEqual(len(results), 1)

    def test_thread_safety(self):
        """여러 스레드에서 동시에 실행해도 결과가 올바르게 수집된다."""
        client = _make_client('{"score": 5, "summary": "병렬", "key_points": []}')
        results: list = []
        lock = threading.Lock()
        threads = [
            threading.Thread(
                target=_analyze_doc,
                args=(client, f"쿼리{i}", _make_rag_result(), i, results, lock)
            )
            for i in range(5)
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(len(results), 5)
        idxs = sorted(r["idx"] for r in results)
        self.assertEqual(idxs, [0, 1, 2, 3, 4])


if __name__ == "__main__":
    unittest.main()
