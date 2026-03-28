"""
main.py — Phase 1

FastAPI application entry point.

Startup sequence:
    1. Electron spawns: python -m uvicorn backend.main:app --host 127.0.0.1 --port 8765
    2. Uvicorn logs "Application startup complete" → Electron sets backendReady = true
    3. Frontend receives 'backend:ready' IPC event → window.backendAPI becomes usable

CORS: allow_origins=["*"] so the Electron file:// origin and Vite dev server both work.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.routes.health import router as health_router
from backend.routes.documents import router as documents_router

app = FastAPI(
    title="Strata Sync Backend",
    description="FastAPI + ChromaDB + LangChain RAG server for Strata Sync",
    version="0.1.0",
)

# ── CORS ──────────────────────────────────────────────────────────────────────

app.add_middleware(
    CORSMiddleware,
    # Allow only localhost origins: Electron file://, Vite dev server, and any localhost port
    allow_origin_regex=r"^(file://|https?://localhost(:\d+)?|https?://127\.0\.0\.1(:\d+)?)$",
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

# ── Routers ───────────────────────────────────────────────────────────────────

app.include_router(health_router)
app.include_router(documents_router)
