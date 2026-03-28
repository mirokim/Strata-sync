"""
conftest.py — pytest fixtures for backend tests

Uses an in-memory (ephemeral) ChromaDB client so tests are fully isolated
from the production ~/.strata-sync/chroma database and from each other.
"""

import pytest
from httpx import AsyncClient, ASGITransport
from unittest.mock import patch, MagicMock
import chromadb
from chromadb.utils import embedding_functions


# ── Ephemeral ChromaDB fixture ─────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def isolated_chroma(monkeypatch):
    """
    Replace ChromaService's _ensure_ready() with an in-memory (EphemeralClient)
    backed by a deterministic embedding function so no model download is needed.

    autouse=True → applied to every test automatically.
    """
    from backend.services import chroma_service as cs_module

    # Fresh service instance per test
    from backend.services.chroma_service import ChromaService
    fresh_service = ChromaService()

    # Patch _ensure_ready to use EphemeralClient + DeterministicEF
    def _mock_ensure_ready(self):
        if self._client is not None:
            return
        self._client = chromadb.EphemeralClient()
        ef = embedding_functions.DefaultEmbeddingFunction()
        self._collection = self._client.get_or_create_collection(
            name="test_vault_documents",
            embedding_function=ef,
            metadata={"hnsw:space": "cosine"},
        )

    fresh_service._ensure_ready = lambda: _mock_ensure_ready(fresh_service)

    # Patch the module-level singleton used by routes
    monkeypatch.setattr(cs_module, "chroma_service", fresh_service)

    # Also patch the import inside documents route
    from backend.routes import documents as doc_route
    monkeypatch.setattr(doc_route, "chroma_service", fresh_service)

    # And health route
    from backend.routes import health as health_route
    monkeypatch.setattr(health_route, "chroma_service", fresh_service)

    return fresh_service


# ── Async HTTP client fixture ──────────────────────────────────────────────────


@pytest.fixture
async def client():
    """Async HTTPX client that talks to the FastAPI app in-process."""
    from backend.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


# ── Sample document chunks ─────────────────────────────────────────────────────


@pytest.fixture
def sample_chunks():
    """A small set of DocumentChunk payloads for indexing tests."""
    return [
        {
            "doc_id": "art_001",
            "filename": "art_concept.md",
            "section_id": "art_001_intro",
            "heading": "아트 컨셉",
            "speaker": "art_director",
            "content": "게임의 비주얼 방향성은 다크 판타지 스타일로 설정합니다. 채도를 낮추고 대비를 높여 긴장감을 표현합니다.",
            "tags": ["art", "concept"],
        },
        {
            "doc_id": "prog_001",
            "filename": "tech_stack.md",
            "section_id": "prog_001_engine",
            "heading": "엔진 선택",
            "speaker": "prog_director",
            "content": "언리얼 엔진 5를 채택하여 나나이트와 루멘을 활용합니다. 렌더링 퀄리티와 개발 효율성을 동시에 확보합니다.",
            "tags": ["tech", "engine"],
        },
        {
            "doc_id": "plan_001",
            "filename": "schedule.md",
            "section_id": "plan_001_milestone",
            "heading": "마일스톤",
            "speaker": "plan_director",
            "content": "알파 빌드는 6개월 후, 베타는 12개월 후를 목표로 합니다. 주간 스프린트로 진행합니다.",
            "tags": ["plan", "schedule"],
        },
    ]
