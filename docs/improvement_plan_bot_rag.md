# Bot RAG 개선 계획 (Python)

> 기반: `docs/개선사항1.md` 코드 리뷰 결과
> 대상: `bot/` Python 코드 (Electron/TypeScript는 BM25 이미 구현됨)
> 작성: 2026-03-24

---

## 현황 요약

| 파일 | 실제 구현 | 문제 |
|------|-----------|------|
| `bot/modules/rag_simple.py` | 가중 TF (IDF 없음) | 공통 단어 과가중 |
| `bot/modules/multi_agent_rag.py` | `except Exception: pass` 패턴 | 오류 원인 불명, 재시도 없음 |
| `bot/modules/multi_agent_rag.py` | Checkpoint TTL 30분 | 장시간 작업 재개 불가 |
| `bot/modules/rag_simple.py` | 매 검색마다 `scan_vault()` 전체 로드 | 2000문서 시 ~20초 지연 |
| 전체 `bot/modules/` | 타입 힌팅 불완전 | IDE 자동완성 불가, 오류 위험 |

---

## Phase 1 — 즉시 (1~2주)

### 1-A. `rag_simple.py` — IDF 추가로 진짜 TF-IDF 전환

**파일**: `bot/modules/rag_simple.py`
**대상 함수**: `_score_doc` (line 97), `search_vault` (line 111)

**현재 코드 문제**:
```python
# 현재: 단순 가중 TF만 구현 (IDF 없음)
def _score_doc(doc: VaultDoc, query_tokens: list[str]) -> float:
    for token in query_tokens:
        if token in title_lower: score += 3.0   # 하드코딩
        count = body_lower.count(token)
        if count > 0:
            score += min(count * 0.5, 3.0)       # IDF 없음 → 공통 단어 과가중
```

**개선 방향**:
- `search_vault` 호출 시점에 전체 문서 코퍼스에서 DF(Document Frequency) 계산
- `_score_doc` 에 IDF 파라미터 추가: `idf = log(N / max(df, 1))`
- 제목/본문 가중치는 유지하되 IDF를 곱해 공통 단어 억제

**변경 범위**: `_score_doc`, `search_vault` 2개 함수
**의존성**: 없음 (표준 라이브러리 `math.log` 이미 import됨)

---

### 1-B. `multi_agent_rag.py` — Exception 종류별 분리

**파일**: `bot/modules/multi_agent_rag.py`
**대상 함수**: `_analyze_doc` (line 79), `_save_checkpoint` (line 42)

**현재 문제**:
```python
# 현재: 광범위 catch → 네트워크 오류 / JSON 파싱 오류 / API 한도 초과 구분 불가
except Exception as e:
    if log_fn:
        log_fn(f"[서브에이전트 #{idx}] 파싱 오류: {e}")

# 체크포인트 저장 실패도 조용히 무시
except Exception:
    pass
```

**개선 방향**:
```python
# 분리 예시
except json.JSONDecodeError as e:
    # JSON 파싱 실패 → 폴백 허용
    log_fn(f"[서브에이전트 #{idx}] JSON 파싱 실패: {e}")
except (ConnectionError, TimeoutError, OSError) as e:
    # 네트워크/IO 오류 → 재시도 필요 신호
    raise  # 호출 측에서 재시도 판단
except Exception as e:
    # 예상치 못한 오류 → 로깅 후 폴백
    logger.exception(f"[서브에이전트 #{idx}] 예상치 못한 오류")
```

**변경 범위**: `_analyze_doc`, `_save_checkpoint`, `_save_access_store`
**의존성**: `import logging` 추가 필요

---

### 1-C. `multi_agent_rag.py` — Checkpoint TTL 확장

**파일**: `bot/modules/multi_agent_rag.py` line 20

**현재**:
```python
_CHECKPOINT_TTL_SECS = 1800  # 30분
```

**개선**:
```python
_CHECKPOINT_TTL_SECS = 86400  # 24시간
# 이유: 100명 × 20라운드 시뮬레이션 중단 후 재개 시
#       30분 TTL → 모든 체크포인트 만료 → LLM 1300회 재호출 ($3-5 손실)
```

**변경 범위**: 상수 1개
**의존성**: 없음

---

### 1-D. 주요 함수 타입 힌팅 추가

**대상 파일**:
- `bot/modules/rag_simple.py` — `search_vault` 반환 타입 `list[dict]` → `list[RagResult]`
- `bot/modules/multi_agent_rag.py` — `_analyze_doc` 파라미터 타입 전부 명시
- `bot/modules/claude_client.py` — `client` 파라미터 타입

**추가할 TypedDict**:
```python
# rag_simple.py 상단에 추가
from typing import TypedDict

class RagResult(TypedDict):
    title: str
    stem: str
    body: str
    score: float
    date: str
    tags: list[str]
```

**변경 범위**: 타입 정의 추가 + 함수 시그니처 수정
**의존성**: `from typing import TypedDict, Callable` 추가

---

## Phase 2 — 단기 (1개월)

### 2-A. `rag_simple.py` — `scan_vault` 결과 메모리 캐싱

**파일**: `bot/modules/rag_simple.py`
**문제**: `search_vault` 호출마다 `scan_vault(vault_path)` 전체 실행
- 2000개 문서 × 파싱 → 매 쿼리 지연

**개선 방향**:
```python
# 모듈 레벨 캐시 (TTL 60초)
_vault_cache: dict = {}  # {"path": str, "docs": list, "ts": float}
_VAULT_CACHE_TTL = 60.0  # 초

def _get_cached_docs(vault_path: str) -> list[VaultDoc]:
    now = time.time()
    if (_vault_cache.get("path") == vault_path
            and now - _vault_cache.get("ts", 0) < _VAULT_CACHE_TTL):
        return _vault_cache["docs"]
    docs = scan_vault(vault_path)
    _vault_cache.update({"path": vault_path, "docs": docs, "ts": now})
    return docs
```

**변경 범위**: 모듈 상단 캐시 변수 + `search_vault` 내 `scan_vault()` 호출 교체
**의존성**: `import time` 추가

---

### 2-B. `multi_agent_rag.py` — 재시도 로직 추가

**파일**: `bot/modules/multi_agent_rag.py`
**대상 함수**: `_analyze_doc`

**개선 방향**: 1-B 에러 분리 후, 네트워크 오류에 한해 최대 2회 재시도
```python
MAX_RETRIES = 2
for attempt in range(MAX_RETRIES + 1):
    try:
        raw = client.complete(...)
        # ... 파싱
        break
    except json.JSONDecodeError:
        break  # JSON 오류는 재시도 의미 없음 → 즉시 폴백
    except (ConnectionError, TimeoutError):
        if attempt < MAX_RETRIES:
            time.sleep(2 ** attempt)  # 지수 백오프
            continue
        break  # 최대 재시도 초과 → 폴백
```

**의존성**: 1-B 완료 후 진행

---

### 2-C. Checkpoint LRU 정리 (디렉토리 용량 초과 방지)

**파일**: `bot/modules/multi_agent_rag.py`
**대상 함수**: `_clear_stale_checkpoints` (line 58)

**현재**: TTL 초과 파일만 삭제
**개선**: 디렉토리 총 크기 10MB 초과 시 오래된 파일부터 LRU 삭제

```python
_CHECKPOINT_MAX_MB = 10

def _clear_stale_checkpoints() -> None:
    if not os.path.isdir(_CHECKPOINT_DIR):
        return
    files = sorted(
        Path(_CHECKPOINT_DIR).glob("*.json"),
        key=lambda f: f.stat().st_mtime
    )
    total = sum(f.stat().st_size for f in files)
    # TTL 초과 삭제
    now = time.time()
    for f in files[:]:
        if now - f.stat().st_mtime > _CHECKPOINT_TTL_SECS:
            f.unlink()
            total -= f.stat().st_size
            files.remove(f)
    # 용량 초과 시 오래된 순 LRU 삭제
    limit = _CHECKPOINT_MAX_MB * 1024 * 1024
    for f in files:
        if total <= limit:
            break
        total -= f.stat().st_size
        f.unlink()
```

**의존성**: `from pathlib import Path` (이미 사용 중 확인 필요)

---

### 2-D. 테스트 추가

**추가할 테스트 파일**:

| 파일 | 테스트 항목 |
|------|-------------|
| `bot/tests/test_rag_simple.py` | IDF 점수 계산, 공통 단어 억제 확인, hotness 재정렬 |
| `bot/tests/test_multi_agent_rag.py` | 체크포인트 저장/복원, TTL 만료, 병렬 분석 |

---

## Phase 3 — 중기 (2~3개월)

### 3-A. 한글 형태소 분석

**파일**: `bot/modules/rag_simple.py`
**대상 함수**: `_tokenize` (line 92)

**현재**:
```python
tokens = re.split(r"[\s\[\](),./|_\-]+", text.lower())
# "개선하는" → "개선하는" 으로 처리 (어미 미분리)
```

**개선 옵션**:
- `kiwipiepy` (pip 설치 간단, 의존성 경량) — 추천
- `konlpy` + Mecab (성능 좋지만 설치 복잡)

```python
# kiwipiepy 적용 예시
from kiwipiepy import Kiwi
_kiwi = Kiwi()

def _tokenize(text: str) -> list[str]:
    result = _kiwi.tokenize(text)
    # 명사(NN*), 동사어간(VV), 형용사어간(VA) 만 추출
    tokens = [t.form for t in result if t.tag.startswith(('NN', 'VV', 'VA', 'SL'))]
    return [t for t in tokens if len(t) >= 2]
```

**의존성**: `pip install kiwipiepy`

---

### 3-B. Python 봇 하이브리드 검색

**현황**: Python 봇은 현재 TF(-IDF) 키워드 검색만 사용
**Electron 앱**: BM25 + Cosine 임베딩 이미 구현됨

**개선 방향**: `rank_bm25` 라이브러리 도입 또는 1-A의 IDF 추가로 충분한지 검증 후 결정

```python
# 옵션 A: rank_bm25 도입
from rank_bm25 import BM25Okapi
# 옵션 B: 1-A에서 직접 구현한 TF-IDF가 충분하면 스킵
```

**판단 기준**: Phase 1-A 완료 후 검색 품질 측정 → 개선폭이 충분하면 3-B 스킵

---

## 작업 순서 요약

```
Phase 1 (즉시)
  ├── 1-C: TTL 상수 변경 (5분, 리스크 없음) ✦ 먼저
  ├── 1-D: TypedDict + 타입 힌팅 (독립적)
  ├── 1-B: Exception 분리 + logging 추가
  └── 1-A: IDF 추가 (1-D 타입 정의 후 진행)

Phase 2 (단기)
  ├── 2-A: scan_vault 캐싱 (독립적)
  ├── 2-B: 재시도 로직 (1-B 완료 후)
  ├── 2-C: Checkpoint LRU (독립적)
  └── 2-D: 테스트 작성 (1-A, 1-B 완료 후)

Phase 3 (중기)
  ├── 3-A: 형태소 분석 (1-A 완료 후 효과 측정 기반)
  └── 3-B: 하이브리드 검색 (3-A 완료 후 판단)
```

---

## 참고

- Electron/TypeScript 쪽 BM25: `src/lib/graphAnalysis.ts` `TfIdfIndex` 클래스 — Okapi BM25 정확히 구현됨 (k1=1.5, b=0.75)
- Python 봇의 IDF 부재는 `bot/` 한정 이슈
- `개선사항1.md` 의 "BM25 재구현 아니면 외부 라이브러리?" 지적은 Electron 앱 기준으론 오지적임
