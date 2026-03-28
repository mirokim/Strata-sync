"""
Strata Sync Telegram Bot — 볼트 RAG + 페르소나 AI 텔레그램 봇
──────────────────────────────────────────────────────────────
기능:
  - Telegram 봇을 통한 볼트 기반 RAG 질의응답
  - 5개 디렉터 페르소나 지원 (/ask chief, /ask art 등)
  - 멀티에이전트 RAG (병렬 서브에이전트 문서 분석)
  - MiroFish 시뮬레이션 트리거
  - 웹 검색 보강
  - 파일 첨부 (이미지/문서) 지원

실행:
    python telegram_bot.py
    또는 환경 변수: TELEGRAM_BOT_TOKEN=xxx python telegram_bot.py

커맨드:
    /ask [persona] 질문   — 페르소나 RAG 질의
    /search 키워드         — 볼트 검색
    /debate 주제           — 멀티 페르소나 토론
    /mirofish 주제         — MiroFish 시뮬레이션
    /help                  — 도움말
"""
import json
import logging
import os
import sys
import threading
import time
from pathlib import Path

# 모듈 경로 추가
sys.path.insert(0, str(Path(__file__).parent))

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / ".env")
except ImportError:
    pass

from modules.telegram_utils import (
    tg_api, send_message, send_typing, download_file,
    extract_text_and_files, parse_persona_command,
)
from modules.claude_client import ClaudeClient
from modules.persona_config import resolve_persona, PERSONA_ALIASES
from modules.rag_simple import search_vault as rag_search, RagResult
from modules.rag_electron import is_electron_alive, search_via_electron as electron_search, ask_via_electron as electron_ask
from modules.api_keys import get_anthropic_key
from modules.web_search import search_web, build_web_context
from modules.constants import DEFAULT_SONNET_MODEL

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")

CONFIG_PATH = Path(__file__).parent / "config.json"


def load_config() -> dict:
    cfg: dict = {}
    if CONFIG_PATH.exists():
        try:
            cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        except Exception:
            pass
    if os.getenv("ANTHROPIC_API_KEY"):
        cfg["claude_api_key"] = os.environ["ANTHROPIC_API_KEY"]
    if os.getenv("TELEGRAM_BOT_TOKEN"):
        cfg["telegram_bot_token"] = os.environ["TELEGRAM_BOT_TOKEN"]
    return cfg


# ─── 도움말 ───────────────────────────────────────────────────────────────────

HELP_TEXT = """*Strata Sync Bot* — 볼트 기반 AI 어시스턴트

*커맨드:*
`/ask [persona] 질문` — AI에게 질문 (기본: chief)
`/search 키워드` — 볼트 문서 검색
`/debate 주제` — 멀티 페르소나 토론
`/mirofish 주제` — MiroFish 시뮬레이션
`/help` — 이 도움말

*페르소나:*
• `chief` (PM/수석) — 프로젝트 총괄
• `art` (아트) — 아트 디렉션
• `spec` (기획) — 기획/레벨 디자인
• `tech` (기술) — 프로그래밍/기술

*예시:*
`/ask 이번 스프린트 주요 이슈 정리해줘`
`/ask art 캐릭터 컨셉 관련 문서 분석해줘`
`/search 밸런스 패치`

일반 메시지를 보내면 기본 페르소나(chief)가 응답합니다.
"""


# ─── RAG + LLM 응답 생성 ─────────────────────────────────────────────────────

def generate_answer(
    query: str,
    persona_tag: str,
    cfg: dict,
    attached_files: list[dict] | None = None,
) -> str:
    """볼트 RAG + LLM으로 답변 생성."""
    vault_path = cfg.get("vault_path", "").strip()
    api_key = get_anthropic_key(cfg)
    if not api_key:
        return "API 키가 설정되지 않았습니다. config.json 또는 ANTHROPIC_API_KEY 환경변수를 확인하세요."

    persona = resolve_persona(persona_tag, cfg.get("personas"))
    persona_name = persona.get("name", persona_tag)
    persona_emoji = persona.get("emoji", "🤖")

    # 1) Electron RAG 시도 → 실패 시 rag_simple 폴백
    rag_context = ""
    sources: list[str] = []

    if is_electron_alive():
        try:
            result = electron_ask(query, persona_tag)
            if result:
                return f"{persona_emoji} *{persona_name}*\n\n{result}"
        except Exception as e:
            logger.warning("Electron ask 실패, 로컬 RAG 폴백: %s", e)

        try:
            docs = electron_search(query, top_n=10)
            if docs:
                for d in docs[:5]:
                    title = d.get("title", "")
                    body = d.get("body", "")[:2000]
                    rag_context += f"\n\n--- {title} ---\n{body}"
                    sources.append(title)
        except Exception:
            pass

    if not rag_context and vault_path and Path(vault_path).exists():
        try:
            results: list[RagResult] = rag_search(query, vault_path, top_n=10)
            for r in results[:5]:
                rag_context += f"\n\n--- {r['title']} ---\n{r['body'][:2000]}"
                sources.append(r["title"])
        except Exception as e:
            logger.error("로컬 RAG 검색 실패: %s", e)

    # 2) 웹 검색 보강 (선택)
    web_ctx = ""
    if cfg.get("enable_web_search", False):
        try:
            web_results = search_web(query)
            web_ctx = build_web_context(web_results)
        except Exception:
            pass

    # 3) LLM 호출
    system_prompt = persona.get("system_prompt", f"당신은 {persona_name}입니다. 볼트 문서 기반으로 정확하게 답변하세요.")
    if rag_context:
        system_prompt += f"\n\n[참고 문서]\n{rag_context}"
    if web_ctx:
        system_prompt += f"\n\n[웹 검색 결과]\n{web_ctx}"

    model = cfg.get("telegram_model", DEFAULT_SONNET_MODEL)
    client = ClaudeClient(api_key, model=model)

    try:
        answer = client.complete(system=system_prompt, user=query, max_tokens=4096, cache_system=True)
    except Exception as e:
        logger.error("LLM 호출 실패: %s", e)
        return f"LLM 호출 중 오류 발생: {e}"

    # 4) 응답 조합
    header = f"{persona_emoji} *{persona_name}*\n\n"
    footer = ""
    if sources:
        src_list = "\n".join(f"• `{s}`" for s in sources[:5])
        footer = f"\n\n📎 *참고 문서:*\n{src_list}"

    return header + answer + footer


def handle_search(query: str, cfg: dict) -> str:
    """볼트 검색 결과 반환."""
    vault_path = cfg.get("vault_path", "").strip()

    if is_electron_alive():
        try:
            docs = electron_search(query, top_n=10)
            if docs:
                lines = [f"🔍 *검색 결과* (`{query}`)\n"]
                for i, d in enumerate(docs[:10], 1):
                    title = d.get("title", "?")
                    score = d.get("score", 0)
                    lines.append(f"{i}. `{title}` (score: {score:.3f})")
                return "\n".join(lines)
        except Exception:
            pass

    if vault_path and Path(vault_path).exists():
        try:
            results = rag_search(query, vault_path, top_n=10)
            lines = [f"🔍 *검색 결과* (`{query}`)\n"]
            for i, r in enumerate(results[:10], 1):
                lines.append(f"{i}. `{r['title']}` (score: {r['score']:.3f})")
            return "\n".join(lines) if len(lines) > 1 else "검색 결과가 없습니다."
        except Exception as e:
            return f"검색 오류: {e}"

    return "볼트 경로가 설정되지 않았습니다."


# ─── 메시지 핸들러 ────────────────────────────────────────────────────────────

def handle_message(message: dict, cfg: dict, token: str) -> None:
    """단일 Telegram 메시지 처리."""
    chat_id = message["chat"]["id"]
    message_id = message.get("message_id")

    text, files = extract_text_and_files(message)
    if not text and not files:
        return

    persona_tag, query = parse_persona_command(text)

    # 도움말
    if persona_tag == "__help__":
        send_message(token, chat_id, HELP_TEXT, reply_to=message_id)
        return

    # 검색
    if persona_tag == "__search__":
        if not query:
            send_message(token, chat_id, "검색어를 입력하세요. 예: `/search 밸런스`", reply_to=message_id)
            return
        send_typing(token, chat_id)
        result = handle_search(query, cfg)
        send_message(token, chat_id, result, reply_to=message_id)
        return

    # 토론
    if persona_tag == "__debate__":
        if not query:
            send_message(token, chat_id, "토론 주제를 입력하세요. 예: `/debate PvP 밸런스`", reply_to=message_id)
            return
        send_typing(token, chat_id)
        # 각 페르소나로 순차 응답
        send_message(token, chat_id, f"🎙️ *토론 시작:* {query}\n", reply_to=message_id)
        for tag in ["chief", "art", "spec", "tech"]:
            send_typing(token, chat_id)
            answer = generate_answer(f"다음 주제에 대해 당신의 관점에서 의견을 제시하세요: {query}", tag, cfg)
            send_message(token, chat_id, answer)
        send_message(token, chat_id, "🏁 *토론 종료*")
        return

    # MiroFish
    if persona_tag == "__mirofish__":
        send_typing(token, chat_id)
        try:
            from modules.mirofish_runner import run_simulation as mirofish_run_python
            result = mirofish_run_python(
                query or "기본 시뮬레이션",
                cfg.get("vault_path", ""),
                get_anthropic_key(cfg),
            )
            send_message(token, chat_id, f"🐟 *MiroFish 결과*\n\n{result[:4000]}", reply_to=message_id)
        except Exception as e:
            send_message(token, chat_id, f"MiroFish 오류: {e}", reply_to=message_id)
        return

    # 일반 질문 (페르소나 지정 없으면 chief)
    if not persona_tag:
        persona_tag = "chief"

    if not query:
        send_message(token, chat_id, "질문을 입력하세요.", reply_to=message_id)
        return

    send_typing(token, chat_id)
    answer = generate_answer(query, persona_tag, cfg, attached_files=files)
    send_message(token, chat_id, answer, reply_to=message_id)


# ─── Long Polling 루프 ────────────────────────────────────────────────────────

def run_polling(token: str, cfg: dict) -> None:
    """Telegram getUpdates long polling."""
    offset = 0
    logger.info("Telegram 봇 시작 (long polling)...")

    while True:
        try:
            updates = tg_api(token, "getUpdates", {
                "offset": offset,
                "timeout": 30,
                "allowed_updates": ["message"],
            }, timeout=35.0)

            for update in updates.get("result", []):
                offset = update["update_id"] + 1
                message = update.get("message")
                if not message:
                    continue

                # 메시지를 별도 스레드에서 처리 (long polling 블로킹 방지)
                t = threading.Thread(
                    target=handle_message,
                    args=(message, cfg, token),
                    daemon=True,
                )
                t.start()

        except KeyboardInterrupt:
            logger.info("봇 종료 (사용자 중단)")
            break
        except Exception as e:
            logger.error("Polling 오류: %s", e)
            time.sleep(5)


# ─── 메인 ─────────────────────────────────────────────────────────────────────

def main():
    cfg = load_config()
    token = cfg.get("telegram_bot_token", "") or os.getenv("TELEGRAM_BOT_TOKEN", "")

    if not token:
        print("❌ TELEGRAM_BOT_TOKEN이 설정되지 않았습니다.")
        print("   config.json의 telegram_bot_token 또는 환경변수 TELEGRAM_BOT_TOKEN을 설정하세요.")
        sys.exit(1)

    # 봇 정보 확인
    try:
        me = tg_api(token, "getMe")
        bot_info = me.get("result", {})
        logger.info("봇 연결 성공: @%s (%s)", bot_info.get("username"), bot_info.get("first_name"))
    except Exception as e:
        print(f"❌ 봇 토큰 인증 실패: {e}")
        sys.exit(1)

    run_polling(token, cfg)


if __name__ == "__main__":
    main()
