"""
rag_service.py — Phase 3

LangChain RecursiveCharacterTextSplitter-based chunking.
Converts incoming DocumentChunk objects into ChromaDB-ready flat dicts.
"""

from langchain_text_splitters import RecursiveCharacterTextSplitter
from backend.config import settings
import hashlib


def _chunk_id(doc_id: str, section_id: str, idx: int) -> str:
    """Generate a stable, deterministic chunk ID using MD5."""
    raw = f"{doc_id}::{section_id}::{idx}"
    return hashlib.md5(raw.encode("utf-8")).hexdigest()


# Module-level singleton — avoids re-initialising LangChain splitter on every call
_splitter = RecursiveCharacterTextSplitter(
    chunk_size=settings.chunk_size,
    chunk_overlap=settings.chunk_overlap,
    separators=["\n\n", "\n", "。", ". ", " ", ""],
)


def prepare_chunks(documents: list) -> list[dict]:
    """
    Split each DocumentChunk into sub-chunks using LangChain's
    RecursiveCharacterTextSplitter, then flatten into ChromaDB-ready dicts.

    ChromaDB metadata values must be scalar (str | int | float | bool).
    Lists are joined as comma-separated strings.

    Args:
        documents: list of DocumentChunk Pydantic models (or dicts with same fields)

    Returns:
        list of dicts with keys: id, content, doc_id, filename, section_id,
        heading, speaker, tags (comma-sep string)
    """
    splitter = _splitter

    output: list[dict] = []

    for doc in documents:
        # Support both Pydantic models and plain dicts
        if hasattr(doc, "model_dump"):
            d = doc.model_dump()
        else:
            d = dict(doc)

        content = d.get("content", "").strip()
        if not content:
            continue

        section_id = d.get("section_id") or d.get("doc_id", "")
        sub_chunks = splitter.split_text(content)

        for idx, text in enumerate(sub_chunks):
            output.append(
                {
                    "id": _chunk_id(d["doc_id"], section_id, idx),
                    "content": text,
                    "doc_id": d["doc_id"],
                    "filename": d["filename"],
                    "section_id": section_id,
                    "heading": d.get("heading") or "",
                    "speaker": d.get("speaker", "unknown"),
                    # ChromaDB metadata must be scalar — flatten list to string
                    "tags": ",".join(d.get("tags", [])),
                }
            )

    return output
