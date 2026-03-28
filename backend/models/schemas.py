"""
schemas.py — Phase 1-3

Pydantic v2 request/response models for the FastAPI endpoints.
"""

from pydantic import BaseModel
from typing import Optional


# ── Inbound (from TypeScript frontend) ───────────────────────────────────────


class DocumentChunk(BaseModel):
    """A single document section chunk sent by the frontend for indexing."""

    doc_id: str
    filename: str
    section_id: Optional[str] = None
    heading: Optional[str] = None
    speaker: str
    content: str
    tags: list[str] = []


class IndexRequest(BaseModel):
    """POST /docs/index payload."""

    documents: list[DocumentChunk]


class SearchRequest(BaseModel):
    """POST /docs/search payload."""

    query: str
    top_k: int = 3


# ── Outbound (to TypeScript frontend) ─────────────────────────────────────────


class SearchResult(BaseModel):
    """A single search result returned by ChromaDB."""

    doc_id: str
    filename: str
    section_id: Optional[str] = None
    heading: Optional[str] = None
    speaker: str
    content: str
    score: float
    tags: list[str] = []


class SearchResponse(BaseModel):
    """POST /docs/search response."""

    results: list[SearchResult]
    query: str


class IndexResponse(BaseModel):
    """POST /docs/index response."""

    indexed: int


class ClearResponse(BaseModel):
    """DELETE /docs/clear response."""

    cleared: bool


class StatsResponse(BaseModel):
    """GET /docs/stats response."""

    doc_count: int
    chunk_count: int
    collection_name: str


class HealthResponse(BaseModel):
    """GET /health response."""

    status: str
    version: str
    chroma_ready: bool
