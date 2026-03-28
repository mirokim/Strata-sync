"""
documents.py — Phase 1-3

Document indexing, searching, and management endpoints.

Endpoints:
    POST   /docs/index   — index (upsert) document chunks into ChromaDB
    DELETE /docs/clear   — delete all chunks from ChromaDB
    POST   /docs/search  — semantic search (RAG retrieval)
    GET    /docs/stats   — collection statistics
"""

from fastapi import APIRouter, HTTPException
from backend.models.schemas import (
    IndexRequest,
    IndexResponse,
    SearchRequest,
    SearchResponse,
    SearchResult,
    ClearResponse,
    StatsResponse,
)
from backend.services.chroma_service import chroma_service
from backend.services.rag_service import prepare_chunks

router = APIRouter(prefix="/docs")


@router.post("/index", response_model=IndexResponse)
async def index_documents(request: IndexRequest) -> IndexResponse:
    """
    Upsert document chunks into ChromaDB.

    The frontend sends flattened sections (one per chunk).
    This endpoint applies LangChain's text splitter and upserts into ChromaDB.
    """
    try:
        chunks = prepare_chunks(request.documents)
        chroma_service.add_chunks(chunks)
        return IndexResponse(indexed=len(chunks))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.delete("/clear", response_model=ClearResponse)
async def clear_documents() -> ClearResponse:
    """Delete all indexed documents from ChromaDB."""
    try:
        chroma_service.clear()
        return ClearResponse(cleared=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/search", response_model=SearchResponse)
async def search_documents(request: SearchRequest) -> SearchResponse:
    """
    Semantic search using the embedded query.

    Returns up to `top_k` results ordered by cosine similarity.
    The frontend (llmClient.ts) filters by score > 0.3 before injecting context.
    """
    try:
        raw = chroma_service.search(request.query, n_results=request.top_k)
        results = [
            SearchResult(
                doc_id=r["doc_id"],
                filename=r["filename"],
                section_id=r.get("section_id"),
                heading=r.get("heading") or None,
                speaker=r.get("speaker", "unknown"),
                content=r["content"],
                score=r["score"],
                # ChromaDB stores tags as comma-separated string → split back
                tags=[t for t in r.get("tags", "").split(",") if t],
            )
            for r in raw
        ]
        return SearchResponse(results=results, query=request.query)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/stats", response_model=StatsResponse)
async def get_stats() -> StatsResponse:
    """Return collection statistics."""
    try:
        return StatsResponse(
            doc_count=chroma_service.unique_doc_count(),
            chunk_count=chroma_service.count(),
            collection_name="vault_documents",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
