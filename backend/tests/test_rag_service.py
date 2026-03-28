"""
test_rag_service.py — Phase 3

Tests for the LangChain-based chunking logic in rag_service.py.
These are pure unit tests (no HTTP, no ChromaDB).
"""

import pytest
from backend.services.rag_service import prepare_chunks, _chunk_id


# ── _chunk_id ──────────────────────────────────────────────────────────────────


def test_chunk_id_is_deterministic():
    """Same inputs always produce the same chunk ID."""
    id1 = _chunk_id("doc_001", "sec_001", 0)
    id2 = _chunk_id("doc_001", "sec_001", 0)
    assert id1 == id2


def test_chunk_id_differs_by_index():
    """Different indices produce different IDs."""
    id0 = _chunk_id("doc_001", "sec_001", 0)
    id1 = _chunk_id("doc_001", "sec_001", 1)
    assert id0 != id1


# ── prepare_chunks ─────────────────────────────────────────────────────────────


def test_prepare_chunks_returns_at_least_one_per_doc():
    """Each non-empty document produces at least one chunk."""
    docs = [
        {
            "doc_id": "d1",
            "filename": "test.md",
            "section_id": "d1_s1",
            "heading": "헤딩",
            "speaker": "art_director",
            "content": "짧은 내용",
            "tags": ["tag1"],
        }
    ]
    chunks = prepare_chunks(docs)
    assert len(chunks) >= 1


def test_prepare_chunks_skips_empty_content():
    """Documents with empty content produce no chunks."""
    docs = [
        {
            "doc_id": "d1",
            "filename": "empty.md",
            "section_id": "d1_s1",
            "heading": "",
            "speaker": "art_director",
            "content": "   ",  # whitespace only
            "tags": [],
        }
    ]
    chunks = prepare_chunks(docs)
    assert len(chunks) == 0


def test_prepare_chunks_tags_are_comma_joined():
    """Tags list is serialised as a comma-separated string for ChromaDB."""
    docs = [
        {
            "doc_id": "d1",
            "filename": "test.md",
            "section_id": "d1_s1",
            "heading": "H",
            "speaker": "art_director",
            "content": "충분한 내용이 들어있는 문서입니다.",
            "tags": ["alpha", "beta", "gamma"],
        }
    ]
    chunks = prepare_chunks(docs)
    assert len(chunks) >= 1
    assert chunks[0]["tags"] == "alpha,beta,gamma"


def test_prepare_chunks_long_text_splits():
    """A document longer than chunk_size is split into multiple chunks."""
    long_content = "단어 " * 300  # well over default chunk_size=512 chars
    docs = [
        {
            "doc_id": "d1",
            "filename": "long.md",
            "section_id": "d1_s1",
            "heading": "긴 문서",
            "speaker": "prog_director",
            "content": long_content,
            "tags": [],
        }
    ]
    chunks = prepare_chunks(docs)
    assert len(chunks) > 1


def test_prepare_chunks_all_ids_unique():
    """Every generated chunk has a unique ID."""
    docs = [
        {
            "doc_id": f"doc_{i}",
            "filename": f"doc_{i}.md",
            "section_id": f"doc_{i}_s1",
            "heading": f"제목 {i}",
            "speaker": "chief_director",
            "content": f"내용 {i}: " + "테스트 " * 50,
            "tags": [],
        }
        for i in range(5)
    ]
    chunks = prepare_chunks(docs)
    ids = [c["id"] for c in chunks]
    assert len(ids) == len(set(ids)), "Chunk IDs must be unique"
