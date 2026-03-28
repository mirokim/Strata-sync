"""
test_health.py — Phase 1

Tests for GET /health endpoint.
"""

import pytest


@pytest.mark.asyncio
async def test_health_returns_200(client):
    """Health endpoint always returns HTTP 200."""
    response = await client.get("/health")
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_health_response_shape(client):
    """Health response contains required fields."""
    response = await client.get("/health")
    data = response.json()

    assert data["status"] == "ok"
    assert "version" in data
    assert isinstance(data["chroma_ready"], bool)
