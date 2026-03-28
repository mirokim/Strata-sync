> **Jira 정제 ③ — 교차 링크 · 운영 · 품질 · 알려진 문제**

*집계 문서와 Confluence 문서를 연결하고, 자동 정제 파이프라인을 운영하며, 품질을 보증한다.
Confluence 14단계 파이프라인에서 발생한 모든 문제를 Jira 구조에 대입하여 사전 대응한다.*

v1.0 | 2026-03-25

---

## 목차

| § | 내용 |
|---|------|
| 1 | 교차 링크 전략 |
| 2 | 운영 파이프라인 |
| 3 | 품질 체크리스트 |
| 4 | Jira 구조에서 예상되는 시나리오 — Confluence 전 단계 대입 |
| 5 | AI 자율 정제 가이드 |

---

> **1. 교차 링크 전략**

**1.1 Jira ↔ Confluence 연결**

| 소스 | 대상 | 방법 |
|------|------|------|
| Jira 이슈 remotelink | Confluence 페이지 | URL → 볼트 stem 매칭 |
| Jira Epic 집계 | Confluence 설계 문서 | 태그 + 키워드 유사도 |
| Confluence 본문 Jira 링크 | Jira 이슈/Epic | URL 패턴 `/browse/KEY` 추출 |
| Jira 이슈 description 내 URL | Confluence/외부 문서 | URL 파싱 → stem 매칭 |

**매칭 알고리즘:**

```
1. remotelink URL에서 Confluence pageId 추출
2. 볼트 내 origin: confluence 문서 중 source URL 일치 검색
3. 일치 시 → related: [..., "Confluence_페이지_stem"]
4. 미일치 시 → 태그 교집합 ≥ 2개인 문서 후보 (BM25 보강)
5. description/comment 내 Confluence URL도 동일 로직으로 매칭
```

> **Confluence §8.3 Ghost→Real 교체와 동일 문제**: 교차 링크 주입 시 대상 Confluence 문서가 아카이브됐거나 삭제됐으면 Ghost 링크가 된다. 반드시 대상 파일 존재 확인 후 주입.

**1.2 집계 문서 간 연결**

| 연결 | 조건 | 양방향 |
|------|------|:---:|
| Epic → Sprint | Epic 하위 이슈가 해당 Sprint에 포함 | O |
| Epic → Release | Epic의 fixVersion 일치 | O |
| Component → Epic | 컴포넌트 소속 이슈의 Epic 집계 | O |
| Sprint → Release | Sprint 기간이 Release 일정에 포함 | O |
| Epic → Epic | 이슈 간 issuelinks(Blocks/Relates) 교차 | X (단방향) |

> **Confluence §7.1 클러스터 링크와 동일 원리**: 같은 태그를 가진 집계 문서끼리 자동 연결. Jira에서는 태그 대신 **component** 기반 클러스터링이 더 유효.

**1.3 wikilink 주입 규칙**

```markdown
## 관련 문서

- [[Epic — 로그인 시스템]]       ← Epic 집계
- [[Sprint 2026-W13]]           ← Sprint 집계
- [[로그인 기술 설계서]]          ← Confluence 교차 링크
```

> **주의**: `related:` frontmatter 배열과 본문 `## 관련 문서` 섹션 **양쪽 모두** 갱신해야 한다. 하나만 갱신하면 BM25와 Graph가 불일치. (Confluence §8.4 Fallback 링크와 동일: related만 있고 body 링크가 없으면 BFS 탐색 불가)

**1.4 raw 이슈 내부 링크 처리**

raw 이슈(graph_weight: skip)의 내부 `[[KEY]]` 링크는 그래프에 직접 참여하지 않지만, 집계 문서 생성 시 관계 추출 원본으로 사용된다.

| 링크 유형 | raw 이슈 처리 | 집계 문서 반영 |
|-----------|:---:|:---:|
| `issuelinks` (Blocks/Relates) | `[[KEY]]` 기록 | Epic 집계 "핵심 결정사항"에 반영 |
| `parent` (Epic 링크) | `[[EPIC-KEY]]` 기록 | Epic 집계 "하위 이슈" 테이블 |
| `subtasks` | `[[SUB-KEY]]` 기록 | 상위 이슈에 하위 목록 |

> **다른 프로젝트 KEY 주의**: `issuelinks`가 다른 프로젝트(예: `OTHER-456`)를 참조하면, 해당 프로젝트가 동기화 대상이 아닐 때 팬텀 노드가 생긴다. 다른 프로젝트 KEY는 `[[OTHER-456]]` 대신 텍스트로 남기거나, 프로젝트 접두사 화이트리스트를 적용.

**1.5 crosslink_jira.py — 자동 교차 링크 도구**

`tools/crosslink_jira.py`는 Jira ↔ Active 볼트 간 양방향 교차 링크를 자동 주입한다.

```bash
# 미리보기 (파일 변경 없음)
python tools/crosslink_jira.py /path/to/refined_vault --dry-run

# 실제 적용
python tools/crosslink_jira.py /path/to/refined_vault --apply
```

**동작 원리:**

1. active/ 파일명에서 의미 있는 토큰 추출 (Confluence ID·날짜·범용어 제외)
2. Jira 파일(Epic, Release, attachments_md) 본문에서 토큰 매칭
3. 최소 2개 토큰 일치 시 교차 링크 생성 (최대 10개/Jira 파일)
4. active 파일에 역방향 `## Jira 관련` 섹션 주입 (최대 5개/active 파일)
5. `_index.md`에 Jira 허브 링크 추가

**2026-03-25 초기 실행 결과:**

| 항목 | 수량 |
|------|------|
| Jira 파일 스캔 | 276개 |
| 링크 추가된 Jira 파일 | 234개 (85%) |
| Jira→Active 링크 | 2,009개 |
| Active→Jira 역링크 | 1,060개 (359 파일) |
| **총 주입 링크** | **3,069개** |

> **재실행 안전**: 이미 `## 관련 문서` / `## Jira 관련` 섹션이 있으면 중복 주입하지 않음.
> **주의**: inject_keywords.py 전에 실행할 것. crosslink 후 gen_index.py → inject_keywords.py 순서 엄수.

---

> **2. 운영 파이프라인**

**2.1 전체 흐름**

```
① Jira REST fetch (s10 §2)
   ↓
② 1:1 MD 변환 + Triage (s10 §3-4)
   ↓
③ 집계 문서 생성 (s11 §2-6)
   ↓
④ 교차 링크 주입 (s12 §1)
   ↓
⑤ gen_index.py → inject_keywords.py
   ↓
⑥ 품질 감사 (s12 §3)
   ↓
⑦ 볼트 리로드 (vault_reload)
```

> **Confluence §2 파이프라인 의존성과 동일**: 각 단계는 이전 단계의 결과물에 의존한다. 순서 변경 시 데이터 정합성 파괴.

**2.2 증분 동기화**

| 항목 | 설정 |
|------|------|
| JQL | `project = PROJ AND updated >= "{last_sync}"` |
| last_sync 저장 | `jira/raw/.last_sync` 파일에 ISO datetime |
| 변경 감지 | `updated` 필드 비교; 변경된 이슈만 재변환 |
| 집계 재생성 | 변경된 이슈가 속한 Epic/Sprint/Component/Release만 재생성 |
| 안전 마진 | `last_sync - 10분` 적용 (§4.2 날짜 오염 참조) |

**2.3 백업 (필수)**

> **Confluence §17.4 롤백 전략 적용**: git 없는 환경에서도 ZIP 백업 필수.

```bash
# 스크립트 실행 전 반드시 백업
zip -r backup_jira_$(date +%Y%m%d_%H%M).zip jira/

# 집계 문서 생성 전/후 각각 백업 권장
zip -r backup_pre_aggregate_$(date +%Y%m%d_%H%M).zip jira/
```

- 최소 72시간 보존
- inject_keywords.py 실행 전 별도 백업 (Confluence §17.4 동일)
- `--backup` 옵션 지원 스크립트는 자동 백업 사용

**2.4 스크립트 실행 순서 (엄수)**

```
1. jira_fetch.py          ← REST API에서 raw JSON 수집
2. jira_convert.py        ← JSON → MD 1:1 변환 + Triage
3. jira_aggregate.py      ← 4축 집계 문서 생성
4. crosslink_jira.py      ← 교차 링크 주입 (Jira↔Active 양방향)
5. gen_index.py           ← _index.md 갱신 (inject_keywords 전 필수!)
6. inject_keywords.py     ← 키워드 링크 주입
7. check_quality.py       ← 품질 감사
```

> **Confluence §9.0 / §17.1.4 동일 경고**: inject_keywords.py를 gen_index.py 전에 실행하면 새 집계 문서 키워드가 누락된다. inject_keywords.py는 **1회만** 실행. 반복 실행 시 중복 링크 생성 (Confluence §9.3 동일 버그).

**2.5 정기 정제 주기**

> **Confluence §17.2 적용**

| 주기 | 작업 |
|------|------|
| 매일 | 증분 동기화 (jira_fetch + convert + aggregate) |
| 매주 | gen_index.py + inject_keywords.py + check_quality.py |
| 매월 | 전체 재동기화 (full fetch), 팬텀 노드 전수 점검 |
| 분기 | outdated 집계 문서 아카이브, Component 집계 재평가 |

**2.6 멀티 유저 충돌 방지**

> **Confluence §17.5 적용**

- jira_fetch.py / jira_aggregate.py 동시 실행 금지 → 1인 담당자
- 팀 공지 후 배치 실행: "Jira 동기화 중 — 볼트 편집 대기"
- 집계 문서 수동 편집 시 잠금 선언

---

> **3. 품질 체크리스트**

**3.1 구조 검증**

| # | 검사 항목 | 통과 조건 | Confluence 대응 §참조 |
|---|-----------|-----------|---------------------|
| 1 | raw 이슈 frontmatter | `graph_weight: skip` 존재 | §13.1.1 graph_weight 분포 |
| 2 | 집계 문서 frontmatter | `graph_weight: normal`, `origin: jira_aggregate` | §6.1 frontmatter 필수 필드 |
| 3 | type 매핑 | s10 §3.4 테이블과 일치 | §6.2 type 분류 기준 |
| 4 | status 매핑 | s10 §3.5 테이블과 일치 | — |
| 5 | Epic 하위 이슈 수 | 집계 문서 이슈 수 = raw 파일 수 (±0) | — |
| 6 | `## 개요` 섹션 존재 | 집계 문서 상위 1,500자 내 핵심 정보 | §10.2 BFS Hop 최적화 |
| 7 | `##` 헤딩 보유 | 모든 집계 문서에 헤딩 존재 (99%+) | §10.1 Passage-level retrieval |

**3.2 링크 검증**

| # | 검사 항목 | 통과 조건 | Confluence 대응 |
|---|-----------|-----------|----------------|
| 8 | `[[KEY]]` wikilink | 대상 raw MD 파일 존재 | §13.1 ⑧ broken wikilink |
| 9 | Epic 집계 `[[KEY]]` | 모든 하위 이슈 링크 유효 | — |
| 10 | Confluence 교차 링크 | 대상 stem 파일이 볼트에 존재 | §3.2.1 archive dead link |
| 11 | 중복 링크 없음 | 같은 `[[stem]]`이 한 문서 내 2회 이상 안 됨 | §13.1 ⑨ 동일 링크 과다 |
| 12 | 팬텀 노드 없음 | wikilink 대상 중 파일 미존재 = 0 | §12.2 Phantom Node |
| 13 | 타 프로젝트 KEY | `[[OTHER-123]]` 형태 링크 없음 (텍스트만) | §1.4 참조 |

**3.3 데이터 정합성**

| # | 검사 항목 | 통과 조건 |
|---|-----------|-----------|
| 14 | Sprint 완료율 | 이슈 상태별 합계 = Sprint 총 이슈 수 |
| 15 | Component 이슈 수 | Component 집계 내 이슈 수 ≥ 5 (생성 조건) |
| 16 | Release 포함 Epic | fixVersion 매칭 Epic 누락 없음 |
| 17 | date 필드 | frontmatter `date:`가 실제 최종 업데이트와 일치 |
| 18 | source URL | 모든 raw 이슈에 Jira URL 존재 | Confluence §16 ⑤ |
| 19 | speaker 필드 | 집계 문서에 speaker 존재 (PPR affinity용) | Confluence §13.1 ⑪ |

**3.4 Graph 구조 검증**

> **Confluence §11 PageRank 최적화 대입**

| # | 검사 항목 | 통과 조건 |
|---|-----------|-----------|
| 20 | 고립 집계 문서 | 링크 없는 집계 문서 = 0 |
| 21 | 허브 과집중 | 단일 집계 문서의 인바운드 링크 ≤ 50 |
| 22 | raw 이슈 누출 | graph_weight: skip인데 다른 active 문서에서 참조 = 0 |

---

> **4. Jira 구조에서 예상되는 시나리오 — Confluence 전 단계 대입**

Confluence 14단계 파이프라인에서 발생한 **모든** 문제를 Jira 데이터 구조에 대입하여 예상 시나리오와 대응을 정리한다.

**4.1 데이터 분류 단계 (Confluence §3)**

**4.1.1 스텁 오판 — description이 짧은 이슈**

> Confluence: 50~300자 파일이 이미지/테이블만 있을 때 스텁으로 오분류 (§3.1.1)

Jira 시나리오:
- description이 30자("로그인 버그 수정")지만 **댓글에 기술 결정사항** 10개
- description이 빈 Sub-task지만 **Epic 하위 관계로 맥락** 보존 필요
- description에 ADF 테이블만 있어 **텍스트 추출 시 빈 문자열**

| 판단 기준 | Confluence | Jira |
|-----------|-----------|------|
| 글자 수 계산 대상 | 본문만 | description + **댓글 전체** |
| 이미지 인정 | `![[]]` 링크 | ADF `mediaSingle` 노드 |
| 삭제 보호 조건 | 이미지 존재 | 댓글에 "결정/합의/확정" + issuelinks ≥ 1 |

**4.1.2 아카이브 판단 — Jira 특유의 복합 조건**

> Confluence: status + 역링크 + 수정일 + superseded_by 복합 (§3.2.3)

Jira에서의 아카이브 대상:
- Done + 180일 이전 + description 100자 미만 + 댓글 0개 → skip 유지 (이미 s10 §4.2)
- **추가 주의**: Done이지만 **다른 활성 이슈에서 Blocks로 참조**되는 경우 → 아카이브 금지. 활성 이슈의 의존성 경로가 끊어진다.

**4.1.3 archive 후 dead link 정리**

> Confluence: archive/ 이동 후 active 파일에 남은 `[[]]` 링크가 Phantom Node 생성 (§3.2.1)

Jira 시나리오:
```
1. PROJ-50 (Cancelled) → Triage에서 삭제
2. Epic 집계 문서에 [[PROJ-50]] 링크 잔존
3. Graph RAG에서 PROJ-50이 Phantom Node로 등장
4. PageRank 왜곡 → 해당 Epic 집계 문서의 검색 순위 하락
```

**대응**: 삭제/격리 판정 후 **모든 집계 문서 순회** → 해당 KEY 링크 제거. 제거 후 링크 0개가 된 집계 문서 → Fallback 링크 주입 (Confluence §3.2.2 동일).

**4.2 변환 단계 (Confluence §4)**

**4.2.1 ADF 파싱 엣지 케이스 (Confluence HTML 파싱 §4.1 대입)**

| ADF 노드 | 문제 | Confluence 대응 참조 | Jira 대응 |
|-----------|------|---------------------|-----------|
| `bulletList` 중첩 | 재귀 없으면 평탄화 | ac:structured-macro | 재귀 파서 필수, 들여쓰기 레벨 추적 |
| `paragraph` 빈 노드 | `{"content": []}` | 빈 태그 | `\n` 하나만 출력, 연속 빈줄 축소 |
| `mention` | userAccountId만 있음 | @사용자 | `/rest/api/2/user?accountId=` → displayName |
| `emoji` | `:thumbsup:` | — | shortName 텍스트로 변환 |
| `inlineCard` | Confluence/Jira URL | 내부 링크 | URL → `[[stem]]` 매칭 시도, 실패 시 `[텍스트](url)` |
| `mediaSingle` | 첨부 이미지 | ac:image | 첨부 파일명 추출 → `![[파일명]]` |
| `table` 중 빈 셀 | `{"content": []}` | 빈 셀 | 빈 문자열 출력, 테이블 구조 유지 |
| `codeBlock` | 코드 블록 | `{code}` | ` ```lang ``` ` 변환, **키워드 주입 제외 영역** |
| `panel` (info/warning) | 패널 매크로 | Confluence 매크로 | `> **Info**: ...` 인용구로 변환 |
| `expand` (접기) | 접을 수 있는 섹션 | — | 제목을 `### 제목`으로, 내용은 하위에 |

**4.2.2 Wiki 마크업 파싱 (Server v2 — Confluence §4.1 대입)**

Jira Server/Data Center는 ADF 대신 Wiki 마크업을 사용한다.

| 문제 | 설명 | 대응 |
|------|------|------|
| `{code}` 블록 내 키워드 | 코드 블록 안에 키워드 있음 | Confluence §9.3 동일: 코드 블록 내 키워드 제외 |
| 매크로 중첩 | `{panel}{code}...{code}{panel}` | 매크로 스택 파서 필요 |
| `[텍스트\|URL]` 파싱 | 파이프 문자 | `[텍스트](URL)` 변환 시 `\|` vs `|` 구분 |

**4.2.3 첨부 파일 처리 (Confluence §4.0.1 대입)**

Jira 이슈에 첨부된 파일(스크린샷, 로그, 문서)의 처리:

| 첨부 유형 | 처리 | 파일명 규칙 |
|-----------|------|------------|
| 이미지 (png/jpg/gif) | `![[PROJ-123_1.png]]` → attachments/ | `{jira_key}_{순번}.ext` |
| PDF/문서 | 별도 변환 후 별도 .md | s10 변환 파이프라인 적용 |
| 로그/텍스트 | 본문에 발췌 인용 | — |

> **Confluence §12 이미지 링크 관리 적용**: 첨부 이미지 파일이 attachments/에 없으면서 `![[]]` 링크가 있으면 Phantom Node 생성. Jira 첨부 파일은 REST API `/rest/api/2/attachment/{id}/content`로 다운로드 가능하나, 대부분의 경우 **이미지 다운로드는 생략하고 링크만 텍스트로 기록**하는 것을 권장.

**4.3 대용량 분할 단계 (Confluence §5)**

**4.3.1 Epic 집계 문서 크기 폭발**

> Confluence §5.1: 단일 대형 문서를 허브-스포크 구조로 분할

Jira 시나리오:
- Epic에 하위 이슈 100개+ → 집계 문서가 500줄+ → BFS 토큰 예산 초과

| 이슈 수 | 처리 |
|---------|------|
| ≤ 50 | 단일 집계 문서 |
| 51~100 | 하위 이슈 테이블을 `## 진행 현황`(상위 1,500자)에 요약만, 전체 목록은 별도 `[[Epic — {이름} (상세)]]` |
| 100+ | 상태별 분리: `[[Epic — {이름} (진행중)]]`, `[[Epic — {이름} (완료)]]` |

> **Confluence §5.3 허브 크기 관리 기준**: 인바운드 링크 50개 초과 or 본문 300줄 초과 시 분할 검토. Jira Epic 집계도 동일 기준 적용.

**4.3.2 Sprint 집계 문서 — 분할 불필요**

Sprint는 시간 단위로 이미 분리되어 있으므로 허브-스포크 분할 불필요. 단, Sprint 기간이 겹치는 프로젝트에서는 **Sprint 이름에 프로젝트 접두사** 추가: `Sprint PROJ-2026-W13.md`

**4.4 프론트매터 단계 (Confluence §6)**

**4.4.1 Jira 전용 frontmatter 필드**

Confluence frontmatter(§6.1)에 없는 Jira 전용 필드:

| 필드 | raw 이슈 | 집계 문서 | 설명 |
|------|:---:|:---:|------|
| `jira_key` | O | — | PROJ-123 |
| `epic_key` | O | — | 상위 Epic KEY |
| `sprint` | O | — | Sprint 이름 |
| `components` | O | — | 배열 |
| `fix_versions` | O | — | 배열 |
| `story_points` | O | — | 숫자 |
| `priority` | O | — | Jira 우선순위 |
| `assignee` / `reporter` | O | — | 사람 정보 |

**4.4.2 type 매핑 모호성**

> Confluence §6.2: spec/decision/meeting/guide/reference 5종

Jira 이슈 중 type 매핑이 모호한 경우:

| issueType | 모호 상황 | 권장 |
|-----------|-----------|------|
| Epic | 기능 기획인가 프로젝트 관리인가 | `spec` (기능 단위) |
| Bug | 기술 스펙인가 운영 이슈인가 | `spec` (기본값) |
| Meeting (커스텀) | 회의록 vs 회고 | `meeting` (둘 다) |
| Initiative (커스텀) | 상위 기획 | `spec` + tags에 `initiative` |

**4.4.3 태그 체계 (Confluence §6.3 적용)**

| 소스 | 태그 생성 방법 |
|------|---------------|
| Jira labels | 그대로 → tags 배열에 포함 |
| components | `component-{name}` 형태로 태그화 |
| Epic 이름 | Epic 관련 이슈에 공통 태그 부여 |
| 고정 태그 | `jira` (모든 Jira 이슈), `jira-aggregate` (집계 문서) |

> **Confluence §6.3.1 적용**: 태그 수 과다 시 Graph RAG 필터 정확도 하락. Jira labels 중 `temp`, `test`, `spike` 등 일시적 라벨은 태그에서 제외.

**4.5 링크 강화 단계 (Confluence §7-9)**

**4.5.1 inject_keywords.py와 Jira KEY 패턴 충돌**

> Confluence §9.2 Placeholder 방식 필수

Jira 고유 문제: 본문에 `PROJ-123` 텍스트가 등장하면 inject_keywords.py가 이를 키워드로 인식할 수 있다.

| 문제 | 대응 |
|------|------|
| `PROJ-123`이 키워드 매칭됨 | Jira KEY 패턴 `[A-Z]+-\d+`를 STOPWORDS에 추가 |
| `[[PROJ-123]]` 안의 KEY가 다시 치환됨 | Placeholder 방식으로 기존 `[[]]` 보호 (Confluence §9.2 동일) |
| Epic 이름이 범용어 | `Epic — 알림` → "알림"이 모든 문서에 주입됨 | MAX_RATE 15% 초과 시 자동 제외 (Confluence §9.6) |

**4.5.2 클러스터 링크 — 집계 문서 간 (Confluence §7.1 적용)**

같은 component를 가진 Epic 집계 문서끼리 자동 링크:

```
[[Epic — 로그인 시스템]]  ←→  [[Epic — 회원가입]]
  (component: Auth, Backend)    (component: Auth, Frontend)
```

**4.5.3 Ghost → Real 허브 교체 (Confluence §8.3 적용)**

| Ghost 링크 | Real 허브 |
|-----------|-----------|
| `[[로그인]]` (파일 없음) | `[[Epic — 로그인 시스템\|로그인]]` |
| `[[Sprint 13]]` (축약) | `[[Sprint 2026-W13\|Sprint 13]]` |
| `[[v2.1]]` (축약) | `[[Release v2.1\|v2.1]]` |

**4.6 BFS · PageRank 최적화 (Confluence §10-11)**

**4.6.1 집계 문서 상단 배치 (Confluence §10.2-10.3 적용)**

PPR 엔진은 순위별 글자 수 예산으로 문서를 읽는다 (1~3위: 1,500자, 4~8위: 900자).

집계 문서 구조 필수 사항:
```markdown
# Epic — 로그인 시스템          ← 제목
> PROJ-100 | 담당: 홍길동       ← 1줄 메타

## 진행 현황                     ← 1,500자 예산 내 핵심 정보
| 상태 | 건수 | 비율 |
...

## 핵심 결정사항                 ← 의사결정 (여기까지 900자 내)
...

## 하위 이슈                     ← 상세 (500자 이후)
...
```

> **핵심**: 하위 이슈 테이블이 상단에 오면 PPR 예산을 소진하고 정작 "진행률/결정사항"이 잘린다.

**4.6.2 PageRank 왜곡 방지 (Confluence §11 적용)**

| Confluence 문제 | Jira 시나리오 | 대응 |
|----------------|--------------|------|
| Ghost 노드가 PageRank 상위 | 삭제된 이슈 KEY가 여러 집계 문서에서 참조 | §4.1.3 dead link 정리 |
| 오래된 허브가 높은 PageRank | 완료된 Sprint 집계에 누적 링크 | Sprint 집계는 `status: outdated` 전환 |
| 새 문서 그래프 고립 | 새 Epic 집계가 어디에서도 링크 안 됨 | Release/Component 집계에서 자동 역링크 |

**4.6.3 연도별 허브 구조 (Confluence §11.1 적용)**

Sprint 집계 문서가 다수일 때:
```
Jira 프로젝트 개요 (최상위 허브)
└── Sprint Archive 2026
    ├── [[Sprint 2026-W01]]
    ├── [[Sprint 2026-W02]]
    └── ...
```

> 최신 Sprint를 허브 상단 "최근 Sprint" 섹션에 배치 (Confluence §18.2 "최근 추가" 패턴).

**4.7 이미지 · 첨부 관리 (Confluence §12)**

| Confluence | Jira |
|-----------|------|
| ac:image → `![[파일명.png]]` | ADF mediaSingle → `![[파일명]]` |
| attachments/ 폴더에 저장 | **선택적**: 대부분 스크린샷 → 텍스트 설명으로 대체 권장 |
| 파일명 규칙: `{stem}_{page}_{index}.png` | `{jira_key}_{index}.ext` |

> **결정**: Jira 첨부 이미지를 모두 다운로드하면 볼트 크기 폭발. **기본 정책: 이미지 다운로드 안 함, 텍스트 메타만 기록**. 핵심 아키텍처 다이어그램 등은 수동으로 지정 다운로드.

**4.8 품질 감사 적용 (Confluence §13)**

**4.8.1 check_quality.py Jira 확장 항목**

기존 12개 항목 + Jira 전용 항목:

| 항목 | 설명 |
|------|------|
| ⑬ raw 이슈 graph_weight | skip이 아닌 raw 이슈 탐지 |
| ⑭ 집계 문서 origin | `jira_aggregate`가 아닌 집계 문서 탐지 |
| ⑮ 타 프로젝트 KEY 링크 | `[[OTHER-\d+]]` 패턴 탐지 |
| ⑯ 집계 문서 정합성 | Epic 하위 이슈 수 != raw 파일 수 |

**4.8.2 audit_and_fix.py 확장**

| 수정 항목 | Confluence 원본 | Jira 적용 |
|-----------|----------------|-----------|
| 중첩 wikilink | §13.2 ①번 | 동일 적용 |
| 괄호 파일명 절단 | §13.2.1 | Epic 이름에 괄호 → 파일명 안전화 |
| 깨진 이미지 링크 | §13.2 ④번 | Jira 첨부 미다운로드 시 해당 없음 |
| HTML 잔재 태그 | §13.2 ⑥번 | ADF 파싱 잔재 제거 |

**4.9 날짜 오염 (Confluence §18.5 대입)**

**4.9.1 Jira `updated` 필드 오염**

> Confluence: 배치 동기화 시 `version.when`이 동기화 날짜로 일괄 덮어씌워짐 (§18.5)

Jira 시나리오:
- **댓글 추가만으로 `updated` 갱신**: 봇이 자동 댓글을 달면 전체 이슈의 `updated`가 오늘로 변경
- **상태 전이(Transition)**: 일괄 상태 변경(예: Sprint 완료 처리) 시 수십 개 이슈의 `updated`가 동시에 갱신
- **필드 일괄 수정**: 관리자가 labels/components를 일괄 변경

| 오염 유형 | 판별 | 대응 |
|-----------|------|------|
| 봇 댓글 일괄 | 동일 `updated` 날짜 이슈 10개+ | `created` 우선 사용 (date 필드) |
| Sprint 완료 | Sprint 종료일 직후 집중 | Sprint 내 이슈는 Sprint 종료일을 date로 사용 |
| 관리자 일괄 수정 | changelog에서 bulk 패턴 감지 | changelog가 아닌 description/comment 최종 수정일 사용 |

**날짜 우선순위** (Confluence §18.5.4 "근본 재발 방지" 대입):

```
1. 파일명 날짜 패턴 (해당 시)
2. resolutiondate (완료된 이슈)
3. created (생성일 — 가장 안정적)
4. updated (최후 수단)
```

> **Confluence와의 차이**: Confluence는 `created_date`가 변하지 않아 안전. Jira도 `created`는 불변이므로 동일하게 안전. `updated`는 Confluence `modified_date`와 동일한 오염 리스크.

**4.10 최신성 버그 (Confluence §18 대입)**

**4.10.1 구 Sprint 문서가 검색 상위**

> Confluence: 오래된 연도 허브가 높은 PageRank → 구버전 응답 (§18.1)

Jira: 완료된 Sprint 집계가 시간이 쌓이며 인바운드 링크 증가 → "2024년 Sprint 기준으로..." 응답

**대응**:
- 완료 Sprint: `status: outdated` 전환
- 현재/직전 Sprint만 `status: active` 유지
- Sprint Archive 허브 상단에 "현재 Sprint" 섹션 (§4.6.3)

**4.10.2 새 집계 문서 그래프 고립**

> Confluence: 신규 문서에 역링크 없으면 BFS 도달 불가 (§18.1)

Jira: 새 Epic 집계 → Release/Component 집계에서 아직 링크 없음 → "그런 Epic은 없다" 응답

**대응**: jira_crosslink.py에서 **모든 집계 문서 간 상호 링크** 자동 생성 (§1.2). 누락 시 check_quality.py §3.4 ⑳번에서 탐지.

**4.11 AI 컨텍스트 한계 (Confluence §19 대입)**

**4.11.1 대형 프로젝트 정제 세션 분할**

> Confluence: 14단계 파이프라인을 한 세션에서 완료 불가 (§19.1)

Jira 규모별 세션 계획:

| 이슈 수 | 예상 세션 | 분할 기준 |
|---------|-----------|-----------|
| ~100 | 1 세션 | 전체 파이프라인 |
| 100~500 | 2 세션 | ①②③ / ④⑤⑥⑦ |
| 500+ | 3+ 세션 | ①② / ③ / ④⑤⑥⑦ (집계가 가장 토큰 소모 큼) |

**4.11.2 체크포인트 파일**

```json
// jira/raw/.checkpoint.json
{
  "last_completed_step": 3,
  "timestamp": "2026-03-25T14:30:00Z",
  "stats": {
    "fetched": 450,
    "converted": 438,
    "deleted": 12,
    "aggregated": { "epic": 8, "sprint": 6, "component": 4, "release": 2 }
  }
}
```

**4.11.3 세션 인계 프롬프트**

```
이전 Jira 정제 세션 이어받기.
- 완료: ① fetch (450건) ② convert (438건) ③ aggregate (Epic 8, Sprint 6)
- 다음: ④ crosslink 주입
- 참조: s10_jira_fetch.md, s11_jira_aggregate.md, s12_jira_crosslink.md
- 볼트 경로: {vault_path}/jira/
- 체크포인트: jira/raw/.checkpoint.json 확인
```

**4.12 customfield 인스턴스 차이**

> **이 문제는 Confluence에 없는 Jira 고유 문제.**

| 필드 | 일반적 ID | 실제 인스턴스 ID |
|------|-----------|-----------------|
| Story Points | `customfield_10016` | 인스턴스마다 다름 |
| Epic Name | `customfield_10014` | 인스턴스마다 다름 |
| Sprint | `customfield_10020` (또는 `sprint`) | 인스턴스마다 다름 |

**대응**: 최초 연결 시 `GET /rest/api/2/field`를 호출하여 필드 매핑을 자동 구축하고 `jira/raw/.field_map.json`에 저장. 이후 변환 시 이 매핑 참조.

**4.13 보조 문서 생성 (Confluence §14 적용)**

| Confluence 보조 문서 | Jira 대응 |
|---------------------|-----------|
| currentSituation.md | Jira 프로젝트 개요 문서 (자동 생성) |
| _index.md | gen_index.py에 jira/ 폴더 포함 |
| 태그_정의서.md | Jira labels → 태그 매핑 추가 |

**Jira 프로젝트 개요 문서** (자동 생성):
```markdown
---
title: "Jira 프로젝트 — PROJ"
type: reference
status: active
origin: jira_aggregate
graph_weight: normal
tags: [jira, project-overview]
date: 2026-03-25
---

# Jira 프로젝트 — PROJ

## 현황 요약
| 지표 | 값 |
|------|-----|
| 전체 이슈 | 450 |
| 활성 | 120 |
| Epic | 8 |
| Sprint (현재) | Sprint 2026-W13 |

## 활성 Epic
- [[Epic — 로그인 시스템]] (80%)
- [[Epic — 대시보드 개편]] (100%)

## 현재 Sprint
- [[Sprint 2026-W13]] (진행중)
```

---

> **5. AI 자율 정제 가이드**

**5.1 MCP 도구 사용 순서**

```
1. jira_sync        ← Jira REST 연결 테스트 + 데이터 fetch
2. vault_reload     ← 볼트에 새 파일 반영
3. search_bm25      ← 생성된 집계 문서 검증
4. graph_stats      ← 노드/링크 수 확인
5. chat_persona     ← 집계 문서 품질 자연어 검증
```

**5.2 Edit Agent 자율 정제 프롬프트**

```
Jira 정제를 수행합니다.

매뉴얼 참조: s10_jira_fetch.md, s11_jira_aggregate.md, s12_jira_crosslink.md

파이프라인:
1. jira_sync 도구로 프로젝트 이슈를 가져옵니다.
2. s10 §4 Triage 기준으로 분류합니다 (삭제/skip/low).
3. s11 §2-6 템플릿으로 4축 집계 문서를 생성합니다.
4. s12 §1 규칙으로 교차 링크를 주입합니다.
5. gen_index.py → inject_keywords.py 순서로 실행합니다.
6. s12 §3 품질 체크리스트를 실행합니다.

주의사항 (s12 §4에서 도출):
- raw 이슈는 반드시 graph_weight: skip
- 집계 문서는 graph_weight: normal
- 링크 주입 전 대상 파일 존재 확인 (팬텀 노드 방지)
- 타 프로젝트 KEY는 [[]] 링크가 아닌 텍스트로
- 스크립트는 1회만 실행 (중복 링크 방지)
- 날짜는 created 우선, updated는 오염 위험
- Epic 집계 50건 초과 시 분할 검토
- 집계 문서 상단 1,500자에 핵심 정보 배치
- customfield ID는 .field_map.json 참조
```

**5.3 정제 완료 판정**

| 조건 | 기준 |
|------|------|
| raw 이슈 변환율 | fetch 건수 대비 ≥ 95% (삭제 제외) |
| 집계 문서 생성 | 해당 축 조건 충족 시 100% |
| 교차 링크 | remotelink 보유 이슈의 ≥ 80% 연결 |
| 팬텀 노드 | 0개 |
| 고립 집계 문서 | 0개 |
| 품질 감사 통과 | §3 체크리스트 22항목 전체 pass |
| BFS 예산 준수 | 집계 문서 상위 1,500자에 핵심 정보 |

**5.4 정기 모니터링**

> **Confluence §18.3 check_outdated.py 대입**

```bash
# 주간 점검 스크립트
check_quality.py jira/        # 전체 품질
check_outdated.py jira/ --days 7  # 최신성
```

| 경고 | 대응 |
|------|------|
| 고립 집계 문서 | jira_crosslink.py 재실행 |
| outdated Sprint 미정리 | status: outdated 전환 |
| date 오염 의심 (동일 날짜 10개+) | §4.9 날짜 우선순위로 재생성 |
| 팬텀 노드 발견 | 해당 KEY 삭제 여부 확인 → 링크 제거 |
