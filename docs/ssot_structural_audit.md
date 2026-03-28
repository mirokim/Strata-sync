# SSOT / 구조적 문제 감사 보고서

> 작성: 2026-03-24 | 대상: `bot/` Python 코드베이스 전체

---

## 1. SSOT 위반 — 상수·설정값 중복

### 1-1. 모델명 하드코딩 (심각)

`claude-haiku-4-5-20251001`이 5곳에 분산됨.

| 파일 | 줄 | 형태 |
|------|----|------|
| `bot/modules/claude_client.py` | 11 | `DEFAULT_MODEL = "claude-haiku-4-5-20251001"` |
| `bot/bot.py` | 90 | config 기본값 dict |
| `bot/bot.py` | 162 | `cfg.get("worker_model", "claude-haiku-4-5-20251001")` |
| `bot/bot.py` | 1385 | `_BRIEF_MODEL = "claude-haiku-4-5-20251001"` |
| `bot/modules/rag_electron.py` | 175 | 함수 파라미터 기본값 |

모델 버전 업그레이드 시 5곳을 모두 찾아 수정해야 함. 일부만 바뀌면 동작이 달라짐.

**해결**: `bot/modules/constants.py` 신설 후 단일 정의.

---

### 1-2. `keyword_index_path` 경로 중복 (높음)

`.strata-sync/keyword_index.json` 이 5곳에 분산됨.

| 파일 | 줄 | 형태 |
|------|----|------|
| `bot/bot.py` | 88 | config dict 기본값 |
| `bot/bot.py` | 154 | `.get()` 폴백 |
| `bot/bot.py` | 2904 | `.get()` 폴백 |
| `bot/bot.py` | 2935 | `.get()` 폴백 |
| `bot/modules/keyword_store.py` | 18 | 파라미터 기본값 |

---

### 1-3. Electron API 포트 하드코딩 (높음)

`rag_electron.py`에 `RAG_API_BASE = "http://127.0.0.1:7331"` 상수가 있음에도
`bot.py` 줄 665에서 포트를 직접 하드코딩:

```python
# bot.py:665 — 상수를 쓰지 않고 직접 기입
"http://127.0.0.1:7331/mirofish-progress"
```

포트 변경 시 `rag_electron.py`만 바꾸면 안 되고 `bot.py`도 수정해야 함.

---

### 1-4. 캐시 디렉토리 경로 중복 (중간)

```python
# rag_simple.py:52
os.path.join(os.path.dirname(__file__), "..", "cache", "vault_access.json")

# multi_agent_rag.py:35
os.path.join(os.path.dirname(__file__), "..", "cache", "rag_checkpoints")
```

`"cache"` 디렉토리 이름이 하드코딩된 문자열로 반복됨.
**해결**: `bot/modules/paths.py` 신설.

---

### 1-5. TTL 네이밍 불일치 (낮음)

| 파일 | 상수명 | 값 |
|------|--------|-----|
| `rag_simple.py` | `_VAULT_CACHE_TTL` | 60초 |
| `multi_agent_rag.py` | `_CHECKPOINT_TTL_SECS` | 86400초 |
| `rag_electron.py` | `_SETTINGS_TTL` | 300초 |
| `bot.py` | `_MIRO_CACHE_TTL` | 1800초 |

동일 개념(TTL)의 이름 패턴이 `_TTL`, `_TTL_SECS`, `_CACHE_TTL`로 제각각.

---

## 2. API 키 관리 불일치 (심각)

같은 API 키를 가져오는 경로가 3개이고, **우선순위가 코드 위치마다 다름**.

```
소스 A: 환경변수 (os.getenv)       → bot.py:99
소스 B: config.json                → bot.py:82-96
소스 C: Electron /settings API     → bot.py:294
```

**줄 294**: `get_api_key_from_settings("anthropic") or cfg.get("claude_api_key")`
→ Electron 우선

**줄 708**: `self.cfg.get("claude_api_key", "").strip()`
→ Electron 무시, config만 봄

호출 위치마다 동작이 달라 어떤 API 키가 실제로 쓰이는지 예측 불가.

---

## 3. 데이터 타입 혼재

### 3-1. 문서 표현 3중 타입

```
VaultDoc (dataclass)         — vault_scanner.py
  ↓ search_vault() 에서 dict로 변환
RagResult (TypedDict)        — rag_simple.py
  ↓ multi_agent_rag에서 SubAgentResult에 포함
SubAgentResult (TypedDict)   — multi_agent_rag.py
```

변환 과정에서 필드 이름이 바뀜:
- `VaultDoc.date_str` → `RagResult["date"]`
- `VaultDoc.doc_type` → RagResult에서 **누락**

`doc_type` 정보가 RAG 파이프라인에서 소실됨.

### 3-2. Config dict 타입 없음

`bot.py`의 `cfg: dict`는 타입 힌팅 없음.
`cfg.get("key", default)` 호출이 전체에 수십 군데 퍼져 있어
오타가 런타임에서만 발견됨.

---

## 4. 구조적 문제

### 4-1. bot.py 비대화 (~2900줄, 심각)

한 파일에 책임이 너무 많음:

- TK GUI 관리
- Slack 이벤트 핸들러 전체
- RAG 오케스트레이션
- MiroFish 시뮬레이션 실행
- 파일시스템 작업
- 인메모리 캐시 관리
- 이미지 분석 (Vision)

분리 가능한 단위:
```
bot.py
  ├── slack_handler.py    — on_message, on_app_mention 등
  ├── rag_orchestrator.py — RAG 파이프라인 조합
  └── cache_manager.py    — _MIRO_CACHE 등
```

### 4-2. 로깅 전략 5가지 혼재

| 파일 | 로깅 방식 |
|------|-----------|
| `bot.py` | `self._log()` (TK GUI 스레드 안전) |
| `rag_simple.py` | `logging.getLogger()` |
| `multi_agent_rag.py` | `logging.getLogger()` |
| `mirofish_runner.py` | `log_fn` 콜백 파라미터 |
| `rag_electron.py` | 로깅 없음 (except 절 조용히 무시) |

외부에서 로그를 모아 볼 방법이 없음.

### 4-3. 캐시 전략 일관성 없음

| 캐시 | 위치 | TTL | 스레드 안전 | LRU |
|------|------|-----|------------|-----|
| 볼트 문서 | rag_simple.py (메모리) | 60초 | ✓ | ✗ |
| 핫스코어 | rag_simple.py (파일) | 무제한 | ✓ | ✗ |
| 서브에이전트 | multi_agent_rag.py (파일) | 24시간 | ✓ | ✓ |
| Electron 설정 | rag_electron.py (메모리) | 5분 | ✓ | ✗ |
| MiroFish | bot.py (메모리) | 30분 | ✓ | ✗ |

LRU 정리가 `multi_agent_rag.py`에만 구현되고 나머지는 없음.
캐시 무효화 신호 메커니즘 전혀 없음.

---

## 5. 개선 우선순위

### Phase A — 즉시 (상수 통합, 사이드 이펙트 없음)

```
bot/modules/constants.py  (신설)
  - DEFAULT_HAIKU_MODEL
  - DEFAULT_SONNET_MODEL
  - KEYWORD_INDEX_REL_PATH

bot/modules/paths.py  (신설)
  - CACHE_DIR
  - VAULT_ACCESS_PATH
  - RAG_CHECKPOINTS_DIR
```

`rag_electron.py`의 `RAG_API_BASE`를 `bot.py`에서도 import해서 사용.

---

### Phase B — 단기 (API 키 관리 일원화)

```python
# bot/modules/api_keys.py  (신설)
def get_anthropic_key(cfg: dict) -> str:
    """우선순위: Electron 설정 > config.json > 환경변수"""
    from .rag_electron import get_api_key_from_settings
    return (
        get_api_key_from_settings("anthropic")
        or cfg.get("claude_api_key", "").strip()
        or os.getenv("ANTHROPIC_API_KEY", "")
    )
```

모든 `cfg.get("claude_api_key")` 호출을 이 함수로 교체.

---

### Phase C — 중기 (Config 타입 안정성)

```python
# bot/modules/config_schema.py  (신설)
class BotConfig(TypedDict, total=False):
    vault_path: str
    claude_api_key: str
    interval_hours: int
    auto_run: bool
    keyword_index_path: str
    worker_model: str
    ...
```

`cfg: dict` → `cfg: BotConfig`로 전환 후 `.get()` 제거.

---

### Phase D — 중기 (bot.py 분리)

```
bot/
  bot.py              — 진입점 + GUI만
  slack_handler.py    — Slack 이벤트 핸들러
  rag_orchestrator.py — RAG 파이프라인
```

---

## 요약

| 문제 | 심각도 | 위치 수 |
|------|--------|---------|
| 모델명 중복 | 높음 | 5 |
| keyword_index_path 중복 | 높음 | 5 |
| API 키 우선순위 불일치 | 심각 | 2+ |
| Electron 포트 하드코딩 | 높음 | 2 |
| 캐시 경로 중복 | 중간 | 2 |
| 문서 타입 변환 필드 누락 | 중간 | VaultDoc→RagResult |
| bot.py 비대화 | 높음 | 1파일 ~2900줄 |
| 로깅 전략 혼재 | 중간 | 5가지 패턴 |
