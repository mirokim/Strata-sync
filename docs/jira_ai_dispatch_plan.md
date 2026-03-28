# Jira AI Dispatch — 기획 및 구현 계획

**목표**: 최근 이슈·이사장 피드백을 AI가 분석 → 팀원별 Jira 일감 자동 발행

---

## 1. 전체 워크플로우

```
① 컨텍스트 수집
   - 볼트: 최근 이사장 피드백 문서 (search_bm25 / vault_read)
   - Jira: 최근 미해결 이슈 (jira_sync 또는 직접 JQL 조회)

② AI 분석 (Claude Code 또는 chat_persona)
   - 피드백에서 액션 아이템 추출
   - 팀원 역할표 참조 → 담당자 자동 매핑
   - 이슈 제목 / 설명 / 우선순위 초안 생성

③ 일감 발행
   - jira_create_issue 도구로 각 팀원에게 Jira 이슈 생성
   - (선택) Slack 알림: slack_send로 팀 채널에 발행 내역 공유

④ 결과 확인
   - jira_sync 재실행 → 볼트에 신규 이슈 반영
```

---

## 2. 필요한 신규 구현

### 2-A. 팀원 목록 Config (`mcp-config.json`)

```json
{
  "teamMembers": [
    {
      "name": "홍길동",
      "jiraAccountId": "712020:xxxxxxxx-...",
      "role": "아트 디렉터",
      "responsibilities": ["캐릭터 컨셉", "아트 파이프라인", "외주 관리"]
    },
    {
      "name": "김철수",
      "jiraAccountId": "712020:yyyyyyyy-...",
      "role": "게임 디자이너",
      "responsibilities": ["스킬 기획", "밸런싱", "전투 시스템"]
    }
  ]
}
```

**jiraAccountId 확인 방법**:
```
GET https://{도메인}.atlassian.net/rest/api/3/users/search?query={이름}
→ accountId 필드 값
```

또는 새 도구 `jira_get_members`로 자동 조회 가능 (2-C 참고).

### 2-B. 신규 MCP 도구 — `jira_create_issue`

**위치**: `mcp/src/server.ts` (기존 `jira_sync` 옆)

```typescript
// 도구 정의
{ name: 'jira_create_issue',
  description: 'Create a new Jira issue and optionally assign to a team member',
  inputSchema: {
    type: 'object',
    properties: {
      summary:     { type: 'string', description: '이슈 제목' },
      description: { type: 'string', description: '이슈 설명 (마크다운)' },
      issuetype:   { type: 'string', description: 'Task | Story | Bug | Sub-task', default: 'Task' },
      assigneeAccountId: { type: 'string', description: '담당자 Jira accountId' },
      priority:    { type: 'string', description: 'Highest | High | Medium | Low | Lowest', default: 'Medium' },
      labels:      { type: 'array', items: { type: 'string' }, description: '레이블 목록' },
      parentKey:   { type: 'string', description: '상위 Epic/Story 키 (선택)' },
    },
    required: ['summary']
  }
}
```

**API 호출**:
```
POST https://{baseUrl}/rest/api/3/issue
Authorization: Basic base64(email:apiToken)
Content-Type: application/json

{
  "fields": {
    "project":     { "key": "{projectKey}" },
    "summary":     "...",
    "description": { "version": 1, "type": "doc", "content": [...] },
    "issuetype":   { "name": "Task" },
    "assignee":    { "accountId": "..." },
    "priority":    { "name": "Medium" },
    "labels":      ["ai-dispatch"]
  }
}
```

### 2-C. 신규 MCP 도구 — `jira_get_members` (선택)

Jira 프로젝트 멤버 목록과 accountId를 자동으로 가져오는 도구.
초기 팀원 Config 세팅을 돕기 위한 유틸리티 도구.

```
GET /rest/api/3/user/assignable/search?project={projectKey}
→ [{ accountId, displayName, emailAddress }, ...]
```

### 2-D. 신규 MCP 도구 — `jira_dispatch` (통합 워크플로우)

AI 분석 + 일감 발행을 한 번에 실행하는 고수준 도구.
내부적으로 `jira_create_issue`를 반복 호출.

```typescript
{ name: 'jira_dispatch',
  description: 'AI가 피드백을 분석하고 팀원에게 Jira 이슈를 일괄 발행',
  inputSchema: {
    properties: {
      feedbackQuery: { type: 'string', description: '피드백 검색 쿼리 (볼트 검색용)' },
      feedbackText:  { type: 'string', description: '직접 입력할 피드백 텍스트 (선택)' },
      model:         { type: 'string', description: 'AI 분석에 사용할 모델 (선택)' },
      dryRun:        { type: 'boolean', description: 'true면 실제 발행 없이 미리보기만', default: false }
    }
  }
}
```

---

## 3. Config 스키마 변경 (`mcp/src/config.ts`)

```typescript
export interface TeamMember {
  name: string
  jiraAccountId: string
  role: string
  responsibilities: string[]
}

export interface McpConfig {
  // ... 기존 필드
  teamMembers: TeamMember[]
}
```

---

## 4. AI 프롬프트 설계

`jira_dispatch` 내부에서 LLM에게 전달할 프롬프트 구조:

```
[시스템]
당신은 프로젝트 매니저입니다.
아래 팀원 목록과 역할을 참고하여, 피드백에서 액션 아이템을 추출하고
각 팀원에게 적합한 Jira 이슈를 생성해주세요.

[팀원 목록]
- 홍길동 (아트 디렉터): 캐릭터 컨셉, 아트 파이프라인, 외주 관리
- 김철수 (게임 디자이너): 스킬 기획, 밸런싱, 전투 시스템
...

[피드백 내용]
{feedbackText 또는 볼트 검색 결과}

[출력 형식 — JSON]
[
  {
    "summary": "이슈 제목",
    "description": "상세 설명",
    "assigneeName": "홍길동",
    "priority": "High",
    "labels": ["이사장피드백", "긴급"]
  }
]
```

---

## 5. 구현 순서

| 순서 | 작업 | 예상 난이도 |
|------|------|------------|
| 1 | `mcp-config.json`에 `teamMembers` 배열 추가 (수동 입력) | 쉬움 |
| 2 | `config.ts`에 `TeamMember` 타입 + DEFAULTS 추가 | 쉬움 |
| 3 | `server.ts`에 `jira_create_issue` 도구 추가 | 보통 |
| 4 | `server.ts`에 `jira_get_members` 도구 추가 | 쉬움 |
| 5 | MCP 서버 빌드 + 테스트 | 쉬움 |
| 6 | `jira_dispatch` 도구 추가 (LLM 분석 포함) | 어려움 |

**5번까지 완료하면** Claude Code가 직접:
1. 볼트에서 피드백 읽기 (`search_bm25` + `vault_read`)
2. 분석 후 일감 목록 생성
3. `jira_create_issue` 반복 호출

로 동작 가능. `jira_dispatch`(6번)는 편의 도구라 나중에 추가해도 됨.

---

## 6. 선행 조건 — 팀원 목록 작성

구현 전에 다음 정보가 필요합니다:

```
팀원 이름 | Jira 계정 이메일 | 역할 | 주요 담당 업무
---------|----------------|------|---------------
         |                |      |
```

**Jira accountId 확인**:
1. Jira 관리자 → 사용자 관리에서 확인
2. 또는 `jira_get_members` 구현 후 자동 조회
3. 또는 `GET /rest/api/3/myself`로 본인 ID 먼저 확인

---

## 7. 사용 예시 (구현 완료 후)

```
# Claude Code에서
1. vault_reload
2. search_bm25 {"query": "이사장 피드백 3월"}
3. vault_read → 피드백 내용 파악
4. search_bm25 {"query": "미완료 이슈 긴급"}
5. [분석] 팀원 역할표 참조 → 일감 초안 생성
6. jira_create_issue × N회 → 각 팀원에게 발행
7. slack_send → 팀 채널에 발행 내역 알림
```

---

## 8. 향후 확장

- **정기 자동화**: Cron 또는 Slack Bot 커맨드로 주 1회 자동 분석+발행
- **Epic 연동**: 신규 이슈를 기존 Epic에 자동 연결 (`parentKey` 활용)
- **우선순위 학습**: 과거 이사장 피드백 패턴 학습으로 우선순위 정확도 향상
- **리뷰 단계**: `dryRun` 모드로 Slack에 초안 공유 → 승인 후 발행
