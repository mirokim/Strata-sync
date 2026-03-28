"""
rag_simple.py — Simple keyword RAG for the Slack bot
"""
import json
import logging
import math
import os
import re
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, TypedDict
from .vault_scanner import scan_vault, find_active_folders, VaultDoc
from .paths import VAULT_ACCESS_PATH

logger = logging.getLogger(__name__)


class RagResult(TypedDict):
    title: str
    stem: str
    body: str
    score: float
    date: str
    tags: list[str]
    doc_type: str   # VaultDoc.doc_type — "reference" | "daily" | etc.

# ── scan_vault memory cache (TTL 60s) ─────────────────────────────────────────
# Prevents full .md parsing on every search. Returns cache for same vault within 60s.
_vault_cache: dict = {}
_VAULT_CACHE_TTL = 60.0
_VAULT_CACHE_LOCK = threading.Lock()


def _get_cached_docs(vault_path: str) -> list[VaultDoc]:
    now = time.time()
    with _VAULT_CACHE_LOCK:
        if (_vault_cache.get("path") == vault_path
                and now - _vault_cache.get("ts", 0.0) < _VAULT_CACHE_TTL):
            return _vault_cache["docs"]
    docs = scan_vault(vault_path)
    with _VAULT_CACHE_LOCK:
        _vault_cache.update({"path": vault_path, "docs": docs, "ts": time.time()})
    return docs


# ── Hot Score (based on OpenViking memory_lifecycle) ──────────────────────────
# Gives bonus to frequently/recently accessed documents for search result reranking.
# Formula: sigmoid(log1p(access_count)) × exp(-decay × days_elapsed)

_HOTNESS_HALF_LIFE_DAYS: float = 7.0
_HOTNESS_ALPHA: float = 0.15  # 검색점수 85% + 핫스코어 15%
_ACCESS_STORE_PATH = VAULT_ACCESS_PATH
_ACCESS_STORE_LOCK = threading.Lock()  # 동시 read-modify-write 보호


def _load_access_store() -> dict:
    try:
        with open(_ACCESS_STORE_PATH, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _save_access_store(store: dict) -> None:
    try:
        os.makedirs(os.path.dirname(_ACCESS_STORE_PATH), exist_ok=True)
        tmp_path = _ACCESS_STORE_PATH + ".tmp"
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(store, f, ensure_ascii=False)
        os.replace(tmp_path, _ACCESS_STORE_PATH)  # atomic rename — concurrent write 안전
    except PermissionError:
        logger.error("Permission error: failed to write vault_access.json (%s)", _ACCESS_STORE_PATH)
    except OSError as e:
        logger.error("File system error: failed to save vault_access.json: %s", e)
    except Exception:
        logger.exception("Unexpected error: _save_access_store")


def record_doc_access(stems: list[str]) -> None:
    """Record access counts for document stems returned in search results."""
    # stems: vault-relative 파일명 (확장자 없음)
    if not stems:
        return
    with _ACCESS_STORE_LOCK:
        store = _load_access_store()
        now_iso = datetime.now(timezone.utc).isoformat()
        for stem in stems:
            entry = store.get(stem, {"count": 0, "last_access": now_iso})
            entry["count"] = entry.get("count", 0) + 1
            entry["last_access"] = now_iso
            store[stem] = entry
        _save_access_store(store)


def _hotness_score(active_count: int, updated_at_iso: str | None) -> float:
    """OpenViking formula: sigmoid(log1p(count)) × exp(-decay × age_days)"""
    if not updated_at_iso:
        return 0.0
    try:
        updated_at = datetime.fromisoformat(updated_at_iso)
    except Exception:
        return 0.0
    now = datetime.now(timezone.utc)
    if updated_at.tzinfo is None:
        updated_at = updated_at.replace(tzinfo=timezone.utc)
    freq = 1.0 / (1.0 + math.exp(-math.log1p(active_count)))
    age_days = max((now - updated_at).total_seconds() / 86400.0, 0.0)
    decay_rate = math.log(2) / _HOTNESS_HALF_LIFE_DAYS
    recency = math.exp(-decay_rate * age_days)
    return freq * recency


def apply_hotness_rerank(results: list[RagResult]) -> list[RagResult]:
    """Blend hot scores into search results and rerank. Updates the original score field."""
    if not results:
        return results
    with _ACCESS_STORE_LOCK:
        store = _load_access_store()
    max_score = max((r.get("score", 0) for r in results), default=1.0) or 1.0
    for r in results:
        stem = r.get("stem", "")
        entry = store.get(stem, {})
        h = _hotness_score(entry.get("count", 0), entry.get("last_access"))
        norm = r.get("score", 0) / max_score
        r["score"] = ((1 - _HOTNESS_ALPHA) * norm + _HOTNESS_ALPHA * h) * max_score
    results.sort(key=lambda r: -r.get("score", 0))
    return results


def _tokenize(text: str) -> list[str]:
    """Split text into a lowercase token list (by whitespace and special characters)."""
    tokens = re.split(r"[\s\[\](),./|_\-]+", text.lower())
    return [t for t in tokens if len(t) >= 2]


def _build_idf(docs: list[VaultDoc]) -> dict[str, float]:
    """Compute IDF values for each token across the entire corpus.
    IDF = log(N / df)  — df: number of documents containing the token
    """
    N = len(docs)
    if N == 0:
        return {}
    df: dict[str, int] = {}
    for doc in docs:
        tokens = set(_tokenize(doc.title + " " + doc.stem + " " + doc.body))
        for t in tokens:
            df[t] = df.get(t, 0) + 1
    return {t: math.log(N / count) for t, count in df.items()}


def _score_doc(doc: VaultDoc, query_tokens: list[str], idf: dict[str, float]) -> float:
    """TF-IDF based document score.
    Apply different weights to title/filename/body, with IDF suppressing common words.
    """
    title_lower = doc.title.lower()
    stem_lower  = doc.stem.lower()
    body_lower  = doc.body.lower()
    score = 0.0
    for token in query_tokens:
        idf_val = idf.get(token, 0.0)
        if idf_val <= 0:
            continue  # Appears in all documents → no discriminating power, skip
        if token in title_lower:
            score += 3.0 * idf_val
        if token in stem_lower:
            score += 2.0 * idf_val
        count = body_lower.count(token)
        if count > 0:
            score += min(count * 0.5, 3.0) * idf_val
    return score


def search_vault(
    query: str,
    vault_path: str,
    top_n: int = 5,
    active_only: bool = True,
) -> list[RagResult]:
    query_tokens = _tokenize(query)
    if not query_tokens:
        return []

    docs = _get_cached_docs(vault_path)

    if active_only:
        active_folders = find_active_folders(vault_path)
        active_set = {str(Path(f).resolve()) for f in active_folders}
        docs = [d for d in docs if str(Path(d.path).parent.resolve()) in active_set]

    # Compute IDF based on filtered corpus (excluding index_ files)
    corpus = [d for d in docs if not d.stem.startswith("index_")]
    idf = _build_idf(corpus)

    scored = []
    for doc in corpus:
        s = _score_doc(doc, query_tokens, idf)
        if s > 0:
            scored.append((s, doc))

    scored.sort(key=lambda x: -x[0])

    return [
        {
            "title": doc.title,
            "stem":  doc.stem,
            "body":  doc.body.strip()[:2000],
            "score": score,
            "date":     doc.date_str,
            "tags":     doc.tags,
            "doc_type": doc.doc_type,
        }
        for score, doc in scored[:top_n]
    ]


def build_rag_context(results: list[RagResult], max_chars: int = 8000) -> str:
    if not results:
        return ""

    parts = ["## Reference Documents\n"]
    total = 0
    for r in results:
        tag_str = " ".join(f"`{t}`" for t in (r["tags"] or []))
        header  = f"### {r['title']} ({r['date']}) {tag_str}\n"
        body    = r["body"]
        available = max_chars - total - len(header) - 10
        if available <= 100:
            break
        if len(body) > available:
            body = body[:available] + "…"
        chunk = header + body + "\n\n"
        parts.append(chunk)
        total += len(chunk)

    return "".join(parts)
