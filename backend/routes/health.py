"""
health.py — Phase 1

GET /health endpoint for Electron subprocess readiness detection.
The Electron main process watches stdout/stderr for "Application startup complete"
(uvicorn's default startup log), but the frontend can also poll this endpoint.
"""

from fastapi import APIRouter
from backend.models.schemas import HealthResponse
from backend.services.chroma_service import chroma_service

router = APIRouter()

VERSION = "0.1.0"


@router.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    """
    Returns the service status and ChromaDB readiness.
    Always returns HTTP 200 — never raises so Electron health polls don't crash.
    """
    return HealthResponse(
        status="ok",
        version=VERSION,
        chroma_ready=chroma_service.is_ready,
    )
