"""
config.py — Phase 1-3

Centralised settings for the FastAPI backend.
All values can be overridden via environment variables (STRATA_SYNC_* prefix).
"""

from pydantic_settings import BaseSettings
import os


class Settings(BaseSettings):
    host: str = "127.0.0.1"
    port: int = 8765

    # ChromaDB persistent storage (survives app restarts → no re-embedding needed)
    chroma_persist_path: str = os.path.join(
        os.path.expanduser("~"), ".strata-sync", "chroma"
    )
    collection_name: str = "vault_documents"

    # LangChain text splitter
    chunk_size: int = 512
    chunk_overlap: int = 64

    # RAG retrieval
    top_k: int = 3

    model_config = {"env_prefix": "STRATA_SYNC_"}


settings = Settings()
