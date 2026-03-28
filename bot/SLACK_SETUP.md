# Strata Sync Slack Bot 설정 가이드

## 사전 요구사항

- Python 3.11+
- `pip install slack-bolt slack-sdk requests`
- Slack 워크스페이스 관리자 권한

---

## 1. Slack 앱 생성

1. [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**
2. App Name: `Strata Sync` (또는 원하는 이름)
3. 워크스페이스 선택 후 **Create App**

---

## 2. 권한(Scopes) 설정

**OAuth & Permissions** → **Bot Token Scopes** 에 아래 스코프 추가:

| Scope | 용도 |
|---|---|
| `app_mentions:read` | 채널 멘션 수신 |
| `chat:write` | 메시지 전송 |
| `chat:write.customize` | thinking 메시지 업데이트 |
| `im:history` | DM 메시지 읽기 |
| `im:read` | DM 채널 정보 |
| `im:write` | DM 메시지 전송 |
| `channels:history` | 채널 메시지 히스토리 |
| `groups:history` | 비공개 채널 히스토리 |
| `files:read` | 첨부 이미지 읽기 (Vision) |
| `files:write` | 이미지 업로드 (볼트 이미지 전송) |

---

## 3. Socket Mode 활성화

**Socket Mode** → **Enable Socket Mode** 토글 ON

→ App-Level Token 생성 팝업에서:
- Token Name: `socket-token`
- Scope: `connections:write`
- **Generate** → 토큰 복사 (`xapp-1-...`)

이것이 **App Token**입니다.

---

## 4. Event Subscriptions 설정

**Event Subscriptions** → **Enable Events** ON

**Subscribe to bot events** 에 추가:
- `app_mention` — 채널에서 @봇 멘션
- `message.im` — DM 메시지
- `app_home_opened` — 홈 탭 열기

---

## 5. App Home 설정 (선택)

**App Home** → **Home Tab** Enable → **Messages Tab** Enable

---

## 6. 앱 설치

**Install App** → **Install to Workspace** → 권한 허용

설치 후 **Bot User OAuth Token** 복사 (`xoxb-...`)

이것이 **Bot Token**입니다.

---

## 7. Strata Sync 설정

앱 내 설정 → **Slack 봇** 탭:

| 필드 | 값 |
|---|---|
| **Bot Token** | `xoxb-...` (6단계에서 복사) |
| **App Token** | `xapp-1-...` (3단계에서 복사) |
| **응답 모델** | `claude-sonnet-4-6` (기본값) |

**시작** 버튼 클릭 → 로그에 `✅ Bolt app started` 표시 확인

---

## 8. 사용법

### 채널에서
```
@StrataSync 캐릭터A의 컨셉은 뭐야?
@StrataSync [art] 아트 방향 알려줘
@StrataSync 캐릭터A 이미지 보여줘
```

### DM에서
```
캐릭터A의 스킬 설명해줘
[spec] 2월 스펙 정리해줘
이미지 있어 배경 일러스트
```

### 페르소나 태그
| 태그 | 페르소나 |
|---|---|
| `[chief]` 또는 태그 없음 | 총괄 디렉터 |
| `[art]` | 아트 디렉터 |
| `[spec]` | 기획 디렉터 |
| `[tech]` | 프로그래밍 디렉터 |

### 이미지 기능
- **자동**: 답변할 때 관련 문서에 `![[이미지.png]]`가 있으면 자동으로 첨부
- **명시적 검색**: "이미지 보여줘", "이미지 있어", "사진 보여줘" 키워드 포함 시 볼트에서 파일명 검색 후 첨부
- **Vision**: 사용자가 이미지를 첨부하면 Claude가 이미지를 분석해 답변

---

## 9. Enterprise Grid 환경 (이미지 다운로드 실패 시)

기업용 Slack에서 이미지 URL이 SSO로 차단되는 경우, 봇이 자동으로 썸네일 URL로 폴백합니다.
여전히 안 되면 `files:read` 스코프 외에 워크스페이스 관리자에게 파일 접근 정책 확인 요청.

---

## 10. 문제 해결

| 증상 | 원인 | 해결 |
|---|---|---|
| 봇이 응답 없음 | Electron 앱이 꺼져 있음 | Strata Sync 앱 실행 후 볼트 로드 |
| `❌ 시작 실패` | 토큰 오류 | Bot/App Token 재확인 |
| 이미지 업로드 실패 | `files:write` 스코프 없음 | 2단계 스코프 추가 후 재설치 |
| Vision 분석 안 됨 | Anthropic API 키 없음 | 설정 → AI 탭에서 키 입력 |
| 답변이 느림 | RAG + LLM 처리 시간 | 정상 (약 10~30초), Vision 포함 시 최대 90초 |
