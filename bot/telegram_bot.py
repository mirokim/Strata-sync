"""
Strata Sync Telegram Bot — Vault RAG + Persona AI Telegram Bot
──────────────────────────────────────────────────────────────
Features:
  - Vault-based RAG Q&A via Telegram bot
  - 5 director personas supported (/ask chief, /ask art, etc.)
  - Multi-agent RAG (parallel sub-agent document analysis)
  - MiroFish simulation trigger
  - Web search augmentation
  - File attachment (image/document) support

Run:
    python telegram_bot.py
    or env var: TELEGRAM_BOT_TOKEN=xxx python telegram_bot.py

Commands:
    /ask [persona] question — Persona RAG query
    /search keyword         — Vault search
    /debate topic           — Multi-persona debate
    /mirofish topic         — MiroFish simulation
    /help                   — Help
"""
import json
import logging
import os
import sys
import threading
import time
from pathlib import Path

# Add module path
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


# ─── Help ─────────────────────────────────────────────────────────────────────

HELP_TEXT = """*Strata Sync Bot* — Vault-based AI Assistant

*Commands:*
`/ask [persona] question` — Ask AI (default: chief)
`/search keyword` — Search vault documents
`/debate topic` — Multi-persona debate
`/mirofish topic` — MiroFish simulation
`/help` — This help message

*Personas:*
• `chief` (PM/Lead) — Project management
• `art` (Art) — Art direction
• `spec` (Design) — Game design / Level design
• `tech` (Tech) — Programming / Technical

*Examples:*
`/ask Summarize the key issues for this sprint`
`/ask art Analyze character concept documents`
`/search balance patch`

Send a plain message and the default persona (chief) will respond.
"""


# ─── RAG + LLM Response Generation ───────────────────────────────────────────

def generate_answer(
    query: str,
    persona_tag: str,
    cfg: dict,
    attached_files: list[dict] | None = None,
) -> str:
    """Generate an answer using vault RAG + LLM."""
    vault_path = cfg.get("vault_path", "").strip()
    api_key = get_anthropic_key(cfg)
    if not api_key:
        return "API key is not configured. Please check config.json or the ANTHROPIC_API_KEY environment variable."

    persona = resolve_persona(persona_tag, cfg.get("personas"))
    persona_name = persona.get("name", persona_tag)
    persona_emoji = persona.get("emoji", "🤖")

    # 1) Try Electron RAG → fall back to rag_simple on failure
    rag_context = ""
    sources: list[str] = []

    if is_electron_alive():
        try:
            result = electron_ask(query, persona_tag)
            if result:
                return f"{persona_emoji} *{persona_name}*\n\n{result}"
        except Exception as e:
            logger.warning("Electron ask failed, falling back to local RAG: %s", e)

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
            logger.error("Local RAG search failed: %s", e)

    # 2) Web search augmentation (optional)
    web_ctx = ""
    if cfg.get("enable_web_search", False):
        try:
            web_results = search_web(query)
            web_ctx = build_web_context(web_results)
        except Exception:
            pass

    # 3) LLM call
    system_prompt = persona.get("system_prompt", f"You are {persona_name}. Answer accurately based on vault documents.")
    if rag_context:
        system_prompt += f"\n\n[Reference Documents]\n{rag_context}"
    if web_ctx:
        system_prompt += f"\n\n[Web Search Results]\n{web_ctx}"

    model = cfg.get("telegram_model", DEFAULT_SONNET_MODEL)
    client = ClaudeClient(api_key, model=model)

    try:
        answer = client.complete(system=system_prompt, user=query, max_tokens=4096, cache_system=True)
    except Exception as e:
        logger.error("LLM call failed: %s", e)
        return f"Error during LLM call: {e}"

    # 4) Compose response
    header = f"{persona_emoji} *{persona_name}*\n\n"
    footer = ""
    if sources:
        src_list = "\n".join(f"• `{s}`" for s in sources[:5])
        footer = f"\n\n📎 *Reference Documents:*\n{src_list}"

    return header + answer + footer


def handle_search(query: str, cfg: dict) -> str:
    """Return vault search results."""
    vault_path = cfg.get("vault_path", "").strip()

    if is_electron_alive():
        try:
            docs = electron_search(query, top_n=10)
            if docs:
                lines = [f"🔍 *Search Results* (`{query}`)\n"]
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
            lines = [f"🔍 *Search Results* (`{query}`)\n"]
            for i, r in enumerate(results[:10], 1):
                lines.append(f"{i}. `{r['title']}` (score: {r['score']:.3f})")
            return "\n".join(lines) if len(lines) > 1 else "No search results found."
        except Exception as e:
            return f"Search error: {e}"

    return "Vault path is not configured."


# ─── Message Handler ──────────────────────────────────────────────────────────

def handle_message(message: dict, cfg: dict, token: str) -> None:
    """Process a single Telegram message."""
    chat_id = message["chat"]["id"]
    message_id = message.get("message_id")

    text, files = extract_text_and_files(message)
    if not text and not files:
        return

    persona_tag, query = parse_persona_command(text)

    # Help
    if persona_tag == "__help__":
        send_message(token, chat_id, HELP_TEXT, reply_to=message_id)
        return

    # Search
    if persona_tag == "__search__":
        if not query:
            send_message(token, chat_id, "Please enter a search term. Example: `/search balance`", reply_to=message_id)
            return
        send_typing(token, chat_id)
        result = handle_search(query, cfg)
        send_message(token, chat_id, result, reply_to=message_id)
        return

    # Debate
    if persona_tag == "__debate__":
        if not query:
            send_message(token, chat_id, "Please enter a debate topic. Example: `/debate PvP balance`", reply_to=message_id)
            return
        send_typing(token, chat_id)
        # 각 페르소나로 순차 응답
        send_message(token, chat_id, f"🎙️ *Debate Start:* {query}\n", reply_to=message_id)
        for tag in ["chief", "art", "spec", "tech"]:
            send_typing(token, chat_id)
            answer = generate_answer(f"Please present your opinion from your perspective on the following topic: {query}", tag, cfg)
            send_message(token, chat_id, answer)
        send_message(token, chat_id, "🏁 *Debate End*")
        return

    # MiroFish
    if persona_tag == "__mirofish__":
        send_typing(token, chat_id)
        try:
            from modules.mirofish_runner import run_simulation as mirofish_run_python
            result = mirofish_run_python(
                query or "default simulation",
                cfg.get("vault_path", ""),
                get_anthropic_key(cfg),
            )
            send_message(token, chat_id, f"🐟 *MiroFish 결과*\n\n{result[:4000]}", reply_to=message_id)
        except Exception as e:
            send_message(token, chat_id, f"MiroFish error: {e}", reply_to=message_id)
        return

    # General question (defaults to chief if no persona specified)
    if not persona_tag:
        persona_tag = "chief"

    if not query:
        send_message(token, chat_id, "Please enter a question.", reply_to=message_id)
        return

    send_typing(token, chat_id)
    answer = generate_answer(query, persona_tag, cfg, attached_files=files)
    send_message(token, chat_id, answer, reply_to=message_id)


# ─── Long Polling Loop ────────────────────────────────────────────────────────

def run_polling(token: str, cfg: dict) -> None:
    """Telegram getUpdates long polling."""
    offset = 0
    logger.info("Telegram bot started (long polling)...")

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

                # Process message in a separate thread (prevent long polling blocking)
                t = threading.Thread(
                    target=handle_message,
                    args=(message, cfg, token),
                    daemon=True,
                )
                t.start()

        except KeyboardInterrupt:
            logger.info("Bot stopped (user interrupt)")
            break
        except Exception as e:
            logger.error("Polling error: %s", e)
            time.sleep(5)


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    cfg = load_config()
    token = cfg.get("telegram_bot_token", "") or os.getenv("TELEGRAM_BOT_TOKEN", "")

    if not token:
        print("❌ TELEGRAM_BOT_TOKEN is not configured.")
        print("   Set telegram_bot_token in config.json or the TELEGRAM_BOT_TOKEN environment variable.")
        sys.exit(1)

    # Verify bot info
    try:
        me = tg_api(token, "getMe")
        bot_info = me.get("result", {})
        logger.info("Bot connected successfully: @%s (%s)", bot_info.get("username"), bot_info.get("first_name"))
    except Exception as e:
        print(f"❌ Bot token authentication failed: {e}")
        sys.exit(1)

    run_polling(token, cfg)


if __name__ == "__main__":
    main()
