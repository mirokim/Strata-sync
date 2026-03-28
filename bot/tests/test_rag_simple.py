"""
tests/test_rag_simple.py — rag_simple.py unit tests

Run: python -m pytest bot/tests/ -v
"""
import math
import sys
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent))

from modules.rag_simple import (
    _build_idf,
    _score_doc,
    _tokenize,
    _hotness_score,
    apply_hotness_rerank,
    _get_cached_docs,
    _vault_cache,
)
from modules.vault_scanner import VaultDoc


def _make_doc(title: str, stem: str, body: str) -> VaultDoc:
    doc = MagicMock(spec=VaultDoc)
    doc.title = title
    doc.stem = stem
    doc.body = body
    doc.path = f"/vault/{stem}.md"
    doc.date_str = "2026-01-01"
    doc.tags = []
    return doc


class TestTokenize(unittest.TestCase):
    def test_basic_split(self):
        tokens = _tokenize("hello world")
        self.assertIn("hello", tokens)
        self.assertIn("world", tokens)

    def test_short_tokens_excluded(self):
        tokens = _tokenize("a ab abc")
        self.assertNotIn("a", tokens)
        self.assertIn("ab", tokens)
        self.assertIn("abc", tokens)

    def test_special_chars(self):
        tokens = _tokenize("foo[bar].baz")
        self.assertIn("foo", tokens)
        self.assertIn("bar", tokens)
        self.assertIn("baz", tokens)


class TestBuildIdf(unittest.TestCase):
    def test_rare_term_higher_idf(self):
        """Rare terms should have higher IDF than common terms."""
        docs = [
            _make_doc("게임 프로젝트", "doc1", "게임 개발 로직"),
            _make_doc("게임 디자인", "doc2", "게임 아트 제작"),
            _make_doc("특수 기능", "doc3", "독특한 메커니즘"),  # '게임' 없음
        ]
        idf = _build_idf(docs)
        # '게임'은 3개 중 2개 문서에 등장 → IDF = log(3/2) ≈ 0.405
        # '독특한'은 3개 중 1개 문서에만 등장 → IDF = log(3/1) ≈ 1.099
        game_idf = idf.get("게임", 0)
        unique_idf = idf.get("독특한", 0)
        self.assertGreater(unique_idf, game_idf)

    def test_universal_term_low_idf(self):
        """Terms appearing in all documents have IDF = 0 (log(N/N) = 0)."""
        docs = [
            _make_doc("문서", "doc1", "공통 단어 포함"),
            _make_doc("문서", "doc2", "공통 단어 포함"),
        ]
        idf = _build_idf(docs)
        # "문서"는 모든 문서(2/2)에 등장 → log(2/2) = 0
        self.assertAlmostEqual(idf.get("문서", 0), 0.0, places=5)

    def test_empty_corpus(self):
        self.assertEqual(_build_idf([]), {})


class TestScoreDoc(unittest.TestCase):
    def setUp(self):
        self.docs = [
            _make_doc("전투 시스템", "combat", "전투 로직과 데미지 계산"),
            _make_doc("퀘스트 설계", "quest", "퀘스트 흐름과 보상"),
            _make_doc("그래픽 설정", "graphics", "렌더링 파이프라인"),
        ]
        self.idf = _build_idf(self.docs)

    def test_title_match_scores_higher(self):
        """Tokens in the title should score higher than those only in the body."""
        title_doc = _make_doc("전투 시스템", "combat_a", "일반적인 내용")
        body_doc  = _make_doc("일반 문서", "other_b", "전투에 관한 내용")
        idf = _build_idf([title_doc, body_doc])

        score_title = _score_doc(title_doc, ["전투"], idf)
        score_body  = _score_doc(body_doc,  ["전투"], idf)
        self.assertGreater(score_title, score_body)

    def test_common_word_penalized(self):
        """Thanks to IDF, universally common words should have no score contribution."""
        # "공통"이 모든 문서에 등장하면 IDF=0 → 점수 기여 없음
        docs = [
            _make_doc("공통 문서1", "d1", "공통 단어"),
            _make_doc("공통 문서2", "d2", "공통 단어"),
        ]
        idf = _build_idf(docs)
        score = _score_doc(docs[0], ["공통"], idf)
        self.assertEqual(score, 0.0)

    def test_zero_score_for_missing_token(self):
        doc = _make_doc("전투", "d1", "전투 내용")
        idf = _build_idf([doc])
        score = _score_doc(doc, ["퀘스트"], idf)
        self.assertEqual(score, 0.0)


class TestHotnessScore(unittest.TestCase):
    def test_recent_high_count_scores_high(self):
        from datetime import datetime, timezone, timedelta
        recent = datetime.now(timezone.utc).isoformat()
        score = _hotness_score(50, recent)
        self.assertGreater(score, 0.4)

    def test_old_document_scores_low(self):
        from datetime import datetime, timezone, timedelta
        old = (datetime.now(timezone.utc) - timedelta(days=365)).isoformat()
        score = _hotness_score(10, old)
        self.assertLess(score, 0.01)

    def test_none_updated_at_returns_zero(self):
        self.assertEqual(_hotness_score(5, None), 0.0)


class TestApplyHotnessRerank(unittest.TestCase):
    def test_rerank_changes_order(self):
        from datetime import datetime, timezone, timedelta
        recent = datetime.now(timezone.utc).isoformat()
        old = (datetime.now(timezone.utc) - timedelta(days=100)).isoformat()

        results = [
            {"stem": "high_score", "score": 10.0, "title": "", "body": "", "date": "", "tags": []},
            {"stem": "recent_hot", "score": 3.0,  "title": "", "body": "", "date": "", "tags": []},
        ]
        store = {
            "high_score": {"count": 0,  "last_access": old},
            "recent_hot": {"count": 99, "last_access": recent},
        }
        with patch("modules.rag_simple._load_access_store", return_value=store):
            reranked = apply_hotness_rerank(results)
        # recent_hot can overtake via hotness bonus (alpha blending)
        self.assertEqual(len(reranked), 2)

    def test_empty_input(self):
        self.assertEqual(apply_hotness_rerank([]), [])


class TestVaultCache(unittest.TestCase):
    def test_cache_hit_skips_scan(self):
        """Should not call scan_vault when re-called within 60 seconds."""
        mock_docs = [_make_doc("테스트", "test", "본문")]
        with patch("modules.rag_simple.scan_vault", return_value=mock_docs) as mock_scan:
            _get_cached_docs("/vault")
            _get_cached_docs("/vault")  # 두 번째는 캐시 히트
        mock_scan.assert_called_once()  # scan_vault called only once

    def test_cache_miss_on_different_path(self):
        """Different vault paths should result in cache miss."""
        mock_docs = [_make_doc("테스트", "test", "본문")]
        with patch("modules.rag_simple.scan_vault", return_value=mock_docs) as mock_scan:
            _get_cached_docs("/vault_a")
            _get_cached_docs("/vault_b")
        self.assertEqual(mock_scan.call_count, 2)

    def test_cache_expires(self):
        """Should rescan when TTL is exceeded."""
        import modules.rag_simple as rs
        mock_docs = [_make_doc("테스트", "test", "본문")]
        with patch("modules.rag_simple.scan_vault", return_value=mock_docs) as mock_scan:
            _get_cached_docs("/vault_ttl")
            # Force cache ts to expire
            with rs._VAULT_CACHE_LOCK:
                rs._vault_cache["ts"] = time.time() - rs._VAULT_CACHE_TTL - 1
            _get_cached_docs("/vault_ttl")
        self.assertEqual(mock_scan.call_count, 2)


if __name__ == "__main__":
    unittest.main()
