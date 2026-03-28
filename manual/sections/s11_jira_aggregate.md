> **Jira 정제 ② — 집계 문서 생성**

*개별 이슈를 Epic · Sprint · Component · Release 축으로 묶어 AI가 활용 가능한 지식 문서를 만든다.*

v1.0 | 2026-03-25

---

## 목차

| § | 내용 |
|---|------|
| 1 | 왜 집계가 필요한가 |
| 2 | 집계 축 4가지 — 생성 조건, graph_weight |
| 3 | Epic 집계 문서 구조 |
| 4 | Sprint 집계 문서 구조 |
| 5 | Component 집계 문서 구조 |
| 6 | Release 집계 문서 구조 |
| 7 | LLM 개입 범위 |

---

> **1. 왜 집계가 필요한가**

개별 이슈 .md는 `graph_weight: skip`으로 그래프에서 제외된다.
AI가 실제로 활용하는 것은 **이 단계에서 생성하는 집계 문서**이다.

| 질문 | 개별 이슈 | 집계 문서 |
|------|:---:|:---:|
| "이번 달 뭐 했어?" | 500개 스캔 필요 | Sprint 1개로 답변 |
| "로그인 기능 진행률?" | Epic 하위 이슈 수동 취합 | Epic 문서에 즉시 |
| "백엔드 병목 어디야?" | 판단 불가 | Component 문서에 패턴 |
| "v2.1 리스크?" | fixVersion 수동 필터 | Release 문서에 정리 |

---

> **2. 집계 축 4가지**

| 축 | 파일명 패턴 | 생성 조건 | graph_weight |
|---|---|---|---|
| **Epic** | `jira/Epic — {이름}.md` | Epic 이슈 존재 시 | normal |
| **Sprint** | `jira/Sprint {이름}.md` | 스프린트 데이터 존재 시 | normal |
| **Component** | `jira/Component — {이름}.md` | 배정 이슈 ≥ 5개 | normal |
| **Release** | `jira/Release {버전}.md` | fixVersion 배정 ≥ 3개 | normal |

> 집계 문서는 `graph_weight: normal` — 그래프 정식 노드로 참여.

---

> **3. Epic 집계 문서**

```markdown
---
title: "Epic — 로그인 시스템"
type: spec
status: active
origin: jira_aggregate
source: "https://jira.example.com/browse/PROJ-100"
tags: [jira, epic, auth, backend]
date: 2026-03-25
---

# Epic — 로그인 시스템

> PROJ-100 | 담당: 홍길동 | 시작: 2026-02-01

## 진행 현황

| 상태 | 건수 | 비율 |
|------|------|------|
| Done | 8 | 53% |
| In Progress | 4 | 27% |
| To Do | 3 | 20% |
| **합계** | **15** | — |

## 핵심 결정사항

> 하위 이슈 댓글에서 "결정", "합의", "확정" 키워드 포함 코멘트를 추출.
> 없으면 섹션 생략.

- (2026-03-10) OAuth 2.0 PKCE 채택 — [[PROJ-105]]
- (2026-03-15) 세션 만료 30→60분 — [[PROJ-112]]

## 하위 이슈

| Key | 제목 | 상태 | 담당 | SP |
|-----|------|------|------|-----|
| [[PROJ-101]] | 소셜 로그인 Google | Done | 홍길동 | 3 |
| [[PROJ-102]] | 소셜 로그인 Apple | In Progress | 김영희 | 5 |
| [[PROJ-103]] | 비밀번호 재설정 | To Do | — | 2 |

## 관련 문서

- [[로그인 기술 설계서]]       ← s12 교차 링크에서 주입
- [[2026-W10 스프린트 리뷰]]
```

**status 결정**: 하위 이슈 중 미완료가 있으면 `active`, 전부 Done이면 `outdated`.

---

> **4. Sprint 집계 문서**

```markdown
---
title: "Sprint 2026-W13"
type: meeting
status: active
origin: jira_aggregate
tags: [jira, sprint, w13]
date: 2026-03-28
---

# Sprint 2026-W13

> 2026-03-17 ~ 2026-03-28 | 목표: 로그인 v2 마무리

## 번다운 요약

| 지표 | 값 |
|------|-----|
| 시작 시 이슈 | 12 |
| 완료 | 9 |
| 미완료 (이월) | 3 |
| 완료율 | 75% |
| 총 SP | 34 |
| 완료 SP | 26 |

## 완료 항목

| Key | 제목 | Epic | SP |
|-----|------|------|-----|
| [[PROJ-101]] | 소셜 로그인 Google | 로그인 시스템 | 3 |

## 미완료 (이월)

| Key | 제목 | 사유 |
|-----|------|------|
| [[PROJ-108]] | 2FA TOTP | 외부 라이브러리 이슈 |

## 블로커

- PROJ-108: OTP 라이브러리 보안 취약점 → 대안 조사 중
```

**type = meeting**: 스프린트는 주기적 리뷰 성격.
**확정 시점**: 스프린트 종료 후 1회 생성, 이후 수정 안 함.

---

> **5. Component 집계 문서**

```markdown
---
title: "Component — Backend"
type: reference
status: active
origin: jira_aggregate
tags: [jira, component, backend]
date: 2026-03-25
---

# Component — Backend

## 현황

| 지표 | 값 |
|------|-----|
| 전체 이슈 | 48 |
| 활성 | 12 |
| 버그 비율 | 23% |
| 평균 해결 시간 | 4.2일 |

## 활성 이슈

| Key | 제목 | 유형 | 우선순위 | 담당 |
|-----|------|------|---------|------|
| [[PROJ-201]] | API 응답 속도 저하 | Bug | Critical | 이철수 |

## 최근 완료 (30일)

| Key | 제목 | 해결일 |
|-----|------|--------|
| [[PROJ-195]] | DB 커넥션 풀 최적화 | 2026-03-18 |

## 반복 패턴

> 동일 컴포넌트 Bug에서 공통 키워드 추출.

- **DB 연결**: PROJ-195, PROJ-182, PROJ-170 — 3건
- **인증 토큰**: PROJ-188, PROJ-163 — 2건
```

---

> **6. Release 집계 문서**

```markdown
---
title: "Release v2.1"
type: spec
status: active
origin: jira_aggregate
tags: [jira, release, v2.1]
date: 2026-03-25
---

# Release v2.1

> 예정: 2026-04-15 | Epic 3개 포함

## 포함 기능

| Epic | 완료율 | 리스크 |
|------|--------|--------|
| [[Epic — 로그인 시스템]] | 80% | 2FA 이슈 |
| [[Epic — 대시보드 개편]] | 100% | — |
| [[Epic — 알림 시스템]] | 45% | 일정 촉박 |

## 미해결 이슈

| Key | 제목 | 상태 | 담당 |
|-----|------|------|------|
| [[PROJ-108]] | 2FA TOTP | In Progress | 홍길동 |
```

---

> **7. LLM 개입 범위**

| 섹션 | 코드 자동 | LLM 보강 (선택) |
|------|:---:|:---:|
| 통계 테이블 | O | — |
| 이슈 목록 | O | — |
| 핵심 결정사항 | △ 키워드 필터 | O 요약 정제 |
| 반복 패턴 | △ 키워드 클러스터 | O 패턴 해석 |
| 블로커 분석 | O 상태 추출 | O 영향도 분석 |
| 1줄 요약 | — | O |

> **기본 모드**: LLM 없이 코드만으로 생성.
> **보강 모드**: `edit_agent_refine` 또는 `chat_persona`로 요약 추가.
