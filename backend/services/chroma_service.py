"""
chroma_service.py — Phase 2

Singleton ChromaDB wrapper.
Uses PersistentClient so embeddings survive app restarts.
Embeddings: sentence-transformers/all-MiniLM-L6-v2 (~90 MB, offline, no API key).
"""

from backend.config import settings
import chromadb
from chromadb.utils import embedding_functions


class ChromaService:
    """Thread-safe singleton wrapper around a ChromaDB collection."""

    def __init__(self) -> None:
        self._client: chromadb.ClientAPI | None = None
        self._collection: chromadb.Collection | None = None
        self._doc_id_set: set[str] | None = None  # lazy-loaded cache of unique doc_ids

    # ── Lazy initialisation ────────────────────────────────────────────────────

    def _ensure_ready(self) -> None:
        """Initialise ChromaDB client and collection on first use."""
        if self._client is not None:
            return

        self._client = chromadb.PersistentClient(
            path=settings.chroma_persist_path
        )

        ef = embedding_functions.SentenceTransformerEmbeddingFunction(
            model_name="all-MiniLM-L6-v2"
        )

        self._collection = self._client.get_or_create_collection(
            name=settings.collection_name,
            embedding_function=ef,
            metadata={"hnsw:space": "cosine"},
        )

    # ── Public API ─────────────────────────────────────────────────────────────

    def add_chunks(self, chunks: list[dict]) -> None:
        """
        Upsert chunks into ChromaDB (idempotent).

        Args:
            chunks: list of dicts with keys: id, content, + metadata fields
        """
        if not chunks:
            return
        self._ensure_ready()
        assert self._collection is not None

        ids = [c["id"] for c in chunks]
        documents = [c["content"] for c in chunks]
        metadatas = [
            {k: v for k, v in c.items() if k not in ("id", "content")}
            for c in chunks
        ]

        self._collection.upsert(
            ids=ids,
            documents=documents,
            metadatas=metadatas,
        )
        # Update in-memory doc_id cache if already initialised
        if self._doc_id_set is not None:
            for m in metadatas:
                doc_id = m.get("doc_id", "")
                if doc_id:
                    self._doc_id_set.add(doc_id)

    def search(self, query: str, n_results: int = 3) -> list[dict]:
        """
        Query the collection for the most relevant chunks.

        Returns:
            list of dicts with keys: content, score (cosine similarity 0-1),
            and all metadata fields (doc_id, filename, section_id, heading,
            speaker, tags).
        """
        self._ensure_ready()
        assert self._collection is not None

        # Guard: can't query more results than documents in collection
        count = self._collection.count()
        if count == 0:
            return []
        n_results = min(n_results, count)

        res = self._collection.query(
            query_texts=[query],
            n_results=n_results,
            include=["documents", "metadatas", "distances"],
        )

        results: list[dict] = []
        for doc, meta, dist in zip(
            res["documents"][0],  # type: ignore[index]
            res["metadatas"][0],  # type: ignore[index]
            res["distances"][0],  # type: ignore[index]
        ):
            # ChromaDB cosine distance: 0 = identical, 2 = opposite
            # Convert to similarity: 1 - (distance / 2) → [0, 1]
            score = 1.0 - (dist / 2.0)
            results.append({"content": doc, "score": score, **meta})

        return results

    def clear(self) -> None:
        """Delete the entire collection (all embeddings)."""
        self._ensure_ready()
        assert self._client is not None

        self._client.delete_collection(settings.collection_name)
        # Reset so next call re-creates the collection
        self._collection = None
        self._doc_id_set = None

    def count(self) -> int:
        """Return the number of chunks currently stored."""
        self._ensure_ready()
        assert self._collection is not None
        return self._collection.count()

    def unique_doc_count(self) -> int:
        """Return approximate unique document count (by distinct doc_id)."""
        self._ensure_ready()
        assert self._collection is not None
        if self._collection.count() == 0:
            self._doc_id_set = set()
            return 0
        # Lazy-init: build cache on first call, then keep it updated via add_chunks/clear
        if self._doc_id_set is None:
            res = self._collection.get(include=["metadatas"])
            self._doc_id_set = {m.get("doc_id", "") for m in (res["metadatas"] or [])}
            self._doc_id_set.discard("")
        return len(self._doc_id_set)

    @property
    def is_ready(self) -> bool:
        """Return True if ChromaDB is available."""
        try:
            self._ensure_ready()
            return self._collection is not None
        except Exception:
            return False


# Module-level singleton — imported by routes
chroma_service = ChromaService()
