"""
multi_agent_rag.py — 병렬 서브 에이전트 기반 문서 분석 + 메인 에이전트 재검토

흐름:
  1. 검색 결과 상위 N개 문서 → 서브 에이전트 병렬 실행 (각 1개 문서 담당)
  2. 각 서브 에이전트: 문서 관련성 점수(0~10) + 핵심 요약 + 핵심 포인트 반환
  3. 최고 점수 문서를 메인 에이전트가 전체 내용으로 재검토
  4. 모든 요약 + 최고 문서 분석 → 최종 RAG 컨텍스트 문자열 반환
"""
import hashlib
import json
import logging
import os
import time
import threading
from pathlib import Path
from typing import Callable, TypedDict

from .claude_client import ClaudeClient
from .rag_simple import RagResult
from .paths import RAG_CHECKPOINTS_DIR

logger = logging.getLogger(__name__)


class SubAgentResult(TypedDict):
    idx: int
    doc: RagResult
    score: float
    summary: str
    key_points: list[str]

# ── 서브에이전트 체크포인트 (MiroFish realtime_output 패턴 기반) ─────────────
# 분석 결과를 실시간으로 파일에 저장 → 중단 후 재시작 시 이미 분석한 문서는 스킵.

_CHECKPOINT_DIR = RAG_CHECKPOINTS_DIR
_CHECKPOINT_TTL_SECS = 86400  # 24시간 TTL (장시간 시뮬레이션 재개 지원)
_CHECKPOINT_MAX_MB = 10        # LRU 정리 임계값


def _make_checkpoint_key(query: str, stems: list[str]) -> str:
    key = query + "|" + ",".join(sorted(stems))
    return hashlib.md5(key.encode()).hexdigest()[:12]


def _load_checkpoint(key: str) -> list[dict]:
    path = os.path.join(_CHECKPOINT_DIR, f"{key}.json")
    try:
        if not os.path.exists(path):
            return []
        if time.time() - os.path.getmtime(path) > _CHECKPOINT_TTL_SECS:
            os.remove(path)
            return []
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []


def _save_checkpoint(key: str, analyses: list[dict]) -> None:
    try:
        os.makedirs(_CHECKPOINT_DIR, exist_ok=True)
        path = os.path.join(_CHECKPOINT_DIR, f"{key}.json")
        # doc body는 저장 제외 (크기 절약) — idx/score/summary/key_points만 저장
        slim = [
            {"idx": a["idx"], "score": a["score"],
             "summary": a["summary"], "key_points": a["key_points"]}
            for a in analyses
        ]
        with open(path, "w", encoding="utf-8") as f:
            json.dump(slim, f, ensure_ascii=False)
    except OSError as e:
        logger.error("체크포인트 저장 실패 (key=%s): %s", key, e)


def _clear_stale_checkpoints() -> None:
    """TTL 초과 파일 삭제 + 디렉토리 용량 초과 시 LRU 정리."""
    try:
        if not os.path.isdir(_CHECKPOINT_DIR):
            return
        files = sorted(
            Path(_CHECKPOINT_DIR).glob("*.json"),
            key=lambda f: f.stat().st_mtime,
        )
        now = time.time()
        # 1) TTL 초과 삭제
        surviving = []
        for f in files:
            if now - f.stat().st_mtime > _CHECKPOINT_TTL_SECS:
                f.unlink()
            else:
                surviving.append(f)
        # 2) 용량 초과 시 오래된 순 LRU 삭제
        limit = _CHECKPOINT_MAX_MB * 1024 * 1024
        total = sum(f.stat().st_size for f in surviving)
        for f in surviving:
            if total <= limit:
                break
            total -= f.stat().st_size
            f.unlink()
    except OSError as e:
        logger.warning("체크포인트 정리 실패: %s", e)


_SUB_AGENT_SYSTEM = "게임 개발 문서 관련성 평가 전문가. JSON만 출력."

_MAIN_REVIEW_SYSTEM = (
    "게임 개발 지식 분석가. 문서 분석 결과를 종합해 질문에 필요한 핵심 인사이트와 컨텍스트를 구성합니다. "
    "문서 간 연결고리·패턴·중요 사실을 적극 도출하세요."
)


def _analyze_doc(
    client: ClaudeClient,
    query: str,
    doc: RagResult,
    idx: int,
    results: list[SubAgentResult],
    lock: threading.Lock,
    log_fn: Callable[[str], None] | None = None,
) -> None:
    """서브 에이전트: 단일 문서를 질문 기준으로 분석."""
    title = doc.get("title", "")
    body = doc.get("body", "")[:1400]

    user_prompt = (
        f"Q: {query}\n"
        f"제목: {title} | 날짜: {doc.get('date', '')} | 태그: {', '.join(doc.get('tags') or [])}\n"
        f"내용:\n{body}\n\n"
        'JSON: {"score":0~10, "summary":"핵심 요약 2-3줄", "key_points":["","",""]}'
    )

    score = 0.0
    summary = ""
    key_points: list[str] = []

    _MAX_RETRIES = 2
    for attempt in range(_MAX_RETRIES + 1):
        try:
            raw = client.complete(_SUB_AGENT_SYSTEM, user_prompt, max_tokens=400)
            # 마크다운 코드블록 제거
            if "```" in raw:
                parts = raw.split("```")
                if len(parts) > 1:
                    raw = parts[1].lstrip("json").strip()
            # JSON 객체만 추출
            start = raw.find("{")
            end = raw.rfind("}") + 1
            if start >= 0 and end > start:
                raw = raw[start:end]
            data = json.loads(raw)
            score = float(data.get("score", 0))
            summary = data.get("summary", "")
            key_points = data.get("key_points", [])
            break  # 성공
        except json.JSONDecodeError as e:
            # JSON 파싱 실패 — 재시도 의미 없음, 즉시 폴백
            if log_fn:
                log_fn(f"[서브에이전트 #{idx}] JSON 파싱 실패: {e}")
            logger.warning("[서브에이전트 #%d] JSON 파싱 실패 (시도 %d): %s", idx, attempt + 1, e)
            break
        except (ConnectionError, TimeoutError, OSError) as e:
            # 네트워크/IO 오류 — 재시도
            logger.warning("[서브에이전트 #%d] 네트워크 오류 (시도 %d/%d): %s", idx, attempt + 1, _MAX_RETRIES + 1, e)
            if attempt < _MAX_RETRIES:
                time.sleep(2 ** attempt)  # 지수 백오프: 1초, 2초
                continue
            if log_fn:
                log_fn(f"[서브에이전트 #{idx}] 재시도 초과: {e}")
            break
        except Exception as e:
            logger.exception("[서브에이전트 #%d] 예상치 못한 오류: %s", idx, e)
            if log_fn:
                log_fn(f"[서브에이전트 #{idx}] 오류: {e}")
            break

    # 정상 결과가 없으면 점수 기반 폴백
    if not summary:
        raw_score = doc.get("score", 0)
        score = min(float(raw_score) * 0.8, 7.0) if raw_score else 0.0
        summary = body[:150] + ("…" if len(body) > 150 else "")
        key_points = []

    with lock:
        results.append({
            "idx": idx,
            "doc": doc,
            "score": score,
            "summary": summary,
            "key_points": key_points,
        })


def run_sub_agents(
    client: ClaudeClient,
    query: str,
    docs: list[RagResult],
    n_agents: int = 10,
    log_fn: Callable[[str], None] | None = None,
) -> list[SubAgentResult]:
    """
    docs 중 상위 n_agents개에 대해 병렬 서브 에이전트 실행.
    체크포인트가 있으면 이미 분석된 문서는 스킵.
    결과를 score 내림차순으로 정렬해 반환.
    """
    target = docs[:n_agents]
    stems = [d.get("stem", "") for d in target]
    ck_key = _make_checkpoint_key(query, stems)

    # 체크포인트 복원 — 이미 분석된 문서 인덱스 로드
    cached = _load_checkpoint(ck_key)
    cached_by_idx = {c["idx"]: c for c in cached}
    if cached_by_idx and log_fn:
        log_fn(f"[서브에이전트] 체크포인트 복원: {len(cached_by_idx)}/{len(target)}개 스킵")

    results: list[dict] = []
    lock = threading.Lock()
    threads = []

    for i, doc in enumerate(target):
        if i in cached_by_idx:
            entry = dict(cached_by_idx[i])
            entry["doc"] = doc
            with lock:
                results.append(entry)
            continue
        t = threading.Thread(
            target=_analyze_doc,
            args=(client, query, doc, i, results, lock, log_fn),
            daemon=True,
        )
        threads.append(t)
        t.start()

    for t in threads:
        t.join(timeout=35)

    _save_checkpoint(ck_key, results)
    _clear_stale_checkpoints()

    results.sort(key=lambda x: -x["score"])
    return results


def build_multi_agent_context(
    client: ClaudeClient,
    query: str,
    docs: list[RagResult],
    n_agents: int = 10,
    max_chars: int = 10000,
    log_fn: Callable[[str], None] | None = None,
) -> str:
    """
    서브 에이전트 n_agents개 병렬 실행 → 메인 에이전트가 최고 점수 문서 재검토.
    최종 RAG 컨텍스트 문자열 반환.
    """
    if not docs:
        return ""

    if log_fn:
        log_fn(f"[서브에이전트] {min(len(docs), n_agents)}개 병렬 분석 시작...")

    analyses = run_sub_agents(client, query, docs, n_agents, log_fn=log_fn)
    if not analyses:
        return ""

    best = analyses[0]
    best_doc = best["doc"]

    if log_fn:
        log_fn(
            f"[서브에이전트] 완료. 최고 점수: {best['score']:.1f}/10 "
            f"— {best_doc.get('title', '')}"
        )
        log_fn("[메인에이전트] 최고 점수 문서 재검토 중...")

    # 전체 요약 목록
    all_summaries = "\n".join(
        f"  [{a['score']:.1f}/10] {a['doc'].get('title', '')}: {a['summary']}"
        for a in analyses
    )

    # 메인 에이전트: 최고 점수 문서 전체 내용 + 모든 요약을 보고 컨텍스트 구성
    main_user = (
        f"Q: {query}\n\n"
        f"분석 결과 ({len(analyses)}개 문서):\n"
        f"{all_summaries}\n\n"
        f"━ 최고 관련 문서 (관련도 {best['score']:.1f}/10) ━\n"
        f"제목: {best_doc.get('title', '')} | 날짜: {best_doc.get('date', '')}\n"
        f"{best_doc.get('body', '')[:3000]}\n\n"
        "위 결과 기반으로:\n"
        "1. 질문에 직접 관련된 핵심 사실·수치 추출\n"
        "2. 문서 간 중요 연결 관계 파악\n"
        "3. 주목할 인사이트·패턴 설명"
    )

    try:
        context_review = client.complete(_MAIN_REVIEW_SYSTEM, main_user, max_tokens=1000)
    except Exception as e:
        if log_fn:
            log_fn(f"[메인에이전트] 오류: {e}")
        context_review = f"{best_doc.get('title', '')}: {best['summary']}"

    # 최종 컨텍스트 조합
    parts = [
        f"## 다중 에이전트 분석 결과 ({len(analyses)}개 문서 검토)\n\n",
        f"### 메인 에이전트 종합 분석\n",
        context_review,
        f"\n\n### 서브 에이전트 평가 요약\n{all_summaries}\n\n",
        "## 참고 문서 상세\n",
    ]

    total = sum(len(p) for p in parts)

    for a in analyses[:6]:
        doc = a["doc"]
        tag_str = " ".join(f"`{t}`" for t in (doc.get("tags") or []))
        header = (
            f"### [{a['score']:.1f}/10] {doc.get('title', '')} "
            f"({doc.get('date', '')}) {tag_str}\n"
        )
        kp_lines = "\n".join(f"  - {k}" for k in a["key_points"][:3])
        body = doc.get("body", "")
        available = max_chars - total - len(header) - len(kp_lines) - 20
        if available <= 100:
            break
        if len(body) > available:
            body = body[:available] + "…"
        chunk = header + (kp_lines + "\n" if kp_lines else "") + body + "\n\n"
        parts.append(chunk)
        total += len(chunk)

    return "".join(parts)
