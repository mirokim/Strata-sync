> **Jira 정제 ① — Fetch · 변환 · 분류**

*Jira REST API에서 전체 항목을 가져와 개별 Markdown으로 변환하고, 보존/격리/삭제를 분류한다.*

v1.0 | 2026-03-25

---

## 목차

| § | 내용 |
|---|------|
| 1 | Jira 데이터 특성 — Confluence와의 차이, 가공 없이 투입 시 문제 |
| 2 | Raw Fetch — REST API, 인증, 페이징, JQL |
| 3 | 1:1 변환 — Frontmatter, ADF/Wiki 파싱, issuelinks |
| 4 | Triage — 삭제·격리·보존 기준 |
| 5 | Fetch 필드 전체 목록 |
| 6 | 첨부파일 처리 — 이미지·문서 전략 |

---

> **1. Jira 데이터 특성**

**1.1 Confluence와의 차이**

| | Confluence | Jira |
|---|---|---|
| 본질 | 정리된 지식 문서 | 작업 추적 티켓 |
| 단일 항목 정보량 | 높음 | 낮음 ("로그인 버그 수정" 한 줄) |
| 가치 발생 지점 | 개별 문서 | 패턴·흐름·집계 |
| 변환 전략 | 1:1로 충분 | 1:1 + **집계 문서 필수** |

**1.2 가공 없이 투입하면 생기는 문제**

- BM25 노이즈 폭발 — 500개 얇은 .md가 검색 상위 점령
- 그래프 오염 — 이슈 노드 대량 생성 → PageRank 왜곡
- 이슈 간 관계 소실 — Epic → Story → Sub-task 계층 평탄화

> **핵심 판단: "이 이슈 하나를 가져왔을 때 AI가 의사결정에 쓸 수 있는가?"**
> 대부분 "아니오". 개별 이슈는 원본 보존용, AI가 쓰는 건 **집계 문서**.

---

> **2. Raw Fetch**

**2.1 REST API**

```
GET /rest/api/2/search
  ?jql={JQL}
  &maxResults=100
  &startAt={offset}
  &fields={§5 필드 목록}
  &expand=renderedFields,names,changelog
```

**2.2 인증**

| 방식 | Header | 용도 |
|------|--------|------|
| Cloud API 토큰 | `Basic base64(email:token)` | Atlassian Cloud |
| Server PAT | `Bearer {PAT}` | Server/Data Center |
| Server Basic | `Basic base64(user:password)` | 레거시 |

**2.3 페이징 (필수)**

maxResults 최대 100. 전체를 가져오려면 반드시 루프:

```
offset = 0
while offset < total:
    response = fetch(startAt=offset, maxResults=100)
    total = response.total
    issues += response.issues
    offset += 100
```

**2.4 JQL 패턴**

| 목적 | JQL |
|------|-----|
| 전체 | `project = PROJ ORDER BY updated DESC` |
| 증분 | `project = PROJ AND updated >= "2026-03-20"` |
| 활성만 | `project = PROJ AND status NOT IN (Done, Closed, Cancelled)` |
| Epic + 하위 | `issuetype IN (Epic, Story, Task, Sub-task) ORDER BY issuetype ASC` |
| 특정 스프린트 | `sprint = "Sprint 13" ORDER BY rank ASC` |

---

> **3. 1:1 변환**

**3.1 파일 구조**

```
jira/
├── raw/                     ← 개별 이슈 (graph_weight: skip/low)
│   ├── PROJ-1.md
│   └── PROJ-2.md
├── Epic — 로그인 시스템.md   ← 집계 (s11_jira_aggregate.md 참조)
├── Release v2.1.md
└── _attachments/            ← 원본 이미지·문서 (볼트 루트 기준)
    └── PROJ-123/
        ├── screenshot.png
        └── spec.xlsx
```

**3.2 Frontmatter**

```yaml
---
title: "PROJ-123 로그인 에러 메시지 개선"
jira_key: PROJ-123
type: spec                  # §3.4 매핑 참조
status: active              # §3.5 매핑 참조
origin: jira
source: "https://jira.example.com/browse/PROJ-123"
graph_weight: skip          # raw 이슈 기본값 (low로 승격 가능)
priority: High
assignee: 홍길동
reporter: 김영희
date: 2026-03-20
created: 2026-03-15
parent_key: PROJ-100        # 상위 Epic 키 (Epic 집계 연결용)
sprint: "Sprint 13"
story_points: 5
components: [Backend, Auth]
fix_versions: [v2.1]
tags: [jira, story, backend, auth]
related: []                 # 집계 문서 참조 (s12에서 주입)
---
```

**3.3 본문 구조**

```markdown
# [PROJ-123] 로그인 에러 메시지 개선

| 항목 | 값 |
|------|-----|
| 유형 | Story |
| 상태 | In Progress |
| 담당자 | 홍길동 |
| 상위 이슈 | [[PROJ-100]] |
| 스프린트 | Sprint 13 |
| Story Points | 5 |

## 설명
{ADF → 평문 텍스트 변환 / wiki markup 정리}

## 관련 이슈
- Blocks: [[PROJ-124]]
- Related: [[PROJ-110]]

## 댓글
### 홍길동 (2026-03-18)
{댓글 본문}

## 첨부파일
![[_attachments/PROJ-123/screenshot.png]]
- [spec.xlsx](_attachments/PROJ-123/spec.xlsx)
```

**3.4 type 매핑 — issueType → vault type**

| issueType | vault type |
|-----------|-----------|
| Epic / Story / Task / Sub-task / Bug | spec |
| Meeting / 회의 / Retrospective | meeting |
| Decision / ADR | decision |
| Guide / Manual | guide |

**3.5 status 매핑**

| Jira status | vault status |
|------------|-------------|
| To Do / Open / In Progress / In Review | active |
| Done / Closed / Resolved | outdated |
| Cancelled / Won't Fix | deprecated |

**3.6 ADF 변환 (Cloud v3)**

| ADF 노드 | Markdown |
|-----------|----------|
| `paragraph` | 텍스트 + `\n` |
| `heading` (level N) | `#` × N |
| `text` + `strong` | `**bold**` |
| `text` + `em` | `*italic*` |
| `text` + `code` | `` `code` `` |
| `text` + `link` | `[text](url)` |
| `bulletList` | `- item` |
| `codeBlock` | ` ```lang ``` ` |
| `table` | `\| cell \|` |
| `mention` | `@이름` |

**3.7 Wiki 변환 (Server v2)**

| Wiki | Markdown |
|------|----------|
| `h1. 제목` | `# 제목` |
| `*bold*` | `**bold**` |
| `_italic_` | `*italic*` |
| `{code:java}...{code}` | ` ```java ``` ` |
| `[텍스트\|URL]` | `[텍스트](URL)` |

**3.8 issuelinks 변환**

| Jira 관계 | 변환 |
|-----------|------|
| Blocks (outward) | `- Blocks: [[KEY]]` |
| Blocks (inward) | `- Blocked by: [[KEY]]` |
| Duplicate | `- Duplicate: [[KEY]]` |
| Relates | `- Related: [[KEY]]` |

---

> **4. Triage (분류)**

**4.1 삭제 — 파일 미생성**

| 조건 |
|------|
| description 없고 댓글 0개 (빈 티켓) |
| Sub-task + description 50자 미만 + 댓글 0개 |
| 라벨에 `test`, `temp`, `spike` |
| Cancelled/Won't Fix 상태 + 댓글 0개 |

**4.2 격리 — graph_weight: skip (기본값)**

삭제·low 조건을 모두 통과한 이슈의 기본값.

**4.3 보존 — graph_weight: low 승격**

아래 중 **1개 이상** 충족:

| 조건 |
|------|
| Epic 이슈 (항상) |
| description ≥ 300자 |
| issuelinks ≥ 3 |
| 댓글에 "결정", "합의", "확정", "채택" 포함 |
| 라벨에 `decision`, `adr`, `important` |

**4.4 요약 흐름**

```
이슈 →  빈 티켓?           → YES → 삭제
     →  라벨 test/temp?    → YES → 삭제
     →  취소+댓글0?         → YES → 삭제
     →  Epic?              → YES → low
     →  description≥300?   → YES → low
     →  issuelinks≥3?      → YES → low
     →  댓글에 결정키워드?   → YES → low
     →  그 외              →      → skip (기본)
```

---

> **5. Fetch 필드 전체 목록**

```
summary,description,status,issuetype,priority,
assignee,reporter,creator,
created,updated,resolutiondate,duedate,
labels,components,fixVersions,
sprint,customfield_10016,
parent,subtasks,issuelinks,
comment,timetracking,resolution,customfield_10014
```

| 필드 | 용도 |
|------|------|
| `summary` | 제목, 파일명 |
| `description` | 본문 (ADF/Wiki) |
| `status` | 상태 매핑, triage |
| `issuetype` | 타입 매핑, triage |
| `priority` | frontmatter |
| `assignee` / `reporter` / `creator` | 사람 정보, speaker 추론 |
| `created` / `updated` | 날짜, 증분 동기화 기준 |
| `resolutiondate` / `duedate` | 해결 시간, 릴리스 리스크 |
| `labels` | 태그, triage |
| `components` | 컴포넌트 집계 축 |
| `fixVersions` | 릴리스 집계 축 |
| `sprint` | 스프린트 집계 축 |
| `customfield_10016` | 스토리 포인트 |
| `parent` | Epic 상위 링크 |
| `subtasks` | 하위 이슈 |
| `issuelinks` | 이슈 간 관계, 교차 링크 |
| `comment` | 결정사항 추출 |
| `timetracking` | 시간 추적 (선택) |
| `resolution` | Won't Fix 판별 |
| `customfield_10014` | Epic Name (Cloud) |

> `customfield_*` 번호는 인스턴스마다 다르다. `GET /rest/api/2/field`로 확인.

---

> **6. 첨부파일 처리**

**6.1 다운로드 구조**

```
_attachments/
└── {ISSUE-KEY}/
    ├── screenshot.png
    ├── spec.xlsx
    └── recording.mp4
```

다운로더가 `_attachments/{KEY}/` 폴더에 이슈별로 저장.

**6.2 파일 유형별 전략**

| 유형 | 확장자 | 처리 방법 | 볼트 기여 |
|------|--------|-----------|---------|
| 이미지 | png, jpg, gif, webp | `![[_attachments/KEY/file]]` 참조 | 그래프 노드 (BM25 기여 없음) |
| 스프레드시트 | xlsx, xlsm, csv | `tools/xlsx_to_md.py` 변환 → 볼트 저장 | **높음** |
| 프레젠테이션 | pptx | `tools/pptx_to_md.py` 변환 → 볼트 저장 | **높음** |
| 문서 | pdf, docx | `tools/pdf_to_md.py` / `tools/docx_to_md.py` | **높음** |
| 동영상 | mp4 | 무시 | 없음 |
| 기타 | pvm 등 | 무시 | 없음 |

**6.3 이슈 MD 내 참조 방법**

```markdown
## 첨부파일

![[_attachments/PROJ-123/screenshot.png]]

- [spec.xlsx](_attachments/PROJ-123/spec.xlsx)
- [design.pptx](_attachments/PROJ-123/design.pptx)
```

> 이미지는 `![[]]` (sandbox_map 그래프에 이미지 노드로 시각화), 문서는 일반 링크로 표기.
> XLSX/PPTX/PDF는 별도로 MD 변환 후 볼트에 추가하면 BM25 검색 가능.

**6.4 우선순위**

1. XLSX/XLSM (기획 데이터, 스펙 테이블) — 변환 가치 최고
2. PPTX (보고서, 설계서)
3. PDF / DOCX
4. 이미지 — 참조만, 변환 불필요
