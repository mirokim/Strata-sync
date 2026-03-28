# Confluence & Jira 매일 자동 동기화 — 시나리오 및 구현 계획

> 작성일: 2026-03-19
> 분석 기준: 현재 코드베이스 (Confluence 자동 동기화 일부 구현됨, Jira 미구현)

---

## 현황 파악

| 항목 | Confluence | Jira |
|------|-----------|------|
| 수동 임포트 UI | ✅ | ✅ |
| 자동 동기화 훅 | ✅ `useConfluenceAutoSync` (setInterval) | ❌ 없음 |
| Config 필드 (autoSync) | ✅ `autoSync`, `autoSyncIntervalMinutes` | ❌ 없음 |
| UI 토글/인터벌 설정 | ✅ ConfluenceTab | ❌ JiraTab 미구현 |
| lastSyncAt 추적 | ✅ syncStore | ❌ 없음 |
| 첨부파일 다운로드 | ✅ (이미지, 10MB 이하) | ❌ 미구현 |
| 포스트 처리 스크립트 | ✅ 6개 Python 스크립트 | ❌ 불필요 (구조 단순) |
| 앱 종료 후 동작 | ❌ setInterval만 → 앱 열려있어야 함 | ❌ |

### 핵심 문제
1. **Confluence**: 앱이 열려있을 때만 동기화됨. "매일 자동"을 보장하려면 앱 시작 시 누락 싱크를 catch-up 해야 함
2. **Jira**: 자동 동기화 전혀 없음. 수동 버튼만 존재

---

## 목표 시나리오

### 매일 자동 동기화 흐름

```
[매일 오전 9시 또는 앱 시작 시]
        │
        ▼
┌─────────────────────────────────────┐
│  앱 시작 — lastSyncAt 확인          │
│  오늘 이미 동기화됐으면 Skip        │
│  안 됐으면 즉시 동기화 실행         │
└──────────────┬──────────────────────┘
               │
    ┌──────────┴──────────┐
    ▼                     ▼
[Confluence 동기화]   [Jira 동기화]
    │                     │
    │ 1. lastSyncAt 이후   │ 1. lastJiraSyncAt 이후
    │    변경된 페이지 fetch│    업데이트된 이슈 fetch
    │ 2. MD 변환 & 저장    │ 2. MD 변환 & 저장
    │ 3. 첨부파일 다운로드 │ 3. (첨부파일 생략)
    │ 4. Python 스크립트   │ 4. 볼트 리로드
    │    6개 실행          │ 5. lastJiraSyncAt 갱신
    │ 5. 볼트 리로드       │
    │ 6. lastSyncAt 갱신   │
    └──────────┬──────────┘
               │
               ▼
    ┌─────────────────────┐
    │  토스트 알림 표시    │
    │  "동기화 완료: C 12건 │
    │            J 5건"   │
    └─────────────────────┘
```

### 인터벌 동기화 (앱 실행 중)

```
앱 실행 중 (setInterval)
    │
    ├─ Confluence: 설정된 interval(분)마다
    │   └─ autoSync=true인 경우만 실행
    │
    └─ Jira: 설정된 interval(분)마다
        └─ autoSync=true인 경우만 실행
```

---

## 신규 구현 목록

### A. `src/stores/syncStore.ts` 수정

**현재:**
```typescript
interface SyncStore {
  lastSyncAt: string | null          // Confluence only
  notification: SyncNotification | null
  ...
}
```

**추가:**
```typescript
interface SyncStore {
  lastSyncAt: string | null           // Confluence
  lastJiraSyncAt: string | null       // Jira (신규)
  notification: SyncNotification | null
  setLastSyncAt: (at: string) => void
  setLastJiraSyncAt: (at: string) => void  // 신규
  ...
}
```

---

### B. `src/stores/settingsStore.ts` — JiraConfig 수정

**현재 JiraConfig:**
```typescript
interface JiraConfig {
  baseUrl: string
  email: string
  apiToken: string
  projectKey: string
  jql: string
  authType: 'cloud' | 'server_pat' | 'server_basic'
  bypassSSL: boolean
  dateFrom: string
  dateTo: string
  // autoSync 없음
}
```

**추가:**
```typescript
interface JiraConfig {
  ...기존 필드 유지...
  autoSync: boolean                 // 신규
  autoSyncIntervalMinutes: number   // 신규 (default: 60)
}
```

**DEFAULT_JIRA_CONFIG에도 추가:**
```typescript
autoSync: false,
autoSyncIntervalMinutes: 60,
```

---

### C. `src/hooks/useJiraAutoSync.ts` 신규 생성

`useConfluenceAutoSync.ts`를 기반으로 Jira 버전 구현.

**핵심 로직:**
```typescript
export function useJiraAutoSync() {
  useEffect(() => {
    // 앱 시작 시 catch-up 동기화 (오늘 아직 안 됐으면 즉시 실행)
    checkAndRunCatchUp()

    // 인터벌 동기화
    if (!cfg.autoSync) return
    const timer = setInterval(runSync, cfg.autoSyncIntervalMinutes * 60 * 1000)
    return () => clearInterval(timer)
  }, [cfg.autoSync, cfg.autoSyncIntervalMinutes])
}
```

**동기화 파이프라인:**
1. `jiraAPI.fetchIssues(config)` — lastJiraSyncAt 이후 업데이트된 이슈
2. `issueToVaultMarkdown()` — MD 변환 (기존 함수 재사용)
3. `jiraAPI.saveIssues(vaultPath, targetFolder, issuesWithMd)` — 저장
4. `loadVault(vaultPath)` — 볼트 리로드
5. `setLastJiraSyncAt(new Date().toISOString())` — 타임스탬프 갱신
6. `setNotification(...)` — 결과 토스트

**Confluence와 차이점:**
- Python 스크립트 실행 없음 (Jira 데이터는 구조 단순)
- 첨부파일 다운로드 없음 (이슈 본문 텍스트만)
- targetFolder = `jira/` (고정 폴더 또는 설정 가능하게)

---

### D. `src/components/settings/tabs/JiraTab.tsx` 수정

**추가할 UI:**
```
[자동 동기화] ──────────────────────── [토글]
동기화 주기:  [____60____] 분
마지막 동기화: 2026-03-19 09:00:32
```

- `autoSync` 토글 스위치
- `autoSyncIntervalMinutes` 숫자 입력 (15~1440분)
- `lastJiraSyncAt` 표시 (syncStore에서 읽기)
- 수동 "지금 동기화" 버튼 (기존 import 버튼과 별개)

---

### E. `src/App.tsx` 수정

**추가:**
```typescript
import { useJiraAutoSync } from '@/hooks/useJiraAutoSync'

// 기존 useConfluenceAutoSync() 아래에 추가
useJiraAutoSync()
```

---

### F. Catch-up 동기화 로직 (Confluence + Jira 공통)

앱 시작 시 오늘 날짜와 lastSyncAt을 비교해 누락된 동기화를 즉시 실행.

**`useConfluenceAutoSync.ts`에 추가:**
```typescript
// 앱 시작 시 catch-up: 마지막 동기화가 오늘 이전이면 즉시 실행
useEffect(() => {
  const last = lastSyncAt ? new Date(lastSyncAt) : null
  const today = new Date()
  const isStale = !last || last.toDateString() !== today.toDateString()
  if (cfg.autoSync && isStale) {
    runSync()  // 즉시 동기화
  }
}, [])  // 마운트 시 1회
```

동일 패턴을 `useJiraAutoSync.ts`에도 적용.

---

## 수정이 필요한 파일

### 1. `src/stores/syncStore.ts`
- `lastJiraSyncAt: string | null` 필드 추가
- `setLastJiraSyncAt` 액션 추가
- persist 파티션에 포함

### 2. `src/stores/settingsStore.ts`
- `JiraConfig` 인터페이스에 `autoSync`, `autoSyncIntervalMinutes` 추가
- `DEFAULT_JIRA_CONFIG`에 기본값 추가 (`autoSync: false`, `autoSyncIntervalMinutes: 60`)
- merge 함수에서 jiraConfigs에도 새 필드 기본값 보장

### 3. `src/hooks/useConfluenceAutoSync.ts`
- Catch-up 동기화 로직 추가 (앱 시작 시 오늘 날짜 비교)
- 동기화 중 상태(`isSyncing`) 노출 — 중복 실행 방지 강화

### 4. `src/components/settings/tabs/JiraTab.tsx`
- Auto-sync 토글 UI 추가
- Interval 분 입력 추가
- `lastJiraSyncAt` 표시 추가

### 5. `src/App.tsx`
- `useJiraAutoSync()` 훅 호출 추가

---

## 신규 생성 파일

### 1. `src/hooks/useJiraAutoSync.ts` (신규)
- `useConfluenceAutoSync.ts` 구조 참고
- JiraConfig의 `autoSync`/`autoSyncIntervalMinutes` 사용
- `syncStore`의 `lastJiraSyncAt` 사용
- Python 스크립트 실행 없이 fetch → convert → save → reload 만

---

## 구현 순서 (권장)

```
1단계: 스토어 확장
  └─ syncStore.ts: lastJiraSyncAt 추가
  └─ settingsStore.ts: JiraConfig에 autoSync 필드 추가

2단계: 훅 구현
  └─ useJiraAutoSync.ts 신규 생성
  └─ useConfluenceAutoSync.ts catch-up 로직 추가

3단계: UI 연결
  └─ JiraTab.tsx auto-sync 설정 UI 추가
  └─ App.tsx useJiraAutoSync() 등록

4단계: 검증
  └─ Confluence: 앱 재시작 시 catch-up 동작 확인
  └─ Jira: autoSync=true 설정 후 인터벌 동작 확인
  └─ 동시 동기화 시 중복 실행 없는지 확인
```

---

## 고려사항 / 엣지케이스

| 상황 | 처리 방법 |
|------|----------|
| 동기화 중 앱 종료 | 다음 시작 시 lastSyncAt 미갱신 → catch-up 재실행 |
| Confluence + Jira 동시 실행 | 별도 isSyncing ref로 각각 독립 제어 |
| API 인증 실패 (401) | 에러 알림 표시 + autoSync 자동 비활성화하지 않음 (설정 유지) |
| 볼트 미선택 상태 | 동기화 skip, 알림 없음 |
| 동기화할 변경사항 없음 (0건) | 성공으로 처리, lastSyncAt 갱신, 알림은 "변경사항 없음"으로 표시 |
| Python 스크립트 실패 (Confluence) | lastSyncAt 갱신 안 함 → 다음 동기화 시 재시도 |
| targetFolder 경로 충돌 | 덮어쓰기 (파일명 = 이슈키 or 페이지ID 기반으로 고정) |

---

## 개선점: lastSyncAt 날짜 잘림 문제 (구현 반영)

**문제:**
`lastSyncAt`(ISO 타임스탬프)을 `split('T')[0]`로 잘라 `YYYY-MM-DD`만 전달하면,
같은 날 여러 번 동기화 시 당일 전체 변경사항이 중복 포함됨.

예) 오전 9시 동기화 → `lastSyncAt = "2026-03-19T09:00:00Z"`
    오후 3시 재동기화 → `dateFrom = "2026-03-19"` (시각 정보 버려짐)
    → 오전 9시 이전 수정된 것까지 **다시 가져옴**

**해결:**
Confluence CQL / Jira JQL 모두 datetime 형식 `"YYYY-MM-DD HH:mm"` (UTC) 지원.
`lastSyncAt`을 날짜만 자르지 않고 datetime 포맷으로 그대로 전달:
```typescript
const pad = (n: number) => String(n).padStart(2, '0')
return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
// 예: "2026-03-19 09:00"
```

`electron/main.cjs` DATE_RE도 datetime 허용으로 확장:
```javascript
// Before: /^\d{4}-\d{2}-\d{2}$/
// After:  /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/
```

---

## 참고: 현재 ConfluenceConfig.autoSyncIntervalMinutes 기본값

```typescript
// settingsStore.ts
autoSyncIntervalMinutes: 60  // 60분마다

// useConfluenceAutoSync.ts
const intervalMs = cfg.autoSyncIntervalMinutes * 60 * 1000
```

Jira도 동일하게 기본 60분으로 설정 예정.
"매일 자동"을 원한다면 1440(24시간)으로 설정하거나, catch-up 로직으로 앱 시작 시 하루 1회 보장.
