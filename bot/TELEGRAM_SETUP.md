# Telegram Bot 설정 가이드

## 1. BotFather로 봇 생성

1. Telegram에서 [@BotFather](https://t.me/BotFather)를 검색
2. `/newbot` 명령어 입력
3. 봇 이름과 username 설정
4. 발급받은 **API Token**을 저장

## 2. 환경 설정

### 방법 A: 환경 변수 (권장)
```bash
export TELEGRAM_BOT_TOKEN="your-bot-token-here"
export ANTHROPIC_API_KEY="your-anthropic-key"
```

### 방법 B: .env 파일
```
# bot/.env
TELEGRAM_BOT_TOKEN=your-bot-token-here
ANTHROPIC_API_KEY=your-anthropic-key
```

### 방법 C: config.json
```json
{
  "telegram_bot_token": "your-bot-token-here",
  "claude_api_key": "your-anthropic-key",
  "vault_path": "C:/path/to/your/vault",
  "telegram_model": "claude-sonnet-4-20250514"
}
```

## 3. 실행

```bash
cd bot
pip install -r requirements.txt
python telegram_bot.py
```

## 4. 봇 커맨드 (BotFather에 등록)

BotFather에서 `/setcommands`로 다음 등록:

```
ask - AI에게 질문 (예: /ask chief 이슈 정리)
search - 볼트 문서 검색
debate - 멀티 페르소나 토론
mirofish - MiroFish 시뮬레이션
help - 도움말
```

## 5. 사용법

| 커맨드 | 설명 | 예시 |
|--------|------|------|
| `/ask [persona] 질문` | 페르소나 RAG 질의 | `/ask art 캐릭터 컨셉 분석` |
| `/search 키워드` | 볼트 검색 | `/search 밸런스 패치` |
| `/debate 주제` | 4인 토론 | `/debate PvP 시스템` |
| `/mirofish 주제` | 시뮬레이션 | `/mirofish 팀 역학` |
| 일반 메시지 | chief가 응답 | `이번 스프린트 요약해줘` |

## 6. 페르소나

| 태그 | 별칭 | 역할 |
|------|------|------|
| `chief` | PM, 수석, 디렉터 | 프로젝트 총괄 |
| `art` | 아트 | 아트 디렉션 |
| `spec` | 기획 | 기획/레벨 디자인 |
| `tech` | 기술, 프로그 | 프로그래밍/기술 |

## 7. Electron 연동

Strata Sync Electron 앱이 실행 중이면 자동으로 Electron RAG API를 사용합니다.
앱이 꺼져있으면 로컬 rag_simple 폴백으로 동작합니다.
