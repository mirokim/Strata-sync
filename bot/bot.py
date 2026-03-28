"""
Strata Sync Source Management Bot — Vault Management + Slack Bot Integrated GUI
──────────────────────────────────────────────────────────────────
Features:
  - Vault MD file scan + keyword_index.json automatic management
  - Wikilink injection + cluster link enhancement
  - index_YYYYMMDD.md automatic refresh (timer 1h / 5h)
  - Index MD file browser (view generated indices)
  - Slack bot (Socket Mode, persona + RAG)

Run:
    python bot.py
"""

import json
import os
import re
import sys
import threading
import time
import tkinter as tk
from tkinter import ttk, scrolledtext, filedialog, messagebox
from datetime import datetime, timedelta
from pathlib import Path

# Load .env file (secret priority: .env > config.json > UI input)
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / ".env")
except ImportError:
    pass  # Use only env vars if python-dotenv is not installed

# Add module path
sys.path.insert(0, str(Path(__file__).parent))

from modules.vault_scanner import scan_vault, find_active_folders
from modules.keyword_store import KeywordStore
from modules.claude_client import ClaudeClient
from modules.wikilink_updater import process_folder
from modules.index_generator import generate_index
from modules.progress_updater import ProgressUpdater
from modules.mirofish_runner import run_simulation as mirofish_run_python, STANCE_LABEL
from modules.constants import DEFAULT_HAIKU_MODEL, DEFAULT_SONNET_MODEL, KEYWORD_INDEX_REL_PATH
from modules.rag_electron import RAG_API_BASE
from modules.api_keys import get_anthropic_key
from modules.config_schema import BotConfig, default_config

CONFIG_PATH = Path(__file__).parent / "config.json"  # Can be overridden with --config argument


def _clean_search_query(q: str) -> str:
    """
    Remove meta-instruction expressions from a search query.
    Prevents BM25/TF-IDF from being polluted by common vault words like "report", "analysis", "direction".

    Application order:
      1. Compound meta-verbs: Korean action verbs with request endings
      2. Meta-noun + action verb: "write a report", "create a report"
      3. Pure request endings: Korean request suffixes
    Returns original query if everything is stripped.
    """
    out = q.strip()
    # 1. Compound meta-verbs (verb itself has meta meaning + request ending) — Korean patterns kept as-is
    out = re.sub(
        r'\s*(분석|정리|요약|검토|설명|비교|제안|작성|소개|추천|추출|뽑아)(해줘|해주세요|해봐줘|해봐|줘|주세요|해)\s*$',
        '', out, flags=re.IGNORECASE,
    )
    # 2. Meta-noun + action verb: e.g. "write a report" — Korean patterns kept as-is
    out = re.sub(
        r'\s*(Report|리포트|report)\s*[\w가-힣]*(써|만들|작성|export|pdf)[\w가-힣\s]*$',
        '', out, flags=re.IGNORECASE,
    )
    # 3. Pure request endings — Korean patterns kept as-is
    out = re.sub(
        r'\s*(알려줘|알려주세요|찾아줘|찾아주세요|말해줘|말해주세요|해줘|해주세요|줘|주세요|부탁해|부탁합니다)\s*$',
        '', out, flags=re.IGNORECASE,
    )
    out = out.strip()
    return out if out else q.strip()


# ─────────────────────────────────────────────────────────────────────────────
# Config helpers
# ─────────────────────────────────────────────────────────────────────────────

def load_config() -> BotConfig:
    cfg: BotConfig = default_config()
    if CONFIG_PATH.exists():
        try:
            cfg.update(json.loads(CONFIG_PATH.read_text(encoding="utf-8")))  # type: ignore[arg-type]
        except Exception:
            pass
    # env vars override config.json (secrets managed only in .env)
    if os.getenv("ANTHROPIC_API_KEY"):
        cfg["claude_api_key"] = os.environ["ANTHROPIC_API_KEY"]
    if os.getenv("SLACK_BOT_TOKEN"):
        cfg["slack_bot_token"] = os.environ["SLACK_BOT_TOKEN"]
    if os.getenv("SLACK_APP_TOKEN"):
        cfg["slack_app_token"] = os.environ["SLACK_APP_TOKEN"]
    return cfg


_SECRET_KEYS = {"claude_api_key", "slack_bot_token", "slack_app_token"}

def save_config(cfg: dict):
    # Save entire config to local config.json (including secrets).
    # env var priority is maintained since load_config overwrites from env vars.
    CONFIG_PATH.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")


# ─────────────────────────────────────────────────────────────────────────────
# Bot logic (runs in background thread)
# ─────────────────────────────────────────────────────────────────────────────

class VaultBot:
    def __init__(self, cfg: dict, log_fn, on_done_fn):
        self.cfg = cfg
        self._log_fn = log_fn      # must be called via after() — not directly from threads
        self.on_done = on_done_fn
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def log(self, msg: str):
        """Thread-safe log: schedules the call on the Tk main thread."""
        self._log_fn(msg)          # _log_fn is App._log_threadsafe which uses after()

    def _run_cycle(self):
        cfg = self.cfg
        vault_path = cfg.get("vault_path", "").strip()
        api_key = get_anthropic_key(cfg)

        if not vault_path or not Path(vault_path).exists():
            self.log("❌ Vault path is missing or does not exist.")
            return

        self.log(f"\n{'='*50}")
        self.log(f"🚀 Run started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        self.log(f"Vault: {vault_path}")

        # 1. Vault scan
        self.log("\n📂 Scanning vault...")
        docs = scan_vault(vault_path)
        self.log(f"  Found {len(docs)} MD files")

        active_folders = find_active_folders(vault_path)
        self.log(f"  Active folders: {len(active_folders)} → {[Path(f).name for f in active_folders]}")

        # 2. Load keyword store
        store = KeywordStore(vault_path, cfg.get("keyword_index_path", KEYWORD_INDEX_REL_PATH))
        loaded = store.load()
        self.log(f"\n🔑 Keyword index: {'loaded' if loaded else 'newly created'} ({store.count()} keywords)")

        # 3. Discover new keywords with Claude (only when API key is available)
        if api_key:
            self.log("\n🤖 Claude Haiku — Discovering keywords...")
            try:
                client = ClaudeClient(api_key, cfg.get("worker_model", DEFAULT_HAIKU_MODEL))
                # Sample latest documents from active folders
                sample_docs = []
                for d in docs:
                    if any(d.path.startswith(f) for f in active_folders[:1]):
                        sample_docs.append({
                            "stem": d.stem,
                            "title": d.title,
                            "body_snippet": d.body[:400],
                        })
                    if len(sample_docs) >= cfg.get("max_files_per_keyword_scan", 20):
                        break

                if sample_docs:
                    new_kws = client.discover_keywords(sample_docs)
                    added = 0
                    for item in new_kws:
                        kw = item.get("keyword", "")
                        hub = item.get("hub_stem", "")
                        display = item.get("display", kw)
                        if kw and hub:
                            store.upsert(kw, hub, display)
                            added += 1
                    self.log(f"  {added} keywords discovered/updated")
                else:
                    self.log("  No documents in active folder — skipping")
            except Exception as e:
                self.log(f"  ⚠️ Claude API error: {e}")
        else:
            self.log("\n⚠️  No API key — skipping keyword discovery (using existing index)")

        store.save()
        self.log(f"  Keyword index saved ({store.count()} keywords)")

        # 4. Process wikilinks per active folder
        keyword_map = store.to_inject_map()
        total_updated = 0
        total_hits: dict = {}

        for folder in active_folders:
            self.log(f"\n🔗 Wikilink processing: {Path(folder).name}")
            result = process_folder(folder, keyword_map, log_fn=self.log)
            total_updated += result["updated"]
            for kw, cnt in result["keyword_hits"].items():
                total_hits[kw] = total_hits.get(kw, 0) + cnt

        self.log(f"\n  Total {total_updated} files updated")
        if total_hits:
            top = sorted(total_hits.items(), key=lambda x: -x[1])[:5]
            self.log(f"  Keyword hit TOP5: {', '.join(f'{k}({v})' for k,v in top)}")

        # 5. Refresh index (latest active folder)
        if active_folders:
            self.log(f"\n📋 Index refresh: {Path(active_folders[0]).name}")
            generate_index(active_folders[0], log_fn=self.log)

        self.log(f"\n✅ Complete: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        self.on_done()

    def run_once(self):
        def _safe():
            try:
                self._run_cycle()
            except Exception as e:
                self.log(f"❌ Fatal error: {e}")
            finally:
                self.on_done()
        t = threading.Thread(target=_safe, daemon=True)
        t.start()

    def start_timer(self, interval_hours: float):
        self._stop.clear()

        def loop():
            while not self._stop.is_set():
                try:
                    self._run_cycle()
                except Exception as e:
                    self.log(f"❌ Fatal error: {e}")
                finally:
                    self.on_done()
                # Wait for interval (check stop every 10 seconds)
                end_time = time.time() + interval_hours * 3600
                while time.time() < end_time and not self._stop.is_set():
                    time.sleep(10)

        self._thread = threading.Thread(target=loop, daemon=True)
        self._thread.start()

    def stop_timer(self):
        self._stop.set()


# ─────────────────────────────────────────────────────────────────────────────
# Slack Bot Runner
# ─────────────────────────────────────────────────────────────────────────────

class SlackBotRunner:
    """Manages Slack SocketModeHandler in a background thread."""

    def __init__(self, cfg: dict, log_fn, on_status_fn):
        self.cfg = cfg
        self._log = log_fn          # thread-safe (after() based)
        self._on_status = on_status_fn
        self._handler = None
        self._thread: threading.Thread | None = None

    def is_running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def start(self) -> bool:
        """Start the Slack bot. Returns True on success."""
        try:
            from slack_bolt import App
            from slack_bolt.adapter.socket_mode import SocketModeHandler
            from slack_sdk import WebClient
        except ImportError:
            self._log("❌ slack-bolt package required: pip install slack-bolt")
            return False

        from modules.persona_config import resolve_persona
        from modules.rag_simple import search_vault, build_rag_context, apply_hotness_rerank, record_doc_access
        from modules.rag_electron import search_via_electron, get_model_for_tag, ask_via_electron, get_images_via_electron, mirofish_via_electron, get_electron_settings, get_api_key_from_settings, save_mirofish_to_vault, is_electron_alive
        from modules.slack_utils import extract_slack_files, download_slack_file
        from modules.multi_agent_rag import build_multi_agent_context
        from modules.web_search import search_web, build_web_context

        cfg = self.cfg
        bot_token  = cfg.get("slack_bot_token", "").strip()
        app_token  = cfg.get("slack_app_token", "").strip()
        vault_path = cfg.get("vault_path", "").strip()
        # api_keys module manages priority (Electron > config > env) in one place
        api_key    = get_anthropic_key(cfg)
        top_n      = cfg.get("slack_rag_top_n", 5)

        if not bot_token or not app_token:
            self._log("❌ slack_bot_token / slack_app_token not found in settings.")
            return False
        if not vault_path or not Path(vault_path).exists():
            self._log(f"❌ Vault path not found: {vault_path!r}")
            return False

        import re as _re
        web = WebClient(token=bot_token)
        app    = App(token=bot_token)

        PERSONA_TAG_RE = _re.compile(r"\[([^\]]+)\]")
        BOT_MENTION_RE = _re.compile(r"<@[A-Z0-9]+>")
        # MiroFish natural language detection: 🐟 emoji, mirofish keyword, or simulation action words
        # Trigger: Korean "시뮬레이션" or "시뮬" (standalone keywords)
        MIROFISH_RE = _re.compile(
            r"시뮬레이션|시뮬",
            _re.IGNORECASE,
        )
        # Report generation intent: same as chatStore.ts REPORT_INTENT_RE — Korean patterns kept as-is
        REPORT_INTENT_RE = _re.compile(
            r"Report.{0,20}(써|만들|작성|뽑아|정리|export|pdf)|(대화|채팅).{0,20}Report|Report.{0,20}(대화|채팅)|(pdf|PDF).{0,20}(만들|Report|저장|export)",
            _re.IGNORECASE,
        )

        # Number of personas: "5명", "10명 으로" — Korean patterns kept as-is
        MIRO_PERSONAS_RE = _re.compile(r"(\d{1,2})\s{0,3}명")
        # Number of rounds: "3라운드", "5 라운드", "3라운드로" — Korean patterns kept as-is
        MIRO_ROUNDS_RE   = _re.compile(r"(\d{1,2})\s{0,3}라운드로?")
        # Target segment: Korean gaming audience terms — Korean patterns kept as-is
        MIRO_SEGMENT_RE  = _re.compile(
            r"(코어\s*게이머|캐주얼\s*게이머|하드코어\s*게이머|라이트\s*유저|신규\s*유저|복귀\s*유저|"
            r"코어\s*유저|캐주얼\s*유저|하드코어\s*유저|[가-힣a-zA-Z]+\s*세그먼트)",
            _re.IGNORECASE,
        )
        # A vs B comparison: "X vs Y", "X 대비 Y", "X 와 Y 비교" — Korean patterns kept as-is
        MIRO_VS_RE = _re.compile(
            r"(.+?)\s+(?:vs\.?|대비|와\s+(.+?)\s+비교)\s+(.+)",
            _re.IGNORECASE,
        )
        # Preset reference: "[프리셋:name]" or "[preset:name]" — Korean patterns kept as-is
        MIRO_PRESET_RE = _re.compile(r"\[(?:프리셋|preset)\s*:\s*([^\]]+)\]", _re.IGNORECASE)
        # MiroFish result cache: (topic, num_personas, num_rounds) → (result, timestamp)
        _miro_cache: dict[tuple, tuple] = {}
        _miro_cache_lock = threading.Lock()
        _MIRO_CACHE_TTL = 1800   # 30 minutes
        _MIRO_CACHE_MAX = 200    # Max cache entries
        # Per-thread/DM conversation history (key: "channel:thread_ts", max 1000 keys)
        _MAX_HISTORY_KEYS = 1000
        _conv_history: dict[str, list[dict]] = {}
        _conv_history_lock = threading.Lock()

        # ── Per-Slack-user long-term memory ──────────────────────────────────
        _USER_MEMORY_PATH = Path(__file__).parent / "user_memory.json"
        _user_memory: dict[str, str] = {}

        def _load_user_memory():
            if _USER_MEMORY_PATH.exists():
                try:
                    data = json.loads(_USER_MEMORY_PATH.read_text("utf-8"))
                    if isinstance(data, dict):
                        _user_memory.update(data)
                except Exception:
                    pass

        def _save_user_memory():
            try:
                _USER_MEMORY_PATH.write_text(json.dumps(_user_memory, ensure_ascii=False, indent=2), "utf-8")
            except Exception:
                pass

        def _auto_update_memory(user_id: str, history: list[dict], claude):
            """Summarize conversation and update user memory every 5 turns."""
            if not claude or not user_id or len(history) < 10:
                return
            turn_count = len(history) // 2
            if turn_count % 5 != 0:
                return
            existing = _user_memory.get(user_id, "")
            hist_text = "\n".join(
                f"{'👤' if m['role'] == 'user' else '🤖'} {m['content'][:200]}"
                for m in history[-10:]
            )
            summary_prompt = (
                "Summarize the conversation below within 300 characters, focusing on key decisions, agreements, and important context. Output summary only."
            )
            if existing:
                summary_prompt += f"\n\nExisting memory:\n{existing}"
            try:
                summary = claude.complete(summary_prompt, f"Conversation:\n{hist_text}", max_tokens=400).strip()
                if summary:
                    _user_memory[user_id] = summary
                    _save_user_memory()
            except Exception:
                pass

        _load_user_memory()

        def parse_msg(text: str):
            text = BOT_MENTION_RE.sub("", text).strip()
            tag = "chief"
            m = PERSONA_TAG_RE.search(text)
            if m:
                tag = m.group(1).strip()
                text = text[:m.start()] + text[m.end():]
            return tag, text.strip()

        _VISION_MODEL = DEFAULT_SONNET_MODEL  # Always use Claude (ignore GPT/Gemini settings)

        # Slack CDN domains — only fetch images from these trusted hosts
        _SLACK_CDN_DOMAINS = ("files.slack.com", "slack-files.com", "slack-edge.com", "files.slack-edge.com")

        def _is_safe_slack_url(url: str) -> bool:
            """Validate that a URL belongs to Slack's CDN (SSRF protection)."""
            try:
                from urllib.parse import urlparse
                parsed = urlparse(url)
                if parsed.scheme != "https":
                    return False
                host = parsed.hostname or ""
                return any(host == d or host.endswith("." + d) for d in _SLACK_CDN_DOMAINS)
            except Exception:
                return False

        def _fetch_via_files_info(file_id: str) -> bytes | None:
            """
            Enterprise Grid fallback: get thumbnail URL via files.info API and download.
            url_private_download is blocked by SSO, but thumb_* URLs are served from a separate CDN
            and are often accessible with bot token Authorization header.
            """
            import requests as _req
            try:
                info = web.files_info(file=file_id)
                if not info.get("ok"):
                    return None
                file_obj = info["file"]
                for key in ("thumb_1024", "thumb_720", "thumb_480", "thumb_360"):
                    thumb_url = file_obj.get(key)
                    if not thumb_url:
                        continue
                    # SSRF guard: only fetch from Slack's own CDN domains
                    if not _is_safe_slack_url(thumb_url):
                        self._log(f"[Vision] SSRF blocked: disallowed URL {thumb_url[:80]}")
                        continue
                    self._log(f"[Vision] Enterprise thumb attempt: {key}")
                    r = _req.get(
                        thumb_url,
                        headers={"Authorization": f"Bearer {bot_token}"},
                        allow_redirects=False,  # don't follow redirects to prevent redirect-based SSRF
                        timeout=15,
                    )
                    if r.ok and r.content and r.content[:1] != b"<":
                        self._log(f"[Vision] Thumb download complete: {len(r.content)} bytes")
                        return r.content
            except Exception as e:
                self._log(f"[Vision] files.info failed: {e}")
            return None

        # Anthropic base64 image limit: 5MB base64 ≈ 3.75MB raw → 3.5MB with buffer
        _MAX_IMG_BYTES = 3_500_000

        def _shrink_image(raw: bytes, mimetype: str, file_id: str | None) -> tuple[bytes, str] | None:
            """Shrink image to Anthropic allowed range (≤3.5MB). PIL resize → Slack thumb fallback."""
            # Attempt PIL resize
            try:
                from PIL import Image
                import io as _io
                # Decompression bomb protection: limit to 50MP
                if len(raw) > 20_000_000:
                    self._log(f"[Vision] Image size exceeded ({len(raw)//1024//1024}MB), skipping")
                    raise ValueError("raw image too large")
                Image.MAX_IMAGE_PIXELS = 50_000_000
                img = Image.open(_io.BytesIO(raw))
                # Resize to max 1568px on longest side (Anthropic recommended max)
                if max(img.size) > 1568:
                    ratio = 1568 / max(img.size)
                    img = img.resize((int(img.size[0] * ratio), int(img.size[1] * ratio)), Image.LANCZOS)
                # Convert to JPEG if no transparency (size reduction)
                if img.mode in ("RGBA", "P", "LA"):
                    img = img.convert("RGB")
                buf = _io.BytesIO()
                img.save(buf, format="JPEG", quality=85, optimize=True)
                result = buf.getvalue()
                self._log(f"[Vision] PIL resize complete: {len(result)//1024}KB")
                return result, "image/jpeg"
            except ImportError:
                self._log("[Vision] PIL not available → trying Slack thumb")
            except Exception as e:
                self._log(f"[Vision] PIL error: {e}")
            # Slack thumb fallback (files.info → thumb_1024/720/480)
            if file_id:
                thumb = _fetch_via_files_info(file_id)
                if thumb:
                    self._log(f"[Vision] Using Slack thumb: {len(thumb)//1024}KB")
                    return thumb, "image/jpeg"
            return None

        def _download_images(image_files: list) -> list[dict]:
            """Download images → return [{"data": base64, "mediaType": str}] list."""
            import base64 as _b64
            results = []
            for f in image_files[:3]:
                url = f.get("url_private_download") or f.get("url_private")
                raw = download_slack_file(url or "", bot_token, log_fn=self._log) if url else None
                file_id = f.get("id")
                # Enterprise Grid fallback: files.info → thumb URL when SSO blocks
                if not raw and file_id:
                    raw = _fetch_via_files_info(file_id)
                if not raw:
                    self._log("[Vision] Download failed")
                    continue
                mimetype = f.get("mimetype") or "image/png"
                # Resize if too large (Anthropic 5MB base64 limit)
                if len(raw) > _MAX_IMG_BYTES:
                    self._log(f"[Vision] {len(raw)//1024}KB exceeded → resizing")
                    shrunk = _shrink_image(raw, mimetype, file_id)
                    if not shrunk:
                        self._log("[Vision] Resize failed → skipping")
                        continue
                    raw, mimetype = shrunk
                self._log(f"[Vision] {len(raw)//1024}KB magic={raw[:4].hex()}")
                results.append({"data": _b64.standard_b64encode(raw).decode(), "mediaType": mimetype})
            return results

        def _describe_images(downloaded: list[dict], query: str) -> str | None:
            """Describe downloaded images with Claude (for RAG query augmentation). Returns None on failure."""
            if not api_key:
                return None
            content_parts: list = [
                {"type": "image", "source": {"type": "base64", "media_type": img["mediaType"], "data": img["data"]}}
                for img in downloaded
            ]
            desc_prompt = (
                f"{query}\n\n"
                "Describe in detail the character's appearance in the image (outfit, colors, hair, expression, atmosphere, accessories, etc.). "
                "Output description only, no evaluation or conclusions."
            )
            content_parts.append({"type": "text", "text": desc_prompt})
            try:
                import anthropic as _ant
                msg = _ant.Anthropic(api_key=api_key).messages.create(
                    model=_VISION_MODEL,
                    max_tokens=800,
                    system="You are a game character art analysis expert. You describe images objectively.",
                    messages=[{"role": "user", "content": content_parts}],
                )
                return msg.content[0].text
            except Exception as e:
                self._log(f"[Vision] Description error: {e}")
                return None

        _IMAGE_WORDS = ["이미지", "사진", "그림", "원화", "일러스트", "레퍼런스", "image", "photo", "pic"]
        # Action/quantity words to remove during image search (to keep only topic words) — Korean keywords kept as-is
        _ACTION_WORDS = ["보여줘", "보여주세요", "찾아줘", "찾아주세요", "보내줘", "보내주세요",
                         "줘", "주세요", "검색해줘", "있어", "있나요", "있어요",
                         "하나", "한장", "몇개", "주", "좀", "제발", "꼭"]

        def _upload_images_to_slack(image_paths: list[str], channel: str, thread_ts: str | None) -> int:
            """Upload vault images to Slack. Returns number of successful uploads."""
            import requests as _req
            uploaded = 0
            for path in image_paths[:3]:
                try:
                    with open(path, "rb") as f:
                        content = f.read()
                    filename = os.path.basename(path)
                    resp = web.files_getUploadURLExternal(filename=filename, length=len(content))
                    upload_url = resp["upload_url"]
                    file_id = resp["file_id"]
                    _req.post(upload_url, data=content, timeout=30)
                    kw: dict = {"files": [{"id": file_id, "title": filename}], "channel_id": channel}
                    if thread_ts:
                        kw["thread_ts"] = thread_ts
                    web.files_completeUploadExternal(**kw)
                    uploaded += 1
                    self._log(f"[Image] Upload complete: {filename}")
                except Exception as e:
                    self._log(f"[Image] Upload failed ({os.path.basename(path)}): {e}")
            return uploaded

        _SLACK_MAX = 3800  # Slack block effective limit (4000 char buffer)

        def _say_long(text: str, say_fn, thread_ts: str | None, *, update_ts: str | None = None, channel: str | None = None):
            """Auto-split text exceeding 4000 chars for posting. First chunk uses chat_update if update_ts is set."""
            chunks, buf = [], ""
            for line in text.splitlines(keepends=True):
                if len(buf) + len(line) > _SLACK_MAX:
                    if buf:
                        chunks.append(buf.rstrip())
                    buf = line
                else:
                    buf += line
            if buf.strip():
                chunks.append(buf.rstrip())
            if not chunks:
                return
            for i, chunk in enumerate(chunks):
                suffix = f"\n\n_({i+1}/{len(chunks)})_" if len(chunks) > 1 else ""
                msg = chunk + suffix
                if i == 0 and update_ts and channel:
                    try:
                        web.chat_update(channel=channel, ts=update_ts, text=msg)
                    except Exception:
                        say_fn(text=msg, thread_ts=thread_ts)
                else:
                    say_fn(text=msg, thread_ts=thread_ts)

        def _run_single_miro(topic: str, num_personas: int, num_rounds: int,
                             context: str | None, sim_images: list | None,
                             segment: str | None, channel: str, think_ts: str | None,
                             preset_personas: list[dict] | None = None) -> dict | None:
            """Run a single MiroFish simulation (Electron → Python fallback). Returns result dict."""

            def update(msg: str):
                if think_ts:
                    try:
                        web.chat_update(channel=channel, ts=think_ts, text=msg)
                    except Exception as _ue:
                        self._log(f"[MiroFish] chat_update failed (ignored): {_ue}")

            # Cache check — includes context hash (different context = separate cache even for same topic)
            _ctx_hash = hash(context) if context else 0
            _img_flag = bool(sim_images)
            cache_key = (topic, num_personas, num_rounds, _ctx_hash, _img_flag)
            now_ts = time.time()
            with _miro_cache_lock:
                _cached = _miro_cache.get(cache_key)
            if _cached:
                cached_result, cached_at = _cached
                if now_ts - cached_at < _MIRO_CACHE_TTL:
                    age_min = int((now_ts - cached_at) / 60)
                    update(f"🐟 *Using cached result* ({age_min}min ago)\nTopic: *{topic}*\n_(Enter 'new simulation' for fresh results)_")
                    self._log(f"[MiroFish] Cache hit: {topic!r} ({age_min}min elapsed)")
                    return cached_result

            # Electron delegation + heartbeat thread (intermediate progress reports)
            if not is_electron_alive():
                self._log("[MiroFish] Electron offline → simulation unavailable")
                update(
                    f"🐟 *MiroFish Simulation Unavailable*\nTopic: *{topic}*\n\n"
                    f"🔴 *Sandbox Map app is not responding.*\n\n"
                    f"*Please check:*\n"
                    f"• Verify the Sandbox Map app is running\n"
                    f"• If the app was just launched, wait about 30 seconds and try again"
                )
                return None

            _result_holder: list[dict | None] = [None]
            _done_event = threading.Event()

            def _electron_call():
                try:
                    _result_holder[0] = mirofish_via_electron(
                        topic, num_personas, num_rounds, context=context, images=sim_images,
                        segment=segment, preset_personas=preset_personas,
                    )
                finally:
                    _done_event.set()

            electron_thread = threading.Thread(target=_electron_call, daemon=True)
            electron_thread.start()

            # Heartbeat: poll /mirofish-progress every 20s → real-time feed update
            elapsed = 0
            _shown_post_count = 0
            while not _done_event.wait(timeout=20):
                elapsed += 20
                # 부분 피드 폴링
                try:
                    import urllib.request as _ureq, json as _json
                    with _ureq.urlopen(RAG_API_BASE + "/mirofish-progress", timeout=3) as _r:
                        _prog = _json.loads(_r.read().decode("utf-8"))
                    partial_feed = _prog.get("feed", [])
                    cur_round = _prog.get("round", 0)
                    new_posts = partial_feed[_shown_post_count:]
                    if new_posts:
                        _shown_post_count = len(partial_feed)
                        lines = []
                        for p in new_posts[-5:]:  # 최신 5개만
                            st = STANCE_LABEL.get(p.get("stance", ""), p.get("stance", ""))
                            lines.append(f"*[R{p['round']}] {p['personaName']}* ({st})\n> {p['content']}")
                        feed_preview = "\n\n".join(lines)
                        update(
                            f"🐟 *MiroFish 진행 중* (R{cur_round}/{num_rounds})\n"
                            f"주제: *{topic}* | ⏱️ {elapsed}초\n\n"
                            f"{feed_preview}\n\n_...계속 실행 중..._"
                        )
                    else:
                        update(
                            f"🐟 *MiroFish simulation in progress...*\n"
                            f"Topic: *{topic}* | Personas: {num_personas} | Rounds: {num_rounds}\n"
                            f"_(⏱️ {elapsed}초 경과)_"
                        )
                except Exception:
                    update(
                        f"🐟 *MiroFish simulation in progress...*\n"
                        f"Topic: *{topic}* | Personas: {num_personas} | Rounds: {num_rounds}\n"
                        f"_(⏱️ {elapsed}초 경과)_"
                    )

            result = _result_holder[0]

            # Error response handling: {'feed': [], 'report': 'Error: ...'} or in-flight response → treat as None for fallback
            _report_str = result.get("report", "") if isinstance(result, dict) else ""
            if isinstance(result, dict) and not result.get("feed") and isinstance(_report_str, str) and (
                _report_str.startswith("오류:") or "이미 실행 중" in _report_str  # Korean error markers kept for Electron compatibility
            ):
                self._log(f"[MiroFish] Electron 오류 응답: {result.get('report', '')[:100]}")
                result = None

            # Electron fallback: direct Python execution
            if result is None:
                self._log("[MiroFish] Electron not running → Python fallback")
                live_key = get_anthropic_key(self.cfg)
                if not live_key:
                    return None
                model = get_model_for_tag("chief")
                claude_cli = ClaudeClient(live_key, model)

                round_count = [0]
                def progress_log(msg: str):
                    self._log(msg)
                    if "[MiroFish] Round" in msg or "[MiroFish] 라운드" in msg:
                        round_count[0] += 1
                        update(
                            f"🐟 *MiroFish Simulation*\nTopic: *{topic}*\n"
                            f"Round {round_count[0]}/{num_rounds} in progress..."
                        )
                # NOTE: mirofish_runner.run_simulation does not support segment — segment is only applied in the Electron path
                result = mirofish_run_python(topic, num_personas, num_rounds, claude_cli, log_fn=progress_log, context=context)

            if result:
                with _miro_cache_lock:
                    _miro_cache[cache_key] = (result, time.time())
                    # Remove oldest entries when cache exceeds max size
                    if len(_miro_cache) > _MIRO_CACHE_MAX:
                        oldest_keys = sorted(_miro_cache, key=lambda k: _miro_cache[k][1])
                        for _k in oldest_keys[:len(_miro_cache) - _MIRO_CACHE_MAX]:
                            del _miro_cache[_k]

            return result

        # ── MiroFish HTML Report Generation ───────────────────────────────────────
        _REPORTS_DIR = Path(__file__).parent / "reports" / "mirofish"
        _CHAT_REPORTS_DIR = Path(__file__).parent / "reports" / "chat"

        def _generate_report_html(title: str, content: str) -> Path:
            """Save LLM report markdown as wkhtmltopdf-compatible HTML file. Returns file path."""
            _CHAT_REPORTS_DIR.mkdir(parents=True, exist_ok=True)
            import html as _html_mod
            _EMOJI_RE_R = _re.compile(
                "["
                "\U0001F000-\U0001FFFF"
                "\u2600-\u27BF"
                "\u2B00-\u2BFF"
                "\u23E9-\u23F3"
                "\uFE00-\uFE0F"
                "\U0001FA00-\U0001FA9F"
                "]+",
                _re.UNICODE,
            )
            def _strip_emoji(text: str) -> str:
                return _EMOJI_RE_R.sub("", text)

            def _md_to_html(text: str) -> str:
                lines, out = text.splitlines(), []
                in_code = False
                in_table = False
                table_rows: list[str] = []

                def flush_table() -> None:
                    if not table_rows:
                        return
                    rows_html = []
                    for ri, row in enumerate(table_rows):
                        cells = [c.strip() for c in row.strip("|").split("|")]
                        tag = "th" if ri == 0 else "td"
                        rows_html.append("<tr>" + "".join(f"<{tag}>{c}</{tag}>" for c in cells) + "</tr>")
                    out.append(f'<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;margin:8px 0">')
                    out.extend(rows_html)
                    out.append("</table>")
                    table_rows.clear()

                for line in lines:
                    # Code block toggle
                    if line.startswith("```"):
                        if not in_code:
                            if in_table:
                                flush_table()
                                in_table = False
                            out.append('<pre style="background:#f1f5f9;padding:10px;border-radius:4px;overflow-x:auto"><code>')
                            in_code = True
                        else:
                            out.append("</code></pre>")
                            in_code = False
                        continue
                    if in_code:
                        out.append(_html_mod.escape(line))
                        continue

                    # Table row detection
                    if line.startswith("|") and line.endswith("|"):
                        if not in_table:
                            in_table = True
                        # Skip separator rows (|---|---| pattern)
                        if _re.fullmatch(r'[\|\-\s:]+', line):
                            continue
                        table_rows.append(line)
                        continue
                    else:
                        if in_table:
                            flush_table()
                            in_table = False

                    escaped = _html_mod.escape(_strip_emoji(line))
                    if escaped.startswith("### "):
                        out.append(f"<h3>{escaped[4:]}</h3>")
                    elif escaped.startswith("## "):
                        out.append(f"<h2>{escaped[3:]}</h2>")
                    elif escaped.startswith("# "):
                        out.append(f"<h1>{escaped[2:]}</h1>")
                    elif escaped.startswith("- ") or escaped.startswith("* "):
                        out.append(f"<li>{escaped[2:]}</li>")
                    elif escaped.strip() in ("---", "***"):
                        out.append("<hr>")
                    elif escaped.strip() == "":
                        out.append("<br>")
                    else:
                        escaped = _re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", escaped)
                        escaped = _re.sub(r"`(.+?)`", r"<code>\1</code>", escaped)
                        out.append(f"<p>{escaped}</p>")

                if in_table:
                    flush_table()
                if in_code:
                    out.append("</code></pre>")
                return "\n".join(out)

            now_str  = datetime.now().strftime("%Y%m%d_%H%M")
            date_str = datetime.now().strftime("%Y년 %m월 %d일")
            safe_title = _re.sub(r'[\\/*?:"<>|]', "", title)[:40].strip()
            filename = f"{now_str}_{safe_title}.html"
            filepath = _CHAT_REPORTS_DIR / filename
            body_html = _md_to_html(content)

            html_content = f"""<!DOCTYPE html>
<html lang="ko">
<head><meta charset="UTF-8"><title>{_html_mod.escape(title)}</title>
<style>
* {{ margin:0; padding:0; box-sizing:border-box; }}
body {{ font-family:'Malgun Gothic','Apple SD Gothic Neo','Noto Sans KR',sans-serif; font-size:13px; line-height:1.75; color:#1e293b; background:#fff; }}
.cover {{ background:#0f172a; color:#f1f5f9; padding:48px 56px 40px; }}
.cover-tag {{ font-size:10px; letter-spacing:3px; text-transform:uppercase; color:#64748b; margin-bottom:16px; }}
.cover-title {{ font-size:26px; font-weight:700; color:#f8fafc; margin-bottom:8px; line-height:1.3; }}
.cover-date {{ font-size:12px; color:#94a3b8; }}
.body {{ padding:40px 56px; max-width:900px; margin:0 auto; }}
h1 {{ font-size:20px; font-weight:700; color:#0f172a; margin:28px 0 12px; border-bottom:2px solid #3b82f6; padding-bottom:6px; }}
h2 {{ font-size:17px; font-weight:700; color:#1e3a5f; margin:24px 0 10px; }}
h3 {{ font-size:14px; font-weight:700; color:#334155; margin:18px 0 8px; }}
p {{ margin:8px 0; }}
ul, ol {{ margin:8px 0 8px 24px; }}
li {{ margin:4px 0; list-style:disc; }}
hr {{ border:none; border-top:1px solid #e2e8f0; margin:20px 0; }}
strong {{ font-weight:700; }}
code {{ background:#f1f5f9; padding:1px 4px; border-radius:3px; font-size:12px; font-family:monospace; }}
table {{ border-collapse:collapse; margin:8px 0; width:100%; }}
th, td {{ border:1px solid #cbd5e1; padding:6px 10px; text-align:left; font-size:12px; }}
th {{ background:#f8fafc; font-weight:700; }}
.footer {{ margin-top:48px; padding-top:14px; border-top:1px solid #e2e8f0; font-size:10px; color:#94a3b8; text-align:center; }}
</style>
</head><body>
<div class="cover">
  <div class="cover-tag">Strata Sync &middot; Report</div>
  <div class="cover-title">{_html_mod.escape(title)}</div>
  <div class="cover-date">{date_str}</div>
</div>
<div class="body">
{body_html}
  <div class="footer">Strata Sync &mdash; {date_str} 생성</div>
</div></body></html>"""

            filepath.write_text(html_content, encoding="utf-8")
            self._log(f"[Report] HTML saved: {filepath}")
            return filepath

        def _generate_mirofish_html(
            topic: str, report: str, feed: list,
            num_personas: int, num_rounds: int,
            pm_brief: str | None = None,
        ) -> Path:
            """Save MiroFish results as an HTML file. Returns file path."""
            _REPORTS_DIR.mkdir(parents=True, exist_ok=True)

            now_str   = datetime.now().strftime("%Y%m%d_%H%M")
            safe_topic = _re.sub(r'[\\/*?:"<>|]', "", topic)[:40].strip()
            filename   = f"{now_str}_{safe_topic}.html"
            filepath   = _REPORTS_DIR / filename

            # Aggregate by stance
            stance_counts: dict[str, int] = {}
            for p in feed:
                s = p.get("stance", "neutral")
                stance_counts[s] = stance_counts.get(s, 0) + 1
            total_posts = len(feed)

            STANCE_LABEL  = {"supportive": "지지", "opposing": "반대", "neutral": "중립", "observer": "관찰"}
            STANCE_COLOR  = {"supportive": "#00b894", "opposing": "#d63031", "neutral": "#636e72", "observer": "#0984e3"}
            BADGE_CLASS   = {"supportive": "badge-supportive", "opposing": "badge-opposing",
                             "neutral": "badge-neutral", "observer": "badge-observer"}
            AVATAR_INITIAL = {"supportive": "지", "opposing": "반", "neutral": "중", "observer": "관"}

            # Report markdown → basic HTML conversion
            import html as _html_mod

            # wkhtmltopdf renders emoji (U+1F000+) and some special chars as ☒ → pre-strip
            _EMOJI_RE = _re.compile(
                "["
                "\U0001F000-\U0001FFFF"   # Full emoji supplemental block
                "\u2600-\u27BF"           # Misc symbols (including ☐☑☒)
                "\u2B00-\u2BFF"           # Supplemental arrows/geometry
                "\u23E9-\u23F3"           # Clock/media symbols
                "\uFE00-\uFE0F"           # variation selector
                "\U0001FA00-\U0001FA9F"   # 체스·기타 확장
                "]+",
                _re.UNICODE,
            )
            def strip_emoji(text: str) -> str:
                return _EMOJI_RE.sub("", text)

            def md_to_html(text: str) -> str:
                lines, out = text.splitlines(), []
                for line in lines:
                    escaped = _html_mod.escape(strip_emoji(line))
                    if escaped.startswith("## "):
                        out.append(f"<h3>{escaped[3:]}</h3>")
                    elif escaped.startswith("### "):
                        out.append(f"<h4>{escaped[4:]}</h4>")
                    elif escaped.startswith("- ") or escaped.startswith("• "):
                        out.append(f"<li>{escaped[2:]}</li>")
                    elif escaped.startswith("**") and escaped.endswith("**"):
                        out.append(f"<strong>{escaped[2:-2]}</strong>")
                    elif escaped == "---" or escaped == "━" * 3:
                        out.append("<hr>")
                    elif escaped.strip() == "":
                        out.append("<br>")
                    else:
                        # Inline bold **text**
                        escaped = _re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", escaped)
                        out.append(f"<p>{escaped}</p>")
                return "\n".join(out)

            # 피드 카드
            feed_html_parts = []
            for post in feed:
                stance   = post.get("stance", "neutral")
                label_ko = STANCE_LABEL.get(stance, stance)
                badge    = BADGE_CLASS.get(stance, "badge-neutral")
                initial  = AVATAR_INITIAL.get(stance, "중")
                av_color = STANCE_COLOR.get(stance, "#888")
                content  = _html_mod.escape(strip_emoji(post.get("content", "")))
                name     = _html_mod.escape(strip_emoji(post.get("personaName", "")))
                rnd      = post.get("round", "?")
                likes    = post.get("likes", 0)
                reposts  = post.get("reposts", 0)
                is_repost = post.get("actionType") == "repost"
                repost_tag = '<div class="repost-label">↩ Repost</div>' if is_repost else ""
                feed_html_parts.append(f"""
                <div class="feed-item">
                  <div class="feed-avatar">
                    <div class="feed-avatar-inner" style="background:{av_color};color:#fff;">{initial}</div>
                  </div>
                  <div class="feed-body">
                    <div class="feed-header">
                      <span class="feed-name">{name}</span>
                      <span class="badge {badge}">{label_ko}</span>
                      <span class="feed-round">R{rnd}</span>
                      <span class="feed-engagement">Likes {likes} / Reposts {reposts}</span>
                    </div>
                    {repost_tag}
                    <div class="feed-content">{content}</div>
                  </div>
                </div>""")

            # Stance distribution bar
            stance_bar_parts = []
            for s, cnt in sorted(stance_counts.items(), key=lambda x: -x[1]):
                color = STANCE_COLOR.get(s, "#888")
                lbl   = STANCE_LABEL.get(s, s)
                pct   = round(cnt / total_posts * 100) if total_posts else 0
                stance_bar_parts.append(
                    f'<div class="stance-count">'
                    f'<div class="stance-dot" style="background:{color}"></div>'
                    f'{lbl} {cnt}건 ({pct}%)</div>'
                )

            brief_section = ""
            if pm_brief:
                brief_section = f"""
            <div class="section">
              <h2>PM Brief</h2>
              <div class="report-text">{md_to_html(pm_brief)}</div>
            </div>"""

            html = f"""<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MiroFish — {_html_mod.escape(topic)}</title>
<style>
* {{ margin:0; padding:0; box-sizing:border-box; }}
body {{ font-family:'Malgun Gothic','Apple SD Gothic Neo','Noto Sans KR',sans-serif; background:#f5f6fa; color:#2d3436; }}
/* Header — wkhtmltopdf compatible: solid color instead of gradient, no opacity */
.header {{ background:#0984e3; color:#ffffff; padding:28px 36px; }}
.header h1 {{ font-size:20px; font-weight:700; margin-bottom:6px; color:#ffffff; }}
.header .meta {{ font-size:12px; color:#d0e8ff; margin-bottom:16px; }}
/* stats: inline-block으로 gap 대체 */
.stats {{ margin-top:4px; }}
.stat {{ display:inline-block; background:#1a6fba; padding:10px 18px; border-radius:6px;
         text-align:center; margin-right:10px; margin-bottom:8px; min-width:80px; }}
.stat .val {{ font-size:24px; font-weight:700; color:#ffffff; display:block; }}
.stat .lbl {{ font-size:11px; color:#b8d8f5; display:block; margin-top:2px; }}
/* 본문 */
.content {{ max-width:860px; margin:24px auto; padding:0 20px; }}
.section {{ background:#ffffff; border-radius:8px; padding:24px; margin-bottom:18px;
            border:1px solid #e0e0e0; }}
.section h2 {{ font-size:15px; font-weight:700; color:#1a1a2e; margin-bottom:16px;
               padding-bottom:8px; border-bottom:2px solid #e8ecf0; }}
.report-text p {{ line-height:1.8; color:#444; margin-bottom:8px; }}
.report-text h3 {{ color:#0984e3; font-size:14px; font-weight:700; margin:16px 0 6px; }}
.report-text h4 {{ color:#555; font-size:13px; font-weight:700; margin:10px 0 4px; }}
.report-text li {{ line-height:1.8; color:#444; margin-left:18px; margin-bottom:3px; }}
.report-text hr {{ border:none; border-top:1px solid #eee; margin:14px 0; }}
/* stance bar: inline-block */
.stance-bar {{ margin-bottom:16px; }}
.stance-count {{ display:inline-block; margin-right:14px; margin-bottom:6px;
                 font-size:12px; color:#555; vertical-align:middle; }}
.stance-dot {{ display:inline-block; width:9px; height:9px; border-radius:50%;
               margin-right:4px; vertical-align:middle; }}
/* feed: table layout replacing flex */
.feed-item {{ display:table; width:100%; margin-bottom:16px; padding-bottom:16px;
              border-bottom:1px solid #f0f0f0; }}
.feed-item:last-child {{ border-bottom:none; margin-bottom:0; padding-bottom:0; }}
.feed-avatar {{ display:table-cell; width:36px; vertical-align:top; padding-right:12px; }}
.feed-avatar-inner {{ width:34px; height:34px; border-radius:50%; background:#e8ecf0;
                       text-align:center; line-height:34px; font-size:13px; font-weight:700; color:#555; }}
.feed-body {{ display:table-cell; vertical-align:top; }}
.feed-header {{ margin-bottom:5px; }}
.feed-name {{ font-weight:700; font-size:13px; margin-right:6px; }}
.feed-round {{ font-size:11px; color:#aaa; margin-right:6px; }}
.feed-engagement {{ font-size:11px; color:#aaa; }}
.feed-content {{ font-size:13px; line-height:1.65; color:#444; background:#f8f9fa;
                 padding:9px 13px; border-radius:6px; margin-top:4px; }}
.repost-label {{ font-size:11px; color:#999; margin-bottom:3px; }}
.badge {{ padding:2px 7px; border-radius:10px; font-size:10px; font-weight:700; margin-right:4px; }}
.badge-supportive {{ background:#d4f0e0; color:#007a37; }}
.badge-opposing   {{ background:#fde8e8; color:#b52b2b; }}
.badge-neutral    {{ background:#e8eaf0; color:#555; }}
.badge-observer   {{ background:#d8ecfd; color:#0068b5; }}
footer {{ text-align:center; color:#bbb; font-size:11px; padding:20px; }}
</style>
</head>
<body>
<div class="header">
  <h1>MiroFish Simulation Report</h1>
  <div class="meta">주제: {_html_mod.escape(topic)} | {datetime.now().strftime("%Y-%m-%d %H:%M")}</div>
  <div class="stats">
    <div class="stat"><span class="val">{num_personas}</span><span class="lbl">Personas</span></div>
    <div class="stat"><span class="val">{num_rounds}</span><span class="lbl">Rounds</span></div>
    <div class="stat"><span class="val">{total_posts}</span><span class="lbl">Total Posts</span></div>
    <div class="stat"><span class="val">{stance_counts.get('supportive',0)}</span><span class="lbl">지지</span></div>
    <div class="stat"><span class="val">{stance_counts.get('opposing',0)}</span><span class="lbl">반대</span></div>
    <div class="stat"><span class="val">{stance_counts.get('neutral',0)}</span><span class="lbl">중립</span></div>
  </div>
</div>
<div class="content">
  {brief_section}
  <div class="section">
    <h2>Analysis Report</h2>
    <div class="report-text">{md_to_html(report)}</div>
  </div>
  <div class="section">
    <h2>Simulation Feed ({total_posts} posts)</h2>
    <div class="stance-bar">{''.join(stance_bar_parts)}</div>
    {''.join(feed_html_parts)}
  </div>
</div>
<footer>Generated by Strata Sync Bot · MiroFish</footer>
</body>
</html>"""

            filepath.write_text(html, encoding="utf-8")
            self._log(f"[MiroFish] HTML report saved: {filepath}")
            return filepath

        def _upload_file_to_slack(filepath: Path, channel: str, thread_ts: str | None, title: str = "") -> bool:
            """Upload file to Slack. Returns success status."""
            import requests as _req
            try:
                content  = filepath.read_bytes()
                filename = filepath.name
                resp     = web.files_getUploadURLExternal(filename=filename, length=len(content))
                upload_url = resp["upload_url"]
                file_id    = resp["file_id"]
                _req.post(upload_url, data=content, timeout=30)
                kw: dict = {
                    "files": [{"id": file_id, "title": title or filename}],
                    "channel_id": channel,
                }
                if thread_ts:
                    kw["thread_ts"] = thread_ts
                web.files_completeUploadExternal(**kw)
                self._log(f"[MiroFish] HTML upload complete: {filename}")
                return True
            except Exception as e:
                self._log(f"[MiroFish] HTML upload failed: {e}")
                return False

        def _format_and_post_miro(result: dict, topic: str, num_personas: int, num_rounds: int,
                                   say, channel: str, thread_ts: str | None, think_ts: str | None,
                                   report_only: bool, label: str = "", pm_brief: str | None = None):
            """Post MiroFish results to Slack + auto-save to vault."""
            def update(msg: str, blocks: list | None = None):
                if think_ts:
                    try:
                        kw: dict = {"channel": channel, "ts": think_ts, "text": msg}
                        if blocks:
                            kw["blocks"] = blocks
                        web.chat_update(**kw)
                    except Exception as _ue:
                        self._log(f"[MiroFish] chat_update failed (ignored): {_ue}")

            feed   = result.get("feed", [])
            report = result.get("report", "")

            # ── Slack summary message (concise) ─────────────────────────────
            prefix = f"*{label}* " if label else ""
            stance_counts: dict[str, int] = {}
            for p in feed:
                s = p.get("stance", "neutral")
                stance_counts[s] = stance_counts.get(s, 0) + 1

            stance_summary = "  ".join(
                f"{STANCE_LABEL.get(s, s)} {c}건"
                for s, c in sorted(stance_counts.items(), key=lambda x: -x[1])
            ) or "—"

            # Extract only the first meaningful paragraph (max 400 chars) from the report as preview
            report_preview = ""
            for line in report.splitlines():
                stripped = line.strip().lstrip("#").strip()
                if len(stripped) > 30:
                    report_preview = stripped[:400]
                    break

            title_prefix = f"{label}  " if label else ""
            summary_blocks = [
                {
                    "type": "header",
                    "text": {"type": "plain_text", "text": f"🐟  {title_prefix}MiroFish Simulation Complete", "emoji": True},
                },
                {
                    "type": "section",
                    "text": {"type": "mrkdwn", "text": f"*{topic}*"},
                },
                {
                    "type": "section",
                    "fields": [
                        {"type": "mrkdwn", "text": f"*Personas*\n{num_personas}"},
                        {"type": "mrkdwn", "text": f"*Rounds*\n{num_rounds}"},
                        {"type": "mrkdwn", "text": f"*Posts*\n{len(feed)}"},
                        {"type": "mrkdwn", "text": f"*반응 분포*\n{stance_summary}"},
                    ],
                },
                {
                    "type": "context",
                    "elements": [{"type": "mrkdwn", "text": "📄 Generating results report..."}],
                },
            ]
            slack_summary = f"🐟 MiroFish 완료: {topic} ({len(feed)}개 반응 · {stance_summary})"
            update(slack_summary, blocks=summary_blocks)

            # ── HTML report generation + Slack upload (async) ────────────────
            def _async_post():
                try:
                    # Follow-up simulation suggestions
                    # Fallback reports (no API key etc.) don't expose error context to LLM
                    _is_fallback = "API 키가 없어" in report or not report.strip()
                    _report_summary = "" if _is_fallback else report[:800]
                    followup_prompt = (
                        f"The following MiroFish user response simulation is complete:\n"
                        f"주제: {topic}\n"
                        + (f"Report summary: {_report_summary}\n\n" if _report_summary else "\n")
                        + f"Based on these results, briefly suggest 2-3 derivative simulation topics "
                        f"that a game designer could explore further.\n"
                        f"Each suggestion should be one line, in a format that can be directly used as a 🐟 command."
                    )
                    followup, _ = ask_via_electron(followup_prompt, tag="chief")
                    if followup:
                        say(
                            blocks=[
                                {
                                    "type": "section",
                                    "text": {
                                        "type": "mrkdwn",
                                        "text": f"*💡  Follow-up Simulation Suggestions*\n\n{followup.strip()}",
                                    },
                                },
                            ],
                            text=f"💡 Follow-up Simulation Suggestions\n\n{followup.strip()}",
                            thread_ts=thread_ts,
                        )
                except Exception as _e:
                    self._log(f"[MiroFish] 후속 제안 실패: {_e}")

                try:
                    # HTML generation → PDF conversion → Slack upload (HTML is local backup)
                    html_path = _generate_mirofish_html(
                        topic, report, feed, num_personas, num_rounds, pm_brief=pm_brief
                    )
                    try:
                        import pdfkit as _pdfkit
                        _WKHTMLTOPDF = cfg.get("wkhtmltopdf_path", r"C:\Program Files (x86)\wkhtmltopdf\bin\wkhtmltopdf.exe")
                        pdf_path = html_path.with_suffix(".pdf")
                        _pdfkit.from_file(
                            str(html_path), str(pdf_path),
                            configuration=_pdfkit.configuration(wkhtmltopdf=_WKHTMLTOPDF),
                            options={"encoding": "UTF-8", "quiet": ""},
                        )
                        self._log(f"[MiroFish] PDF 변환 완료: {pdf_path.name}")
                        upload_path = pdf_path
                    except Exception as _pdf_e:
                        self._log(f"[MiroFish] PDF conversion failed ({type(_pdf_e).__name__}: {_pdf_e}) → HTML upload")
                        upload_path = html_path
                    _upload_file_to_slack(
                        upload_path, channel, thread_ts,
                        title=f"MiroFish — {topic}"
                    )
                    # Update message after upload complete
                    ext = upload_path.suffix.upper().lstrip(".")
                    done_blocks = [
                        {
                            "type": "header",
                            "text": {"type": "plain_text", "text": f"🐟  {title_prefix}MiroFish Simulation Complete", "emoji": True},
                        },
                        {
                            "type": "section",
                            "text": {"type": "mrkdwn", "text": f"*{topic}*"},
                        },
                        {
                            "type": "section",
                            "fields": [
                                {"type": "mrkdwn", "text": f"*Personas*\n{num_personas}"},
                                {"type": "mrkdwn", "text": f"*Rounds*\n{num_rounds}"},
                                {"type": "mrkdwn", "text": f"*Posts*\n{len(feed)}"},
                                {"type": "mrkdwn", "text": f"*반응 분포*\n{stance_summary}"},
                            ],
                        },
                        {
                            "type": "context",
                            "elements": [{"type": "mrkdwn", "text": f"📎 Report {ext} file is attached below."}],
                        },
                    ]
                    update(
                        f"🐟 MiroFish complete: {topic} · {ext} report attached",
                        blocks=done_blocks,
                    )
                except Exception as _e:
                    self._log(f"[MiroFish] Report generation failed: {_e}")

                try:
                    # 볼트 저장
                    saved = save_mirofish_to_vault(topic, report, feed, brief=pm_brief)
                    if saved and saved.get("ok"):
                        fname = saved.get("filename", "")
                        self._log(f"[MiroFish] 볼트 저장 완료: {fname}")
                    elif saved:
                        self._log(f"[MiroFish] 볼트 저장 실패: {saved}")
                    else:
                        self._log("[MiroFish] Vault save failed — Electron not running or no response")
                except Exception as _e:
                    self._log(f"[MiroFish] 볼트 저장 예외: {_e}")

            threading.Thread(target=_async_post, daemon=True).start()

            # Save simulation results to thread history → provides context for follow-up summary/analysis questions
            hist_key = f"{channel}:{thread_ts or 'dm'}"
            summary_for_hist = report[:1500] if len(report) > 1500 else report
            with _conv_history_lock:
                prior = _conv_history.get(hist_key, [])
                _conv_history[hist_key] = (prior + [
                    {"role": "user",      "content": f"[MiroFish Simulation] Topic: {topic}"},
                    {"role": "assistant", "content": f"[Simulation Complete] Report:\n{summary_for_hist}"},
                ])[-40:]

        def _handle_mirofish(query: str, say, channel: str, thread_ts: str | None, image_files: list | None = None):
            """Handle MiroFish simulation requests."""
            # Parameter parsing
            personas_m = MIRO_PERSONAS_RE.search(query)
            rounds_m   = MIRO_ROUNDS_RE.search(query)
            num_personas = int(personas_m.group(1)) if personas_m else 5
            num_rounds   = int(rounds_m.group(1))   if rounds_m   else 3
            num_personas = max(3, min(50, num_personas))
            num_rounds   = max(2, min(10, num_rounds))

            # Report-only mode — "시뮬 Report" / "시뮬레이션 Report" keyword — Korean patterns kept as-is
            report_only = bool(_re.search(r"시뮬레이션?\s*Report|시뮬\s*Report", query))

            # Segment extraction
            seg_m = MIRO_SEGMENT_RE.search(query)
            segment: str | None = seg_m.group(0).strip() if seg_m else None

            # Extract preset reference: [프리셋:name] or [preset:name]
            preset_m = MIRO_PRESET_RE.search(query)
            preset_personas: list[dict] | None = None
            preset_label = ""
            if preset_m:
                preset_name_raw = preset_m.group(1).strip()
                settings_data = get_electron_settings() or {}
                saved_presets = settings_data.get("presets", [])
                # Name fuzzy matching (case-insensitive search)
                matched = next(
                    (p for p in saved_presets if preset_name_raw.lower() in p.get("name", "").lower()),
                    None,
                )
                if matched:
                    preset_personas = matched.get("personas", []) or None
                    preset_label = f" | Preset: {matched['name']}"
                    if preset_personas:
                        num_personas = len(preset_personas)
                    self._log(f"[MiroFish] Preset '{matched['name']}' applied ({num_personas} personas)")
                else:
                    preset_list = ", ".join(f"'{p.get('name','')}'" for p in saved_presets[:5])
                    say(text=f"🐟 Preset `{preset_name_raw}` not found.\nSaved presets: {preset_list or 'none'}",
                        thread_ts=thread_ts)
                    return

            # A vs B 비교 모드 감지: "주제A vs 주제B"
            vs_m = _re.search(r"(.+?)\s+vs\.?\s+(.+)", query, _re.IGNORECASE)
            is_vs_mode = bool(vs_m)

            # Topic extraction: remove only trigger keywords + numeric options (segment kept in topic — removing it makes topic incomplete)
            topic = MIROFISH_RE.sub("", query)
            topic = MIRO_PERSONAS_RE.sub("", topic)
            topic = MIRO_ROUNDS_RE.sub("", topic)
            if preset_m:
                topic = MIRO_PRESET_RE.sub("", topic)
            topic = _re.sub(r"\s*Report\s*", " ", topic)
            topic = _re.sub(r"\s*새로\s*시뮬레이션\s*", " ", topic)
            topic = topic.strip(",:. ~\t\n").strip()
            # trailing 요청 표현 제거: 해줘/해주세요/해봐/줘/주세요/부탁해/돌려줘/실행해줘 등
            topic = _re.sub(
                r"\s*(?:해\s*주세요|해\s*줘|해\s*봐요?|해요|해|주세요|줘"
                r"|부탁\s*(?:해요?|드려요?)"
                r"|돌려\s*줘?|실행해\s*줘?|시작해\s*줘?)\s*$",
                "", topic,
            ).strip()
            if not topic:
                say(text="🐟 시뮬레이션할 주제를 함께 입력해주세요.\n예: `🐟 새 캐릭터 출시 반응 5명 3라운드`", thread_ts=thread_ts)
                return

            # "새로 시뮬레이션" → 캐시 무효화 (동일 토픽 모든 캐시 항목 제거)
            if _re.search(r"새로\s*시뮬레이션", query):
                with _miro_cache_lock:
                    keys_to_del = [k for k in _miro_cache if k[0] == topic]
                    for k in keys_to_del:
                        _miro_cache.pop(k, None)

            seg_label = f" | 세그먼트: {segment}" if segment else ""
            thinking = say(
                text=f"🐟  *MiroFish*  {topic}  —  {num_personas}명 · {num_rounds}회{seg_label}{preset_label}\n_⏳ 시뮬레이션 준비 중..._",
                thread_ts=thread_ts,
            )
            think_ts = (thinking or {}).get("ts")

            self._log(f"[MiroFish] topic='{topic}' personas={num_personas} rounds={num_rounds} segment={segment!r} preset={bool(preset_personas)} vs={is_vs_mode}")

            # 볼트 RAG 검색으로 배경 컨텍스트 수집
            context: str | None = None
            rag_docs = search_via_electron(topic, top_n=3)
            if rag_docs:
                ctx_parts = []
                for doc in rag_docs:
                    title = doc.get("title") or doc.get("filename", "")
                    body  = (doc.get("body") or "")[:600]
                    if body:
                        ctx_parts.append(f"### {title}\n{body}")
                if ctx_parts:
                    context = "\n\n".join(ctx_parts)
                    self._log(f"[MiroFish] RAG context injected: {len(ctx_parts)} documents")

            # 이미지 처리: imageDirectPass 설정에 따라 직접 전달 vs 텍스트 변환
            sim_images: list[dict] | None = None
            if image_files:
                if think_ts:
                    try:
                        web.chat_update(channel=channel, ts=think_ts,
                                        text=f"🐟  *MiroFish*  {topic}\n_🖼️ 이미지 처리 중..._")
                    except Exception as _ue:
                        self._log(f"[MiroFish] chat_update failed (ignored): {_ue}")
                images_payload = _download_images(image_files)
                if images_payload:
                    image_direct = get_electron_settings() or {}
                    if image_direct.get("imageDirectPass", True):
                        sim_images = images_payload
                        self._log(f"[MiroFish] Direct image pass-through mode: {len(sim_images)} images")
                    else:
                        desc_answer, _ = ask_via_electron(
                            "첨부된 이미지를 시뮬레이션 참가자들이 참고할 수 있도록 "
                            "객관적으로 설명해주세요. 디자인, 분위기, 특징을 3-5문장으로 묘사하세요.",
                            tag="chief",
                            images=images_payload,
                        )
                        if desc_answer:
                            img_ctx = f"### 첨부 이미지 설명\n{desc_answer.strip()}"
                            context = f"{img_ctx}\n\n{context}" if context else img_ctx
                            self._log(f"[MiroFish] Image-to-text context injected ({len(desc_answer)} chars)")

            # ── PM AI 브리프 생성 ──────────────────────────────────────────
            # 원본 요청 + RAG 문서를 PM AI가 분석 → MiroFish용 구조화된 브리프 생성
            # (raw context를 그대로 넘기는 것보다 의도를 정확히 해석한 브리프가 더 효과적)
            if think_ts:
                try:
                    web.chat_update(channel=channel, ts=think_ts,
                                    text=f"🐟  *MiroFish*  {topic}\n_🧠 브리프 작성 중..._")
                except Exception as _ue:
                    self._log(f"[MiroFish] chat_update failed (ignored): {_ue}")

            brief_prompt_parts = [
                "MiroFish 시뮬레이션(가상 유저 반응) 브리프를 작성해줘. 600자 이내, 서론 없이.\n\n",
                f"[요청]\n{query}\n",
            ]
            if context:
                brief_prompt_parts.append(f"\n[볼트 참고 문서]\n{context}\n")
            brief_prompt_parts.append(
                "\n형식:\n"
                "**핵심 배경**: 참가자들이 알아야 할 배경 (3-5줄)\n"
                "**관찰 포인트**: 주목할 반응 유형·쟁점 2-3가지\n\n"
                "주의: 주제는 원본 요청 그대로 유지. 볼트 문서 없으면 요청 맥락만으로 작성."
            )
            # PM 브리프: ClaudeClient 직접 호출 (Anthropic 모델만 사용, BFS RAG 노이즈 없음)
            # 스레드에서 실행 → 10초마다 경과 시간 표시 (블로킹 방지)
            _brief_result: list[str | None] = [None]
            _brief_done = threading.Event()
            _brief_api_key = get_anthropic_key(self.cfg) or api_key
            # ClaudeClient는 Anthropic API 전용 → chief 모델이 GPT/Gemini일 수 있으므로 항상 haiku 사용
            _BRIEF_MODEL = DEFAULT_HAIKU_MODEL

            def _run_brief():
                if not _brief_api_key:
                    self._log("[MiroFish] No API key → skipping PM brief generation")
                    _brief_done.set()
                    return
                try:
                    _brief_cli = ClaudeClient(_brief_api_key, _BRIEF_MODEL)
                    _brief_system = "유저 리서치 전문가. MiroFish 시뮬레이션용 구조화 브리프 작성."
                    _brief_result[0] = _brief_cli.complete(_brief_system, "".join(brief_prompt_parts), max_tokens=700)
                    self._log(f"[MiroFish] PM brief generated: {len(_brief_result[0] or '')} chars")
                except Exception as _e:
                    self._log(f"[MiroFish] PM brief generation exception: {_e}")
                finally:
                    _brief_done.set()

            threading.Thread(target=_run_brief, daemon=True).start()
            _brief_elapsed = 0
            _BRIEF_TIMEOUT = 50
            while not _brief_done.wait(timeout=10):
                _brief_elapsed += 10
                if think_ts:
                    try:
                        web.chat_update(channel=channel, ts=think_ts,
                                        text=f"🐟  *MiroFish*  {topic}\n_🧠 브리프 작성 중... ⏱ {_brief_elapsed}s_")
                    except Exception as _ue:
                        self._log(f"[MiroFish] chat_update failed (ignored): {_ue}")
                if _brief_elapsed >= _BRIEF_TIMEOUT:
                    self._log("[MiroFish] PM brief timeout → keeping raw context")
                    break

            brief_answer = _brief_result[0]
            if brief_answer and brief_answer.strip():
                # 원본 topic이 context 내용으로 대체되지 않도록 명시적 분리 prefix 추가
                context = f"[원본 시뮬레이션 주제: {topic}]\n\n" + brief_answer.strip()[:1150]
                self._log(f"[MiroFish] PM brief → context replaced ({len(context)} chars)")
            else:
                self._log("[MiroFish] No PM brief → keeping raw RAG context")

            # 브리프 완료 → 시뮬레이션 전환 알림 (이후 20초 동안 상태 업데이트 없는 공백 방지)
            if think_ts:
                try:
                    web.chat_update(channel=channel, ts=think_ts,
                                    text=f"🐟  *MiroFish*  {topic}\n_⚙️ 페르소나 생성 중..._")
                except Exception as _ue:
                    self._log(f"[MiroFish] chat_update failed (ignored): {_ue}")

            # ── A vs B 비교 모드 ───────────────────────────────────────────
            if is_vs_mode and vs_m:
                topic_a = vs_m.group(1).strip()
                topic_b = vs_m.group(2).strip()
                # 각 topic에서도 트리거 키워드 제거
                for pat in (MIROFISH_RE, MIRO_PERSONAS_RE, MIRO_ROUNDS_RE):
                    topic_a = pat.sub("", topic_a).strip()
                    topic_b = pat.sub("", topic_b).strip()
                topic_a = topic_a.strip(",:. ~\t\n").strip()
                topic_b = topic_b.strip(",:. ~\t\n").strip()

                if think_ts:
                    try:
                        web.chat_update(channel=channel, ts=think_ts,
                                        text=f"🐟  *A vs B 비교 시뮬레이션*\n🅰️ {topic_a}\n🅱️ {topic_b}\n_⏳ 두 시나리오 동시 실행 중..._")
                    except Exception as _ue:
                        self._log(f"[MiroFish] chat_update failed (ignored): {_ue}")

                result_a: list[dict | None] = [None]
                result_b: list[dict | None] = [None]
                err_a: list[str] = []
                err_b: list[str] = []

                def run_a():
                    try:
                        result_a[0] = mirofish_via_electron(topic_a, num_personas, num_rounds, context=context, segment=segment)
                    except Exception as _e:
                        err_a.append(str(_e))
                        self._log(f"[MiroFish A] 실패: {_e}")

                def run_b():
                    try:
                        result_b[0] = mirofish_via_electron(topic_b, num_personas, num_rounds, context=context, segment=segment)
                    except Exception as _e:
                        err_b.append(str(_e))
                        self._log(f"[MiroFish B] 실패: {_e}")

                _AB_TIMEOUT = 360  # 최대 6분 대기
                t_a = threading.Thread(target=run_a, daemon=True)
                t_b = threading.Thread(target=run_b, daemon=True)
                t_a.start(); t_b.start()
                t_a.join(timeout=_AB_TIMEOUT); t_b.join(timeout=_AB_TIMEOUT)

                # 부분 실패 처리 — 둘 다 실패 / 한쪽만 실패 구분
                if not result_a[0] and not result_b[0]:
                    _err_hint = ""
                    if err_a: _err_hint += f"\nA 오류: _{err_a[0][:80]}_"
                    if err_b: _err_hint += f"\nB 오류: _{err_b[0][:80]}_"
                    say(text=(
                        f"🐟 *A vs B 시뮬레이션 — 두 건 모두 실패*\n\n"
                        f"A: _{topic_a}_\nB: _{topic_b}_\n{_err_hint}\n\n"
                        f"*확인해주세요:*\n"
                        f"• 샌드박스 맵 앱이 실행 중인지\n"
                        f"• 이미 다른 시뮬레이션이 진행 중이라면 완료 후 재시도\n"
                        f"• `시뮬 {topic_a}` 로 개별 시뮬레이션부터 테스트"
                    ), thread_ts=thread_ts)
                    return
                if not result_a[0]:
                    _hint = f"\n_(오류: {err_a[0][:60]})_" if err_a else ""
                    say(text=(
                        f"⚠️ *A 시뮬레이션 실패 — B 결과만 표시합니다*{_hint}\n\n"
                        f"*🅱️ {topic_b}*\n{result_b[0].get('report', '')}"
                    ), thread_ts=thread_ts)
                    return
                if not result_b[0]:
                    _hint = f"\n_(오류: {err_b[0][:60]})_" if err_b else ""
                    say(text=(
                        f"⚠️ *B 시뮬레이션 실패 — A 결과만 표시합니다*{_hint}\n\n"
                        f"*🅰️ {topic_a}*\n{result_a[0].get('report', '')}"
                    ), thread_ts=thread_ts)
                    return

                rep_a = result_a[0].get("report", "")
                rep_b = result_b[0].get("report", "")

                # PM AI 비교 매트릭스 생성
                matrix_prompt = (
                    f"다음은 두 시나리오에 대한 MiroFish 유저 반응 시뮬레이션 결과야.\n\n"
                    f"**시나리오 A: {topic_a}**\n{rep_a[:2000]}\n\n"
                    f"**시나리오 B: {topic_b}**\n{rep_b[:2000]}\n\n"
                    f"두 시나리오를 비교하는 간결한 매트릭스를 작성해줘:\n"
                    f"- 핵심 차이점 3가지 (표 형식)\n"
                    f"- 어떤 시나리오가 더 긍정적 반응을 얻었는지와 이유\n"
                    f"- 최종 추천 (A/B 또는 절충안)\n"
                    f"2-3문단으로 간결하게."
                )
                matrix_answer, _ = ask_via_electron(matrix_prompt, tag="chief")
                matrix_section = f"\n\n{'─'*40}\n\n*🔍 PM 비교 분석*\n{matrix_answer.strip()}" if matrix_answer else ""

                vs_blocks = [
                    {
                        "type": "header",
                        "text": {"type": "plain_text", "text": "🐟  A vs B 비교 시뮬레이션 결과", "emoji": True},
                    },
                    {
                        "type": "section",
                        "text": {"type": "mrkdwn", "text": f"*🅰️  {topic_a}*\n{rep_a}"},
                    },
                    {"type": "divider"},
                    {
                        "type": "section",
                        "text": {"type": "mrkdwn", "text": f"*🅱️  {topic_b}*\n{rep_b}"},
                    },
                ]
                if matrix_answer:
                    vs_blocks += [
                        {"type": "divider"},
                        {
                            "type": "section",
                            "text": {"type": "mrkdwn", "text": f"*🔍  PM 비교 분석*\n{matrix_answer.strip()}"},
                        },
                    ]
                comparison_fallback = f"🐟 A vs B 비교 결과\n🅰️ {topic_a}\n🅱️ {topic_b}"
                if think_ts:
                    try:
                        web.chat_update(channel=channel, ts=think_ts, blocks=vs_blocks, text=comparison_fallback)
                    except Exception:
                        say(blocks=vs_blocks, text=comparison_fallback, thread_ts=thread_ts)
                else:
                    say(blocks=vs_blocks, text=comparison_fallback, thread_ts=thread_ts)
                return

            # ── 단일 시뮬레이션 ───────────────────────────────────────────
            result = _run_single_miro(topic, num_personas, num_rounds, context, sim_images, segment, channel, think_ts, preset_personas=preset_personas)

            # 시뮬레이션 데이터 수신 후 → Report 작성 전 중간 상태 표시
            if result and think_ts:
                try:
                    web.chat_update(
                        channel=channel, ts=think_ts,
                        text=f"🐟  *MiroFish*  {topic}  —  {len(result.get('feed', []))}개 반응 수집\n_📝 Report 작성 중..._",
                    )
                except Exception:
                    pass

            if not result:
                self._log("[MiroFish] No simulation results → failure notification")
                fail_msg = (
                    f"🐟 *MiroFish 시뮬레이션 실패*\n주제: _{topic}_\n\n"
                    f"*가능한 원인:*\n"
                    f"• 샌드박스 맵 앱이 꺼져 있거나 볼트가 로드되지 않음\n"
                    f"• 다른 시뮬레이션이 이미 진행 중 (완료 후 재시도)\n"
                    f"• 시뮬레이션 타임아웃 (복잡한 주제는 시간이 더 걸릴 수 있음)\n\n"
                    f"`시뮬 {topic}` 으로 다시 요청하거나, 앱 상태를 확인해주세요."
                )
                if think_ts:
                    try:
                        web.chat_update(channel=channel, ts=think_ts, text=fail_msg)
                    except Exception:
                        say(text=fail_msg, thread_ts=thread_ts)
                else:
                    say(text=fail_msg, thread_ts=thread_ts)
                return

            _format_and_post_miro(result, topic, num_personas, num_rounds, say, channel, thread_ts, think_ts, report_only, pm_brief=context)

        # 봇이 응답한 채널 추적 — 종료 시 "업데이트중" 메시지 전송용
        _active_channels: set[str] = set()

        def respond(text: str, say, channel: str, thread_ts: str | None = None, files: list | None = None, user_id: str | None = None):
            """채널 멘션 / DM 공통 응답 처리."""
            _active_channels.add(channel)
            tag, query = parse_msg(text)
            image_files = [f for f in (files or []) if f.get("mimetype", "").startswith("image/")]

            # 검색용 정제 쿼리: 메타 지시 표현 제거 → BM25/TF-IDF 오염 방지
            # ("Report 써줘", "분석해줘", "방향 제안해줘" 같은 요청 동사구 제거)
            # 최종 LLM 생성에는 원본 query 유지 (Report·분석 등 지시 의미가 필요)
            search_query = _clean_search_query(query)
            if search_query != query:
                self._log(f"[QueryClean] '{query[:40]}' → '{search_query[:40]}'")

            if not query and not image_files:
                say(text="무엇을 도와드릴까요?", thread_ts=thread_ts)
                return
            if not query:
                query = "이 이미지를 분석해주세요."

            # 도움말 명령
            if _re.search(r"^!도움말$|^!help$", query.strip(), _re.IGNORECASE):
                settings_data = get_electron_settings() or {}
                saved_presets = settings_data.get("presets", [])
                if saved_presets:
                    preset_lines = "  " + "  /  ".join(
                        f"`{p['name']}` ({len(p.get('personas', []))}명)" for p in saved_presets[:6]
                    )
                else:
                    preset_lines = "  _(아직 저장된 프리셋이 없어요. Strata Sync Settings > MiroFish 에서 만들 수 있어요)_"
                say(
                    blocks=[
                        {
                            "type": "header",
                            "text": {"type": "plain_text", "text": "🗺️  Strata Sync Bot", "emoji": True},
                        },
                        {
                            "type": "section",
                            "text": {
                                "type": "mrkdwn",
                                "text": "볼트에 쌓인 게임 기획 문서를 기반으로 질문에 답하고, 가상의 유저 반응을 시뮬레이션해드릴 수 있어요.",
                            },
                        },
                        {"type": "divider"},
                        {
                            "type": "section",
                            "text": {
                                "type": "mrkdwn",
                                "text": (
                                    "*💬  그냥 물어보세요*\n"
                                    "> _신규 던전 콘텐츠 기획 방향이 뭐야?_\n"
                                    "> _[아트] 이번 캐릭터 비주얼 컨셉 정리해줘_\n"
                                    "> _[기획] 이 이미지 기반으로 밸런스 의견 줘_  _(+ 이미지 첨부)_"
                                ),
                            },
                        },
                        {
                            "type": "context",
                            "elements": [{"type": "mrkdwn", "text": "태그 없으면 PM이 답변 — `[아트]` `[기획]` `[기술]` 태그로 담당자 지정 가능"}],
                        },
                        {"type": "divider"},
                        {
                            "type": "section",
                            "text": {
                                "type": "mrkdwn",
                                "text": (
                                    "*🐟  MiroFish — 유저 반응 시뮬레이션*\n"
                                    "메시지에 `시뮬레이션` 또는 `시뮬`이 포함되면 자동 실행돼요.\n\n"
                                    "`신규 캐릭터 출시 시뮬레이션`  — 기본 (5명, 3라운드)\n"
                                    "`가격 인상 발표 시뮬레이션 10명 5라운드`  — 인원/라운드 지정\n"
                                    "`PvP 업데이트 시뮬 Report`  — 피드 없이 Report만\n"
                                    "`신규 던전 코어 게이머 시뮬레이션`  — 타겟 세그먼트 지정\n"
                                    "`A vs B 시뮬레이션`  — 두 시나리오 동시 비교\n"
                                    "`... 새로 시뮬레이션`  — 30분 캐시 무시하고 새로 실행"
                                ),
                            },
                        },
                        {
                            "type": "context",
                            "elements": [{"type": "mrkdwn", "text": f"*저장된 프리셋*  {preset_lines}"}],
                        },
                        {"type": "divider"},
                        {
                            "type": "section",
                            "text": {
                                "type": "mrkdwn",
                                "text": (
                                    "*⌨️  슬래시 커맨드*\n"
                                    "`/ask 질문`  `/remember`  `/status`  `/help`\n\n"
                                    "*⚡  글로벌 단축키*\n"
                                    "`ask_strata`  — 어느 채널에서든 팝업으로 질문 입력"
                                ),
                            },
                        },
                        {
                            "type": "context",
                            "elements": [{"type": "mrkdwn", "text": "🔖 볼트 문서에 `#시뮬레이션필요` 태그 → 자동 알림   •   ⏰ Schedule 자동 실행: Settings > MiroFish"}],
                        },
                    ],
                    text="🗺️ Strata Sync Bot 사용법",
                    thread_ts=thread_ts,
                )
                return

            # MiroFish 시뮬레이션 요청 감지 → 별도 핸들러로 분기
            if MIROFISH_RE.search(query):
                _handle_mirofish(query, say, channel, thread_ts, image_files=image_files)
                return

            persona = resolve_persona(tag)
            emoji   = persona.get("emoji", "🤖")
            name    = persona.get("name", tag)

            # thinking 메시지 1개만 생성 — vision/RAG 모두 같은 ts로 업데이트
            status = "✦ Analyzing images..." if image_files else "✦ Thinking deeply..."
            thinking = say(text=f"{status}", thread_ts=thread_ts)
            think_ts = (thinking or {}).get("ts")
            progress = ProgressUpdater(
                web, channel, think_ts, name=name, emoji=emoji,
                is_electron=True, log_fn=self._log,
            ) if think_ts else None

            # 이미지가 있으면: 다운로드 → Electron에 직접 전달 (LLM이 이미지 + RAG 문서 함께 분석)
            images_payload: list[dict] = []
            if image_files:
                self._log(f"[Vision] {name}: Downloading {len(image_files)} images...")
                images_payload = _download_images(image_files)
                if images_payload:
                    self._log(f"[Vision] {len(images_payload)}개 Electron으로 전달")
                else:
                    self._log("[Vision] 0 images downloaded → falling back to text-only RAG")

            self._log(f"[Slack] {name}: {query[:60]}")

            # 명시적 이미지 요청 감지 → /images 검색
            vault_image_paths: list[str] = []
            is_img_req = any(w in query for w in _IMAGE_WORDS)
            if is_img_req:
                # Remove image/action words → keep only topic words (character names, etc.)
                img_query = query
                for w in _IMAGE_WORDS + _ACTION_WORDS:
                    img_query = img_query.replace(w, " ")
                img_query = " ".join(img_query.split()).strip("~,. !?") or query
                vault_image_paths = get_images_via_electron(img_query)
                self._log(f"[Image] Explicit search '{img_query[:40]}': {len(vault_image_paths)} results")

            # Retrieve per-thread history (DMs use channel as key)
            hist_key = f"{channel}:{thread_ts or 'dm'}"
            with _conv_history_lock:
                history = list(_conv_history.get(hist_key, []))
            if history:
                self._log(f"[Slack] History restored: {len(history)//2} turns")

            claude = None  # Overwritten in fallback, used for user memory update
            # Priority 1: Electron /ask — uses Strata Sync's BFS RAG + LLM pipeline directly
            if progress: progress.start("electron")

            # Electron HTTP 준비 확인 (3초 이내 /settings 응답)
            # TCP open but no HTTP response = restarting → immediate fallback (prevents 65s wait)
            if not is_electron_alive():
                if progress:
                    progress.set_message("🔴 Sandbox Map app is off or starting up. Processing with Python RAG...")
                self._log("[RAG] Electron HTTP not responding (offline/restarting) → fallback")
                answer, auto_image_paths = None, []
            else:
                answer, auto_image_paths = ask_via_electron(query, tag=tag, history=history, images=images_payload or None)
                if answer is None and progress:
                    # App was on but no response = building or timeout
                    progress.set_message("⏱️ 앱 응답 시간 초과. Python RAG로 처리 중...")

            if progress: progress.done("electron")
            if answer:
                self._log("[RAG] Electron /ask 성공 (BFS+LLM)")
                if auto_image_paths:
                    self._log(f"[Image] Auto images: {len(auto_image_paths)}")
                final = answer
            else:
                auto_image_paths = []
                # Fallback: Python native RAG + 10 sub-agents + Claude
                self._log("[RAG] Electron not running → sub-agent RAG")
                # Fallback path uses granular step display
                if progress:
                    progress._remaining = ["search", "analyze", "webcheck", "answer"]
                # Initialize Claude client (shared for query rewriting, multi-query, analysis)
                model = get_model_for_tag(tag)
                live_key = get_anthropic_key(self.cfg) or api_key
                claude = ClaudeClient(live_key, model) if live_key else None
                self._log(f"[모델] {model}")

                # ── Query rewriting (search optimization) ────────────────
                if claude:
                    _rewrite_sys = "질문→검색 키워드 변환. 동사·어미·조사 제거, 핵심 명사 중심, 20자 이내. 쿼리만 출력."
                    try:
                        _rewritten = claude.complete(_rewrite_sys, search_query, max_tokens=40).strip()
                        if _rewritten and 3 < len(_rewritten) < 80:
                            self._log(f"[QueryRewrite] '{search_query[:40]}' → '{_rewritten[:40]}'")
                            search_query = _rewritten
                    except Exception as _e:
                        self._log(f"[QueryRewrite] 실패 (무시): {_e}")

                # Sub-agents analyze up to 10 docs, so search top_n*2
                fetch_n = max(top_n * 2, 10)
                if progress: progress.start("search")
                results = search_via_electron(search_query, top_n=fetch_n)
                if results is None:
                    results = search_vault(search_query, vault_path, top_n=fetch_n)
                    self._log(f"[RAG] simple search ({len(results)}건)")
                else:
                    self._log(f"[RAG] Electron TF-IDF ({len(results)}건)")

                # 쿼리에 "최신/최근/올해 연도" 가 있으면 날짜 기준 부스팅
                # BM25 doesn't know dates, so boost recent docs even if content is short
                _cur_year = str(datetime.now().year)
                _prev_year = str(datetime.now().year - 1)
                if results and any(w in query for w in ["최신", "최근", _cur_year]):
                    for r in results:
                        d = r.get("date", "")
                        r["_date_boost"] = 2 if _cur_year in d else (1 if _prev_year in d else 0)
                    results.sort(key=lambda r: (-r["_date_boost"], -r.get("score", 0)))
                    self._log(f"[RAG] Latest request → date boosting applied (top: {results[0].get('date','')})")

                # ── Multi-query decomposition (complex question → sub-query merge + early convergence stop) ──
                if claude and results and len(query) > 25:
                    _decomp_sys = "Decompose the question into 2 independent search queries, newline separated, max 10 chars each. Return empty for simple questions."
                    try:
                        _sub_raw = claude.complete(_decomp_sys, query, max_tokens=60).strip()
                        _sub_queries = [
                            q.strip() for q in _sub_raw.split("\n")
                            if q.strip() and 2 < len(q.strip()) < 60
                        ]
                        if len(_sub_queries) >= 2:
                            self._log(f"[MultiQuery] Decomposed: {_sub_queries}")
                            _seen_stems = {r.get("stem") for r in results}
                            _zero_gain_rounds = 0  # 수렴 조기 종료 카운터
                            for _sq in _sub_queries:
                                _prev_count = len(_seen_stems)
                                _sub_res = search_via_electron(_sq, top_n=5) or search_vault(_sq, vault_path, top_n=5)
                                for _r in (_sub_res or []):
                                    if _r.get("stem") not in _seen_stems:
                                        results.append(_r)
                                        _seen_stems.add(_r.get("stem"))
                                # Convergence check: increment counter if no new docs → early stop after 2 consecutive
                                if len(_seen_stems) == _prev_count:
                                    _zero_gain_rounds += 1
                                    if _zero_gain_rounds >= 2:
                                        self._log("[MultiQuery] Convergence detected → early stop")
                                        break
                                else:
                                    _zero_gain_rounds = 0
                            self._log(f"[MultiQuery] 병합 후 {len(results)}건")
                    except Exception as _e:
                        self._log(f"[MultiQuery] 실패 (무시): {_e}")

                # ── Hot score reranking (based on OpenViking memory_lifecycle) ──
                # Give bonus to frequently/recently referenced docs for reranking
                if results:
                    results = apply_hotness_rerank(results)
                    self._log(f"[HotScore] Reranking complete (top: {results[0].get('title','')[:30]})")

                if progress: progress.done("search")

                # ── 비용 제어 설정 읽기 ──────────────────────────────────
                _cost_settings = get_electron_settings() or {}
                _self_review_enabled = _cost_settings.get("selfReview", True)
                _n_agents = int(_cost_settings.get("nAgents", 6))

                # ── Sub-agent document analysis ──────────────────────────
                if progress: progress.start("analyze")
                if claude and results:
                    rag_context = build_multi_agent_context(
                        claude, search_query, results, n_agents=_n_agents, log_fn=self._log
                    )
                else:
                    rag_context = build_rag_context(results, max_chars=6000)
                if progress: progress.done("analyze")

                # ── 웹 검색: AI가 스스로 필요 판단 ─────────────────────
                # Claude decides whether web search is needed first (when vault results insufficient or latest info needed)
                web_ctx = ""
                if progress: progress.start("webcheck")
                if claude:
                    decision_sys = 'If vault documents can sufficiently answer, NO. If external latest info is needed, YES. Format: "NO" or "YES: <search query>"'
                    decision_msg = (
                        f"질문: {search_query}\n\n"
                        f"볼트 자료 (앞부분):\n{rag_context[:600] if rag_context else '(없음)'}\n\n"
                        "웹 검색 필요 여부:"
                    )
                    try:
                        decision = claude.complete(
                            decision_sys,
                            decision_msg,
                            max_tokens=30,
                        ).strip()
                        if decision.upper().startswith("YES"):
                            colon_idx = decision.find(":")
                            search_q = decision[colon_idx+1:].strip() if colon_idx >= 0 else query
                            self._log(f"[WebSearch] Main agent decision: searching \"{search_q}\"...")
                            if progress: progress.done("webcheck"); progress.start("websearch")
                            web_results = search_web(search_q or query, max_results=5)
                            if web_results:
                                web_ctx = build_web_context(web_results)
                                self._log(f"[WebSearch] {len(web_results)}건 확보")
                            else:
                                self._log("[WebSearch] 결과 없음")
                        else:
                            self._log("[WebSearch] Main agent judgment: vault info sufficient → skip")
                            if progress: progress.done("webcheck")
                    except Exception as e:
                        self._log(f"[WebSearch 판단] 오류: {e} → 스킵")
                        if progress: progress.done("webcheck")

                # ── 최종 답변 생성 ────────────────────────────────────────
                if progress:
                    if progress._current_key == "websearch":
                        progress.done("websearch")
                    progress.start("answer")
                if claude:
                    today_str = datetime.now().strftime("%Y년 %m월 %d일 (%a)")
                    combined = f"오늘 날짜: {today_str}\n\n" + persona["system"]
                    # 사용자 기억 주입
                    if user_id and _user_memory.get(user_id):
                        combined += f"\n\n---\n## 📌 Previous Conversation Memory with This User\n{_user_memory[user_id]}\n---"
                    if rag_context:
                        combined += f"\n\n{rag_context}"
                    if web_ctx:
                        combined += f"\n\n{web_ctx}"
                    # Per-persona analysis frame
                    _PERSONA_ANALYSIS_FRAMES = {
                        "chief": (
                            "[PM Analysis Perspective] 1. Project direction/goal alignment "
                            "2. Resource/schedule/priority feasibility 3. Key risks and mitigation"
                        ),
                        "art": (
                            "[Art Analysis Perspective] 1. Style/visual consistency/tone impact "
                            "2. Player visual messaging and emotion 3. Technical feasibility vs quality balance"
                        ),
                        "spec": (
                            "[Design Analysis Perspective] 1. Balance/player experience/fun factor impact "
                            "2. Existing system integration/dependencies 3. User intuitiveness and plausibility"
                        ),
                        "tech": (
                            "[기술 분석 관점] ① 기술 부채·성능·확장성 영향 "
                            "2. Implementation complexity and testability 3. Existing codebase compatibility"
                        ),
                    }
                    if tag in _PERSONA_ANALYSIS_FRAMES:
                        combined += f"\n\n{_PERSONA_ANALYSIS_FRAMES[tag]}"
                    combined += (
                        "\n\n[답변 지침]\n"
                        "• Thinking order: Identify core intent → Verify document evidence → Derive insights → Explicitly mark uncertain content\n"
                        "• When documents conflict: Explicitly point out and recommend checking latest version\n"
                        "• Tone: Always professional and polite\n"
                        "• Factual compliance: Based only on vault documents, web results, and user statements. Explicitly state 'Not confirmed in searched documents' for unverified content. Refer to sources as 'vault documents' or 'searched documents'."
                    )
                    try:
                        answer = claude.complete(combined, query, max_tokens=2000, cache_system=True)
                        # ── 2-pass self-review (ON/OFF via selfReview setting) ──
                        if _self_review_enabled:
                            _review_sys = (
                                "Review whether [Answer] sufficiently covers [Question].\n"
                                "If key perspectives are missing, add to [Supplement]. If sufficient, output only [FinalAnswer].\n"
                                "Format: [FinalAnswer]\\n(content)\\n\\n[Supplement]\\n(content, omit if none)"
                            )
                            _reviewed = claude.complete(
                                _review_sys,
                                f"[질문]\n{query}\n\n[답변]\n{answer}",
                                max_tokens=2500,
                            ).strip()
                            if "[최종답변]" in _reviewed:
                                _main = _reviewed.split("[최종답변]", 1)[1]
                                _supplement = ""
                                if "[보완]" in _main:
                                    _main, _supplement = _main.split("[보완]", 1)
                                _main = _main.strip()
                                _supplement = _supplement.strip()
                                if _main:
                                    answer = _main
                                    if _supplement:
                                        answer += f"\n\n---\n*💡 추가 관점*\n{_supplement}"
                                    self._log("[2-pass] 자기 검토 적용")
                    except Exception as e:
                        _err_str = str(e)
                        if "529" in _err_str or "overloaded" in _err_str.lower():
                            answer = "❌ *Claude API 과부하 상태입니다.* 잠시 후 다시 시도해주세요."
                        elif "401" in _err_str or "authentication" in _err_str.lower():
                            answer = "❌ *Claude API 키 인증 실패.* 설정에서 API 키를 확인해주세요."
                        elif "402" in _err_str or "credit" in _err_str.lower() or "insufficient" in _err_str.lower():
                            answer = "❌ *Claude API 크레딧이 부족합니다.* 잔액을 충전해주세요."
                        elif "timeout" in _err_str.lower():
                            answer = "❌ *응답 시간이 초과되었습니다.* 질문을 짧게 줄여서 다시 시도해주세요."
                        else:
                            answer = f"❌ *AI 응답 중 오류가 발생했습니다.*\n_(오류 코드: {type(e).__name__})_\n잠시 후 다시 시도해주세요."
                        self._log(f"[Claude] 응답 오류: {e}")
                elif rag_context:
                    answer = (
                        "_(Claude API 키가 설정되어 있지 않아 AI 분석 없이 원문만 표시합니다.)_\n\n"
                        + rag_context
                    )
                else:
                    answer = (
                        "_볼트에서 관련 문서를 찾지 못했어요._\n\n"
                        "• 다른 키워드로 다시 질문해보세요\n"
                        "• 볼트 동기화가 완료됐는지 확인해주세요\n"
                        "• `!도움말` 로 사용법을 확인할 수 있어요"
                    )

                if progress: progress.done("answer")
                # 참조된 문서 접근 기록 → HotScore 학습
                if results and not answer.startswith("❌"):
                    record_doc_access([r.get("stem", "") for r in results[:5]])
                sources = ""
                if results:
                    lines = []
                    for r in results[:3]:
                        display = r.get('title') or r.get('stem', '')
                        date_str = r.get('date', '')
                        snippet = (r.get('body') or '')[:80].replace('\n', ' ').strip()
                        snippet_str = f"\n  _↳ {snippet}..._" if snippet else ""
                        date_part = f"  _{date_str}_" if date_str else ""
                        lines.append(f"• `{display}`{date_part}{snippet_str}")
                    sources = "\n\n_───────────────────_\n📂 *참고 문서*\n" + "\n".join(lines)
                final = f"{answer}{sources}"

            # 히스토리 업데이트 (최대 20턴 = 40 메시지 보존)
            updated_history = (history + [
                {"role": "user", "content": query},
                {"role": "assistant", "content": answer or ""},
            ])[-40:]
            with _conv_history_lock:
                _conv_history[hist_key] = updated_history
                # 오래된 키 정리 (메모리 누수 방지)
                if len(_conv_history) > _MAX_HISTORY_KEYS:
                    for old_key in list(_conv_history)[:len(_conv_history) - _MAX_HISTORY_KEYS]:
                        del _conv_history[old_key]
            # 사용자 기억 자동 갱신 (5턴마다)
            if user_id:
                _auto_update_memory(user_id, updated_history, claude)

            ts = (thinking or {}).get("ts")
            if ts:
                try:
                    web.chat_update(channel=channel, ts=ts, text=final)
                except Exception:
                    say(text=final, thread_ts=thread_ts)
            else:
                say(text=final, thread_ts=thread_ts)

            # 이미지 업로드 (명시적 검색 결과 우선, 없으면 자동 수집 이미지)
            all_image_paths = vault_image_paths or auto_image_paths
            if all_image_paths:
                _upload_images_to_slack(all_image_paths, channel, thread_ts)

            # ── Report 인텐트 → PDF 비동기 생성 + Slack 업로드 ─────────────────
            if REPORT_INTENT_RE.search(query) and answer and not answer.startswith("❌"):
                import threading as _threading
                def _async_report_pdf():
                    try:
                        title_m = _re.search(r'["\u300c\u300e\u201c](.+?)["\u300d\u300f\u201d]', query)
                        report_title = title_m.group(1) if title_m else (query[:40].strip() or "Report")
                        html_path = _generate_report_html(report_title, answer)
                        try:
                            import pdfkit as _pdfkit
                            _WKHTMLTOPDF = cfg.get("wkhtmltopdf_path", r"C:\Program Files (x86)\wkhtmltopdf\bin\wkhtmltopdf.exe")
                            pdf_path = html_path.with_suffix(".pdf")
                            _pdfkit.from_file(
                                str(html_path), str(pdf_path),
                                configuration=_pdfkit.configuration(wkhtmltopdf=_WKHTMLTOPDF),
                                options={"encoding": "UTF-8", "quiet": ""},
                            )
                            self._log(f"[Report] PDF 변환 완료: {pdf_path.name}")
                            upload_path = pdf_path
                        except Exception as _pdf_e:
                            self._log(f"[Report] PDF 변환 실패 ({type(_pdf_e).__name__}: {_pdf_e}) → HTML 업로드")
                            upload_path = html_path
                        _upload_file_to_slack(upload_path, channel, thread_ts, title=f"📄 {report_title}")
                    except Exception as _e:
                        self._log(f"[Report] PDF 생성 실패: {_e}")
                _threading.Thread(target=_async_report_pdf, daemon=True).start()

        @app.event("app_home_opened")
        def handle_home(event, client, logger):
            user_id = event.get("user")
            try:
                client.views_publish(
                    user_id=user_id,
                    view={
                        "type": "home",
                        "blocks": [
                            {
                                "type": "header",
                                "text": {"type": "plain_text", "text": "🗺️  Strata Sync Bot", "emoji": True},
                            },
                            {
                                "type": "section",
                                "text": {
                                    "type": "mrkdwn",
                                    "text": "볼트 기반 RAG 어시스턴트입니다.\n채널에서 *@Strata* 를 멘션하거나, *메시지 탭*에서 직접 질문하세요.",
                                },
                            },
                            {"type": "divider"},
                            {
                                "type": "section",
                                "fields": [
                                    {
                                        "type": "mrkdwn",
                                        "text": "*💬  질문하기*\n`질문` — Chief Director 답변\n`[아트] 질문` — 페르소나 지정\n이미지 첨부 — Vision 분석 지원",
                                    },
                                    {
                                        "type": "mrkdwn",
                                        "text": "*⌨️  커맨드*\n`/ask 질문`\n`/remember`\n`/status`\n`/help`",
                                    },
                                ],
                            },
                            {"type": "divider"},
                            {
                                "type": "context",
                                "elements": [
                                    {"type": "mrkdwn", "text": "*페르소나 태그*  `[감독]`  `[아트]`  `[기획]`  `[기술]`   •   ⚡ `ask_strata` 단축키로 어디서든 바로 질문"},
                                ],
                            },
                        ],
                    },
                )
            except Exception as e:
                logger.error(f"[Home] views.publish 실패: {e}")

        @app.event("app_mention")
        def handle_mention(event, say, logger):
            files = extract_slack_files(event)
            logger.debug(f"[mention] subtype={event.get('subtype')!r} files={bool(files)} text={event.get('text','')[:40]!r}")
            respond(
                text=event.get("text", ""),
                say=say,
                channel=event["channel"],
                thread_ts=event.get("thread_ts") or event.get("ts"),
                files=files,
                user_id=event.get("user"),
            )

        @app.event("message")
        def handle_dm(event, say, logger):
            # DM(im) 또는 그룹 DM(mpim)만 처리, 봇 자신의 메시지 제외
            if event.get("channel_type") not in ("im", "mpim"):
                return
            subtype = event.get("subtype")
            if event.get("bot_id") or (subtype and subtype != "file_share"):
                return
            files = extract_slack_files(event)
            logger.debug(f"[dm] subtype={subtype!r} files={bool(files)} text={event.get('text','')[:40]!r}")
            respond(
                text=event.get("text", ""),
                say=say,
                channel=event["channel"],
                thread_ts=None,  # DM은 스레드 없이 바로 답변
                files=files,
                user_id=event.get("user"),
            )

        # ── 슬래시 커맨드 ────────────────────────────────────────────────────
        HELP_BLOCKS = [
            {
                "type": "header",
                "text": {"type": "plain_text", "text": "🗺️  Strata Sync Bot 사용법", "emoji": True},
            },
            {
                "type": "section",
                "fields": [
                    {
                        "type": "mrkdwn",
                        "text": "*채널 멘션*\n`@Strata 질문` — 스레드에 답변\n`@Strata [아트] 질문` — 페르소나 지정",
                    },
                    {
                        "type": "mrkdwn",
                        "text": "*DM / 메시지 탭*\n직접 입력 — Chief Director 답변\n이미지 첨부 — Vision 분석 지원",
                    },
                ],
            },
            {"type": "divider"},
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": (
                        "*⌨️  슬래시 커맨드*\n"
                        "`/ask 질문`  — RAG 기반 답변\n"
                        "`/remember`  — 대화 내용 기억 저장\n"
                        "`/status`  — 봇 상태·볼트 정보\n"
                        "`/help`  — 이 도움말\n\n"
                        "*⚡  글로벌 단축키*\n"
                        "`ask_strata`  — 어느 채널에서든 팝업으로 질문"
                    ),
                },
            },
            {
                "type": "context",
                "elements": [{"type": "mrkdwn", "text": "*페르소나 태그*  `[감독]`  `[아트]`  `[기획]`  `[기술]`"}],
            },
        ]
        HELP_TEXT = "*🗺️ Strata Sync Bot 사용법*\n`/ask 질문`  `/remember`  `/status`  `/help`"

        @app.command("/help")
        def handle_slash_help(ack, respond, logger):
            ack()
            try:
                respond(blocks=HELP_BLOCKS, text=HELP_TEXT)
            except Exception as e:
                logger.error(f"[/help] 응답 실패: {e}")

        @app.command("/ask")
        def handle_slash_ask(ack, respond, command, logger):
            ack()
            text = command.get("text", "").strip()
            if not text:
                respond(text="질문 내용을 입력해주세요.\n사용법: `/ask 질문 내용`")
                return
            user_id = command.get("user_id")
            channel_id = command.get("channel_id")
            try:
                # respond()는 ephemeral이므로 처리 중 알림 후 실제 답변은 say로 전송
                respond(text=f"_{text}_ 처리 중입니다…")
                import _threading
                def _async_ask():
                    class _FakeSay:
                        def __call__(self, text="", blocks=None, thread_ts=None, **kw):
                            try:
                                kargs = {"channel": channel_id, "text": text}
                                if blocks:
                                    kargs["blocks"] = blocks
                                if thread_ts:
                                    kargs["thread_ts"] = thread_ts
                                app.client.chat_postMessage(**kargs)
                            except Exception as _e:
                                logger.error(f"[/ask say] {_e}")
                    respond_fn = _FakeSay()
                    respond(
                        text=text,
                        say=respond_fn,
                        channel=channel_id,
                        thread_ts=None,
                        files=[],
                        user_id=user_id,
                    )
                import threading as _threading
                _threading.Thread(target=_async_ask, daemon=True).start()
            except Exception as e:
                logger.error(f"[/ask] 처리 실패: {e}")
                respond(text=f"처리 중 오류가 발생했습니다: {e}")

        @app.command("/remember")
        def handle_slash_remember(ack, respond, command, logger):
            """현재 DM/스레드 대화 내용을 사용자 기억에 저장."""
            ack()
            user_id = command.get("user_id")
            channel_id = command.get("channel_id")
            hist_key = f"{channel_id}:dm"
            with _conv_history_lock:
                history = list(_conv_history.get(hist_key, []))
            if len(history) < 4:
                respond(text="💭 저장할 대화 내용이 충분하지 않아요. 먼저 몇 가지 질문을 해주세요!")
                return
            try:
                respond(text="💭 대화 내용을 기억에 저장하는 중...")
                live_key = get_anthropic_key(self.cfg) or api_key
                if not live_key:
                    respond(text="❌ API 키가 설정되어 있지 않아 기억을 저장할 수 없어요.")
                    return
                model = get_model_for_tag("chief")
                claude_mem = ClaudeClient(live_key, model)
                existing = _user_memory.get(user_id, "")
                hist_text = "\n".join(
                    f"{'👤' if m['role'] == 'user' else '🤖'} {m['content'][:200]}"
                    for m in history[-10:]
                )
                summary_prompt = "아래 대화를 300자 이내로 핵심 결정사항·합의·중요 컨텍스트 중심으로 요약하세요. 요약만 출력."
                if existing:
                    summary_prompt += f"\n\n기존 기억:\n{existing}"
                summary = claude_mem.complete(summary_prompt, f"대화:\n{hist_text}", max_tokens=400).strip()
                if summary:
                    _user_memory[user_id] = summary
                    _save_user_memory()
                    respond(text=f"✅ *대화 내용을 기억했어요!*\n\n_{summary}_")
                else:
                    respond(text="⚠️ 기억 생성에 실패했어요. 잠시 후 다시 시도해주세요.")
            except Exception as e:
                logger.error(f"[/remember] 실패: {e}")
                respond(text=f"❌ 기억 저장 중 오류: {e}")

        @app.command("/status")
        def handle_slash_status(ack, respond, logger):
            """봇 상태 및 볼트 정보 표시."""
            ack()
            try:
                electron_str = "🟢 온라인" if is_electron_alive() else "🔴 오프라인"
                settings_data = get_electron_settings() or {}
                chief_model = settings_data.get("personaModels", {}).get("chief_director", "—")
                vault_name = Path(vault_path).name if vault_path else "—"
                doc_count = "—"
                try:
                    doc_count = str(len(scan_vault(vault_path)))
                except Exception:
                    pass
                with _conv_history_lock:
                    active_threads = len(_conv_history)
                mem_users = len(_user_memory)
                respond(
                    blocks=[
                        {
                            "type": "header",
                            "text": {"type": "plain_text", "text": "🗺️  Strata Sync Bot 상태", "emoji": True},
                        },
                        {
                            "type": "section",
                            "fields": [
                                {"type": "mrkdwn", "text": f"*앱 연결*\n{electron_str}"},
                                {"type": "mrkdwn", "text": f"*AI 모델*\n`{chief_model}`"},
                                {"type": "mrkdwn", "text": f"*볼트*\n`{vault_name}`  _{doc_count}개 문서_"},
                                {"type": "mrkdwn", "text": f"*활성 대화*\n{active_threads}개 스레드"},
                            ],
                        },
                        {
                            "type": "context",
                            "elements": [{"type": "mrkdwn", "text": f"기억 저장 {mem_users}명 사용자"}],
                        },
                    ],
                    text=f"앱: {electron_str} | 볼트: {vault_name} ({doc_count}개 문서) | 모델: {chief_model}",
                )
            except Exception as e:
                logger.error(f"[/status] 실패: {e}")
                respond(text=f"❌ 상태 조회 중 오류: {e}")

        # ── 글로벌 Shortcut ─────────────────────────────────────────────────
        # Slack 앱 설정 > Interactivity & Shortcuts 에서 callback_id "ask_strata" 로 등록 필요
        @app.shortcut("ask_strata")
        def handle_shortcut_ask(ack, shortcut, client, logger):
            """⚡ 글로벌 단축키 — 어느 채널에서든 봇에게 질문하는 모달 팝업."""
            ack()
            try:
                client.views_open(
                    trigger_id=shortcut["trigger_id"],
                    view={
                        "type": "modal",
                        "callback_id": "strata_ask_modal",
                        "title": {"type": "plain_text", "text": "Strata Sync에게 질문"},
                        "submit": {"type": "plain_text", "text": "질문하기"},
                        "close":  {"type": "plain_text", "text": "취소"},
                        "blocks": [
                            {
                                "type": "input",
                                "block_id": "persona_block",
                                "optional": True,
                                "label": {"type": "plain_text", "text": "담당 페르소나"},
                                "element": {
                                    "type": "static_select",
                                    "action_id": "persona_select",
                                    "placeholder": {"type": "plain_text", "text": "선택 (기본: 감독 PM)"},
                                    "initial_option": {"text": {"type": "plain_text", "text": "🎯 감독 (PM)"}, "value": "chief"},
                                    "options": [
                                        {"text": {"type": "plain_text", "text": "🎯 감독 (PM)"},       "value": "chief"},
                                        {"text": {"type": "plain_text", "text": "🎨 아트 디렉터"},     "value": "art"},
                                        {"text": {"type": "plain_text", "text": "📋 기획자"},           "value": "spec"},
                                        {"text": {"type": "plain_text", "text": "💻 기술 디렉터"},     "value": "tech"},
                                    ],
                                },
                            },
                            {
                                "type": "input",
                                "block_id": "question_block",
                                "label": {"type": "plain_text", "text": "질문 내용"},
                                "element": {
                                    "type": "plain_text_input",
                                    "action_id": "question_input",
                                    "multiline": True,
                                    "placeholder": {"type": "plain_text", "text": "질문을 입력하세요…"},
                                },
                            },
                        ],
                    },
                )
            except Exception as e:
                logger.error(f"[shortcut/ask_strata] views_open 실패: {e}")

        @app.view("strata_ask_modal")
        def handle_modal_submit(ack, body, client, logger):
            """모달 제출 → DM 채널로 질문 처리."""
            ack()
            values  = body["view"]["state"]["values"]
            user_id = body["user"]["id"]
            persona_opt = (
                values.get("persona_block", {})
                      .get("persona_select", {})
                      .get("selected_option") or {}
            )
            persona_val = persona_opt.get("value", "chief")
            question = (
                values.get("question_block", {})
                      .get("question_input", {})
                      .get("value", "")
                      .strip()
            )
            if not question:
                return
            tag_map = {"chief": "[감독]", "art": "[아트]", "spec": "[기획]", "tech": "[기술]"}
            full_text = f"{tag_map.get(persona_val, '')} {question}".strip()
            try:
                dm_resp    = client.conversations_open(users=user_id)
                dm_channel = dm_resp["channel"]["id"]

                class _FakeSay:
                    def __call__(self_, text="", blocks=None, thread_ts=None, **kw):  # noqa: N805
                        try:
                            kargs: dict = {"channel": dm_channel, "text": text}
                            if blocks:    kargs["blocks"]    = blocks
                            if thread_ts: kargs["thread_ts"] = thread_ts
                            app.client.chat_postMessage(**kargs)
                        except Exception as _e:
                            logger.error(f"[modal/say] {_e}")

                import threading as _threading
                _threading.Thread(
                    target=respond,
                    kwargs=dict(text=full_text, say=_FakeSay(), channel=dm_channel,
                                thread_ts=None, files=[], user_id=user_id),
                    daemon=True,
                ).start()
            except Exception as e:
                logger.error(f"[modal/submit] 처리 실패: {e}")

        self._handler = SocketModeHandler(app, app_token)

        # ── Schedule 체크 스레드 ───────────────────────────────────────────────
        _sched_fired: set[str] = set()  # "YYYY-MM-DD HH:MM" 중복 실행 방지

        def _schedule_checker():
            """매 30초마다 scheduledTopics 체크. 현재 시각과 일치하면 시뮬레이션 자동 실행."""
            notify_channel = cfg.get("slack_notify_channel", "").strip()
            if not notify_channel:
                return  # 알림 채널 미설정 시 스킵
            while self._handler and self._handler.client and self._handler.client.is_connected():
                try:
                    settings = get_electron_settings(timeout=2.0) or {}
                    topics = settings.get("scheduledTopics", [])
                    now = datetime.now()
                    now_hm = now.strftime("%H:%M")
                    fire_key_prefix = now.strftime("%Y-%m-%d ")

                    for sched in topics:
                        if not sched.get("enabled"):
                            continue
                        sched_time = sched.get("time", "")
                        if sched_time != now_hm:
                            continue
                        fire_key = fire_key_prefix + sched_time + sched.get("topic", "")
                        if fire_key in _sched_fired:
                            continue

                        _sched_fired.add(fire_key)
                        # 오래된 키 정리
                        if len(_sched_fired) > 200:
                            oldest = sorted(_sched_fired)[:100]
                            for k in oldest:
                                _sched_fired.discard(k)

                        sched_topic = sched.get("topic", "").strip()
                        sched_np    = max(3, min(50, int(sched.get("numPersonas", 5))))
                        sched_nr    = max(2, min(10, int(sched.get("numRounds", 3))))
                        self._log(f"[Schedule] 자동 실행: '{sched_topic}' {sched_np}명 {sched_nr}라운드")

                        def _run_sched(t=sched_topic, np=sched_np, nr=sched_nr):
                            try:
                                thinking = web.chat_postMessage(
                                    channel=notify_channel,
                                    text=f"🐟 *[자동 Schedule] MiroFish 시뮬레이션 시작*\n주제: _{t}_\n페르소나: {np}명 | 라운드: {nr}회\n\n_⏳ 실행 중..._",
                                )
                                think_ts = (thinking or {}).get("ts")
                                context_s: str | None = None
                                rag_docs_s = search_via_electron(t, top_n=3)
                                if rag_docs_s:
                                    ctx_parts_s = [
                                        f"### {d.get('title') or d.get('filename','')}\n{(d.get('body',''))[:600]}"
                                        for d in rag_docs_s if d.get("body")
                                    ]
                                    if ctx_parts_s:
                                        context_s = "\n\n".join(ctx_parts_s)
                                result_s = _run_single_miro(t, np, nr, context_s, None, None, notify_channel, think_ts)
                                if result_s:
                                    _format_and_post_miro(result_s, t, np, nr,
                                                          lambda **kw: web.chat_postMessage(channel=notify_channel, **kw),
                                                          notify_channel, None, think_ts, False, pm_brief=context_s)
                                else:
                                    if think_ts:
                                        try:
                                            web.chat_update(channel=notify_channel, ts=think_ts,
                                                            text=f"🐟 [자동 Schedule] 시뮬레이션 실패: _{t}_")
                                        except Exception as _ue:
                                            self._log(f"[Schedule] chat_update failed (ignored): {_ue}")
                            except Exception as e:
                                self._log(f"[Schedule] 실행 오류: {e}")

                        threading.Thread(target=_run_sched, daemon=True).start()

                except Exception as e:
                    self._log(f"[Schedule] 체크 오류: {e}")
                time.sleep(30)

        # ── 볼트 #시뮬레이션필요 태그 감지 스레드 ───────────────────────────
        _sim_needed_notified: set[str] = set()  # 이미 알림 보낸 파일명

        def _vault_tag_scanner():
            """20분마다 볼트에서 #시뮬레이션필요 태그 포함 파일 스캔 후 Slack 알림."""
            notify_channel = cfg.get("slack_notify_channel", "").strip()
            if not notify_channel:
                return
            scan_vault_path = Path(vault_path)
            time.sleep(60)  # 봇 시작 1분 후부터 스캔
            while self._handler and self._handler.client and self._handler.client.is_connected():
                try:
                    found = []
                    for md_file in scan_vault_path.rglob("*.md"):
                        try:
                            text = md_file.read_text(encoding="utf-8", errors="ignore")
                            if "#시뮬레이션필요" in text and md_file.name not in _sim_needed_notified:
                                found.append(md_file.name)
                                _sim_needed_notified.add(md_file.name)
                        except Exception:
                            pass
                    if found:
                        items = "\n".join(f"• `{f}`" for f in found[:10])
                        web.chat_postMessage(
                            channel=notify_channel,
                            text=(
                                f"🔖 *#시뮬레이션필요 태그 감지*\n"
                                f"아래 문서에 시뮬레이션 검토 태그가 붙어 있습니다:\n{items}\n\n"
                                f"💡 `🐟 <주제>` 로 시뮬레이션을 시작하세요."
                            ),
                        )
                        self._log(f"[TagScan] #시뮬레이션필요 {len(found)}건 감지")
                except Exception as e:
                    self._log(f"[TagScan] 오류: {e}")
                time.sleep(1200)  # 20분 주기

        def _notify_disconnect():
            """봇 종료 시 활성 채널에 '업데이트중' 메시지 전송."""
            for ch in _active_channels:
                try:
                    web.chat_postMessage(channel=ch, text="🔄 _봇이 업데이트 중입니다. 잠시 후 다시 시도해주세요._")
                except Exception:
                    pass  # 이미 소켓이 끊긴 경우 무시 (REST API는 별도 연결이므로 대부분 성공)

        def _run():
            try:
                self._handler.connect()   # signal 등록 없이 WebSocket만 연결 (비-메인 스레드 호환)
                # 백그라운드 서비스 스레드 시작
                threading.Thread(target=_schedule_checker, daemon=True).start()
                threading.Thread(target=_vault_tag_scanner, daemon=True).start()
                while self._handler.client and self._handler.client.is_connected():
                    time.sleep(1)
            except Exception as e:
                self._log(f"❌ Slack 봇 종료: {e}")
            finally:
                _notify_disconnect()
                self._on_status(False)

        self._thread = threading.Thread(target=_run, daemon=True)
        self._thread.start()
        self._log("🟢 Slack bot started — model: follows Strata Sync persona settings")
        return True

    def stop(self):
        if self._handler:
            try:
                self._handler.close()
            except Exception:
                pass
        self._handler = None
        self._log("🔴 Slack 봇 중지")


# ─────────────────────────────────────────────────────────────────────────────
# Tkinter GUI
# ─────────────────────────────────────────────────────────────────────────────

class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Strata Sync Source Management Bot")
        self.geometry("720x640")
        self.resizable(True, True)
        self.cfg = load_config()
        self.bot: VaultBot | None = None
        self.timer_running = False
        self._next_run_time: datetime | None = None
        self._slack_runner: SlackBotRunner | None = None
        self._build_ui()
        self._load_cfg_to_ui()
        self._tick()  # 타이머 카운트다운 업데이트

    # ── UI 빌드 ───────────────────────────────────────────────────────────────

    def _build_ui(self):
        pad = {"padx": 8, "pady": 4}

        # ── 상단: 설정 패널 ──────────────────────────────────────────────────
        frame_cfg = ttk.LabelFrame(self, text="설정", padding=8)
        frame_cfg.pack(fill="x", padx=10, pady=(10, 4))

        # 볼트 경로
        ttk.Label(frame_cfg, text="볼트 경로:").grid(row=0, column=0, sticky="w", **pad)
        self.var_vault = tk.StringVar()
        ttk.Entry(frame_cfg, textvariable=self.var_vault, width=52).grid(row=0, column=1, sticky="ew", padx=4)
        ttk.Button(frame_cfg, text="찾기", command=self._browse_vault, width=6).grid(row=0, column=2, padx=4)

        # API Key
        ttk.Label(frame_cfg, text="Claude API Key:").grid(row=1, column=0, sticky="w", **pad)
        self.var_key = tk.StringVar()
        ttk.Entry(frame_cfg, textvariable=self.var_key, show="*", width=52).grid(row=1, column=1, sticky="ew", padx=4)

        # 실행 주기
        ttk.Label(frame_cfg, text="실행 주기:").grid(row=2, column=0, sticky="w", **pad)
        interval_frame = ttk.Frame(frame_cfg)
        interval_frame.grid(row=2, column=1, sticky="w")
        self.var_interval = tk.IntVar(value=1)
        for label, val in [("1시간", 1), ("5시간", 5), ("수동", 0)]:
            ttk.Radiobutton(
                interval_frame, text=label, variable=self.var_interval, value=val
            ).pack(side="left", padx=6)

        ttk.Button(frame_cfg, text="저장", command=self._save_cfg, width=6).grid(row=2, column=2, padx=4)
        frame_cfg.columnconfigure(1, weight=1)

        # ── 중단: 실행 제어 ──────────────────────────────────────────────────
        frame_ctrl = ttk.Frame(self)
        frame_ctrl.pack(fill="x", padx=10, pady=4)

        self.btn_run = ttk.Button(frame_ctrl, text="▶ 지금 실행", command=self._run_now, width=14)
        self.btn_run.pack(side="left", padx=4)

        self.btn_timer = ttk.Button(frame_ctrl, text="⏱ 타이머 시작", command=self._toggle_timer, width=14)
        self.btn_timer.pack(side="left", padx=4)

        self.lbl_status = ttk.Label(frame_ctrl, text="상태: 대기", foreground="gray")
        self.lbl_status.pack(side="left", padx=12)

        self.lbl_next = ttk.Label(frame_ctrl, text="", foreground="steelblue")
        self.lbl_next.pack(side="right", padx=8)

        # ── 탭: 로그 / 키워드 ────────────────────────────────────────────────
        self.notebook = ttk.Notebook(self)
        self.notebook.pack(fill="both", expand=True, padx=10, pady=(4, 10))

        # 로그 탭
        tab_log = ttk.Frame(self.notebook)
        self.notebook.add(tab_log, text="📋 실행 로그")
        self.txt_log = scrolledtext.ScrolledText(tab_log, wrap="word", state="disabled",
                                                  font=("Consolas", 9), bg="#1e1e1e", fg="#d4d4d4")
        self.txt_log.pack(fill="both", expand=True)
        btn_clear = ttk.Button(tab_log, text="로그 지우기", command=self._clear_log)
        btn_clear.pack(anchor="e", padx=4, pady=2)

        # 키워드 탭
        tab_kw = ttk.Frame(self.notebook)
        self.notebook.add(tab_kw, text="🔑 키워드 인덱스")

        kw_top = ttk.Frame(tab_kw)
        kw_top.pack(fill="x", padx=4, pady=4)
        self.lbl_kw_count = ttk.Label(kw_top, text="키워드: 0개")
        self.lbl_kw_count.pack(side="left")
        ttk.Button(kw_top, text="새로고침", command=self._refresh_keywords).pack(side="left", padx=8)
        ttk.Button(kw_top, text="+ 키워드 추가", command=self._add_keyword_dialog).pack(side="left", padx=4)

        cols = ("keyword", "hub_stem", "display", "added", "hits")
        self.kw_tree = ttk.Treeview(tab_kw, columns=cols, show="headings", height=16)
        for col, label, width in [
            ("keyword", "키워드", 120),
            ("hub_stem", "허브 문서 stem", 280),
            ("display", "표시명", 100),
            ("added", "추가일", 90),
            ("hits", "히트", 50),
        ]:
            self.kw_tree.heading(col, text=label)
            self.kw_tree.column(col, width=width, minwidth=40)
        self.kw_tree.pack(fill="both", expand=True, padx=4, pady=4)

        kw_scroll = ttk.Scrollbar(tab_kw, orient="vertical", command=self.kw_tree.yview)
        self.kw_tree.configure(yscrollcommand=kw_scroll.set)
        kw_scroll.pack(side="right", fill="y")

        # 오른쪽 클릭 메뉴
        self.kw_menu = tk.Menu(self, tearoff=0)
        self.kw_menu.add_command(label="삭제", command=self._delete_keyword)
        self.kw_tree.bind("<Button-3>", self._show_kw_menu)

        # ── 인덱스 파일 탭 ────────────────────────────────────────────────────
        tab_idx = ttk.Frame(self.notebook)
        self.notebook.add(tab_idx, text="📄 인덱스 파일")

        idx_top = ttk.Frame(tab_idx)
        idx_top.pack(fill="x", padx=6, pady=4)
        self.lbl_idx_count = ttk.Label(idx_top, text="인덱스 파일: 0개")
        self.lbl_idx_count.pack(side="left")
        ttk.Button(idx_top, text="새로고침", command=self._refresh_index_list).pack(side="left", padx=8)

        idx_pane = tk.PanedWindow(tab_idx, orient="horizontal", sashwidth=5, relief="flat")
        idx_pane.pack(fill="both", expand=True, padx=6, pady=(0, 6))

        # 왼쪽: 파일 목록
        list_frame = ttk.Frame(idx_pane)
        self.idx_listbox = tk.Listbox(list_frame, width=30, selectmode="single",
                                      font=("Consolas", 9), bg="#1e1e1e", fg="#d4d4d4",
                                      selectbackground="#264f78", activestyle="none")
        self.idx_listbox.pack(fill="both", expand=True, side="left")
        lbscroll = ttk.Scrollbar(list_frame, orient="vertical", command=self.idx_listbox.yview)
        self.idx_listbox.configure(yscrollcommand=lbscroll.set)
        lbscroll.pack(side="right", fill="y")
        self.idx_listbox.bind("<<ListboxSelect>>", self._on_index_select)
        idx_pane.add(list_frame, minsize=160)

        # 오른쪽: 파일 내용
        content_frame = ttk.Frame(idx_pane)
        self.idx_content = scrolledtext.ScrolledText(
            content_frame, wrap="word", state="disabled",
            font=("Consolas", 9), bg="#1e1e1e", fg="#d4d4d4")
        self.idx_content.pack(fill="both", expand=True)
        idx_pane.add(content_frame, minsize=300)

        # 파일 경로 저장용
        self._idx_paths: list[str] = []

        # ── Slack 봇 탭 ──────────────────────────────────────────────────────
        tab_slack = ttk.Frame(self.notebook)
        self.notebook.add(tab_slack, text="💬 Slack 봇")

        # 설정 영역
        slack_cfg = ttk.LabelFrame(tab_slack, text="Slack 설정", padding=8)
        slack_cfg.pack(fill="x", padx=8, pady=(8, 4))

        def slack_row(row, label, var, show=""):
            ttk.Label(slack_cfg, text=label).grid(row=row, column=0, sticky="w", padx=6, pady=3)
            e = ttk.Entry(slack_cfg, textvariable=var, show=show, width=50)
            e.grid(row=row, column=1, sticky="ew", padx=4)

        self.var_slack_bot_token    = tk.StringVar()
        self.var_slack_app_token    = tk.StringVar()
        self.var_slack_top_n        = tk.IntVar(value=5)
        self.var_slack_notify_ch    = tk.StringVar()
        self.var_wkhtmltopdf_path   = tk.StringVar()

        slack_row(0, "Bot Token (xoxb-...):  ", self.var_slack_bot_token, show="*")
        slack_row(1, "App Token (xapp-...):  ", self.var_slack_app_token, show="*")

        ttk.Label(slack_cfg, text="RAG top-N:").grid(row=2, column=0, sticky="w", padx=6, pady=3)
        ttk.Spinbox(slack_cfg, textvariable=self.var_slack_top_n,
                    from_=1, to=20, width=5).grid(row=2, column=1, sticky="w", padx=4)
        ttk.Label(slack_cfg, text="알림 채널 (Schedule·태그):").grid(row=3, column=0, sticky="w", padx=6, pady=3)
        ttk.Entry(slack_cfg, textvariable=self.var_slack_notify_ch, width=22).grid(
            row=3, column=1, sticky="ew", padx=4)
        ttk.Label(slack_cfg, text="예: #general 또는 C0123ABCD",
                  foreground="gray").grid(row=4, column=0, columnspan=2, sticky="w", padx=6)
        ttk.Label(slack_cfg, text="wkhtmltopdf 경로:").grid(row=5, column=0, sticky="w", padx=6, pady=3)
        ttk.Entry(slack_cfg, textvariable=self.var_wkhtmltopdf_path, width=50).grid(
            row=5, column=1, sticky="ew", padx=4)
        slack_cfg.columnconfigure(1, weight=1)

        # 저장 버튼
        ttk.Button(slack_cfg, text="저장", command=self._save_cfg, width=6).grid(
            row=3, column=1, sticky="e", padx=4)

        # 제어 영역
        slack_ctrl = ttk.Frame(tab_slack)
        slack_ctrl.pack(fill="x", padx=8, pady=4)

        self.btn_slack = ttk.Button(slack_ctrl, text="▶ Slack 봇 시작",
                                     command=self._toggle_slack, width=16)
        self.btn_slack.pack(side="left", padx=4)

        self.lbl_slack_status = ttk.Label(slack_ctrl, text="상태: 중지", foreground="gray")
        self.lbl_slack_status.pack(side="left", padx=10)

        # Slack 전용 로그
        self.txt_slack_log = scrolledtext.ScrolledText(
            tab_slack, wrap="word", state="disabled",
            font=("Consolas", 9), bg="#0d1117", fg="#7ee787", height=16)
        self.txt_slack_log.pack(fill="both", expand=True, padx=8, pady=(0, 4))
        ttk.Button(tab_slack, text="로그 지우기",
                   command=self._clear_slack_log).pack(anchor="e", padx=8, pady=2)

        # ── 멀티볼트 탭 ──────────────────────────────────────────────────────
        tab_multi = ttk.Frame(self.notebook)
        self.notebook.add(tab_multi, text="🗂️ 멀티볼트 봇")

        mv_desc = ttk.LabelFrame(tab_multi, text="볼트별 Slack 봇 인스턴스", padding=8)
        mv_desc.pack(fill="x", padx=8, pady=(8, 4))
        ttk.Label(
            mv_desc,
            text=(
                "볼트마다 별도의 config 파일을 만들고, 아래 명령어로 각 봇을 독립 실행하세요.\n"
                "예)  python bot.py --headless --config config_vault2.json"
            ),
            justify="left", foreground="#555",
        ).pack(anchor="w", padx=4, pady=4)

        mv_frame = ttk.LabelFrame(tab_multi, text="인스턴스 설정 파일 목록", padding=8)
        mv_frame.pack(fill="both", expand=True, padx=8, pady=4)

        mv_top = ttk.Frame(mv_frame)
        mv_top.pack(fill="x", pady=(0, 4))
        ttk.Button(mv_top, text="새 인스턴스 config 만들기", command=self._mv_create_config).pack(side="left", padx=4)
        ttk.Button(mv_top, text="새로고침", command=self._mv_refresh).pack(side="left", padx=4)
        ttk.Button(mv_top, text="선택 파일 열기", command=self._mv_open_config).pack(side="left", padx=4)

        self.mv_listbox = tk.Listbox(mv_frame, height=8, font=("Consolas", 9),
                                     bg="#1e1e1e", fg="#d4d4d4",
                                     selectbackground="#264f78", activestyle="none")
        self.mv_listbox.pack(fill="both", expand=True, padx=4, pady=4)

        mv_cmd_frame = ttk.LabelFrame(tab_multi, text="실행 명령어", padding=8)
        mv_cmd_frame.pack(fill="x", padx=8, pady=(0, 8))
        self.mv_cmd_var = tk.StringVar()
        mv_cmd_entry = ttk.Entry(mv_cmd_frame, textvariable=self.mv_cmd_var, state="readonly", width=70)
        mv_cmd_entry.pack(fill="x", padx=4, pady=4)
        ttk.Button(mv_cmd_frame, text="클립보드 복사", command=self._mv_copy_cmd).pack(anchor="e", padx=4, pady=2)
        self.mv_listbox.bind("<<ListboxSelect>>", self._mv_on_select)

        self._mv_refresh()

    def _mv_refresh(self):
        """bot 폴더 내 config_*.json 파일 목록 새로고침."""
        self.mv_listbox.delete(0, "end")
        bot_dir = Path(__file__).parent
        configs = sorted(bot_dir.glob("config*.json"))
        for c in configs:
            self.mv_listbox.insert("end", c.name)

    def _mv_on_select(self, _event=None):
        sel = self.mv_listbox.curselection()
        if not sel:
            return
        name = self.mv_listbox.get(sel[0])
        bot_dir = Path(__file__).parent
        cmd = f"python \"{bot_dir / 'bot.py'}\" --headless --config \"{bot_dir / name}\""
        self.mv_cmd_var.set(cmd)

    def _mv_copy_cmd(self):
        cmd = self.mv_cmd_var.get()
        if cmd:
            self.clipboard_clear()
            self.clipboard_append(cmd)
            messagebox.showinfo("복사 완료", "명령어가 클립보드에 복사되었습니다.")

    def _mv_create_config(self):
        """현재 설정을 기반으로 새 config 파일 생성."""
        from tkinter.simpledialog import askstring
        name = askstring("새 인스턴스", "새 config 파일 이름 (예: config_vault2.json):", parent=self)
        if not name:
            return
        if not name.endswith(".json"):
            name += ".json"
        bot_dir = Path(__file__).parent
        dest = bot_dir / name
        if dest.exists():
            if not messagebox.askyesno("덮어쓰기", f"{name} 이(가) 이미 존재합니다. 덮어쓸까요?"):
                return
        import copy
        new_cfg = copy.deepcopy(self.cfg)
        dest.write_text(json.dumps(new_cfg, ensure_ascii=False, indent=2), encoding="utf-8")
        self._log(f"💾 New instance config created: {name}")
        self._mv_refresh()

    def _mv_open_config(self):
        sel = self.mv_listbox.curselection()
        if not sel:
            messagebox.showinfo("안내", "목록에서 파일을 선택하세요.")
            return
        name = self.mv_listbox.get(sel[0])
        bot_dir = Path(__file__).parent
        path = bot_dir / name
        try:
            os.startfile(str(path))
        except Exception as e:
            messagebox.showerror("오류", f"파일 열기 실패: {e}")

    # ── Config UI 연결 ────────────────────────────────────────────────────────

    def _load_cfg_to_ui(self):
        self.var_vault.set(self.cfg.get("vault_path", ""))
        self.var_key.set(self.cfg.get("claude_api_key", ""))
        self.var_interval.set(self.cfg.get("interval_hours", 1))
        self.var_slack_bot_token.set(self.cfg.get("slack_bot_token", ""))
        self.var_slack_app_token.set(self.cfg.get("slack_app_token", ""))
        self.var_slack_top_n.set(self.cfg.get("slack_rag_top_n", 5))
        self.var_slack_notify_ch.set(self.cfg.get("slack_notify_channel", ""))
        self.var_wkhtmltopdf_path.set(self.cfg.get("wkhtmltopdf_path", r"C:\Program Files (x86)\wkhtmltopdf\bin\wkhtmltopdf.exe"))
        self.after(100, self._refresh_index_list)  # UI 초기화 후 인덱스 목록 로드

    def _save_cfg(self):
        self.cfg["vault_path"]       = self.var_vault.get().strip()
        self.cfg["claude_api_key"]   = self.var_key.get().strip()
        self.cfg["interval_hours"]   = self.var_interval.get()
        self.cfg["slack_bot_token"]      = self.var_slack_bot_token.get().strip()
        self.cfg["slack_app_token"]      = self.var_slack_app_token.get().strip()
        self.cfg["slack_rag_top_n"]      = self.var_slack_top_n.get()
        self.cfg["slack_notify_channel"] = self.var_slack_notify_ch.get().strip()
        self.cfg["wkhtmltopdf_path"]     = self.var_wkhtmltopdf_path.get().strip()
        save_config(self.cfg)
        self._log("💾 Settings saved")

    def _browse_vault(self):
        folder = filedialog.askdirectory(title="볼트 폴더 선택")
        if folder:
            self.var_vault.set(folder)

    # ── 로그 ─────────────────────────────────────────────────────────────────

    def _log_threadsafe(self, msg: str):
        """백그라운드 스레드에서 안전하게 호출 가능 — after()로 메인 스레드에 위임."""
        self.after(0, lambda m=msg: self._log_direct(m))

    def _log_direct(self, msg: str):
        """메인 스레드 전용. Tkinter 위젯 직접 수정."""
        self.txt_log.configure(state="normal")
        ts = datetime.now().strftime("%H:%M:%S")
        self.txt_log.insert("end", f"[{ts}] {msg}\n")
        self.txt_log.see("end")
        self.txt_log.configure(state="disabled")

    def _log(self, msg: str):
        """메인 스레드에서 호출 (버튼 클릭, 설정 저장 등)."""
        self._log_direct(msg)

    def _clear_log(self):
        self.txt_log.configure(state="normal")
        self.txt_log.delete("1.0", "end")
        self.txt_log.configure(state="disabled")

    # ── 실행 제어 ─────────────────────────────────────────────────────────────

    def _make_bot(self) -> VaultBot:
        self._save_cfg()
        return VaultBot(self.cfg, log_fn=self._log_threadsafe, on_done_fn=self._on_cycle_done)

    def _set_running(self, running: bool):
        self.lbl_status.config(
            text="상태: 실행 중..." if running else "상태: 대기",
            foreground="orange" if running else "gray",
        )
        self.btn_run.config(state="disabled" if running else "normal")

    def _run_now(self):
        self._set_running(True)
        bot = self._make_bot()
        bot.run_once()

    def _on_cycle_done(self):
        """백그라운드 스레드에서 호출됨 — 모든 UI 조작을 after()로 위임."""
        def _main():
            self._set_running(False)
            self._refresh_keywords()
            self._refresh_index_list()
            if self.timer_running and self.cfg["interval_hours"] > 0:
                h = self.cfg["interval_hours"]
                self._next_run_time = datetime.now() + timedelta(hours=h)
        self.after(0, _main)

    def _toggle_timer(self):
        if self.timer_running:
            # 타이머 중지
            if self.bot:
                self.bot.stop_timer()
            self.timer_running = False
            self._next_run_time = None
            self.btn_timer.config(text="⏱ 타이머 시작")
            self.lbl_status.config(text="상태: 대기", foreground="gray")
            self._log("⏹ Timer stopped")
        else:
            h = self.var_interval.get()
            if h == 0:
                messagebox.showinfo("알림", "수동 모드에서는 타이머를 사용할 수 없습니다.")
                return
            self.bot = self._make_bot()
            self.bot.start_timer(h)
            self.timer_running = True
            self._next_run_time = datetime.now() + timedelta(hours=h)
            self.btn_timer.config(text="⏹ 타이머 중지")
            self.lbl_status.config(text=f"상태: 타이머 실행 ({h}h)", foreground="green")
            self._log(f"⏱ Timer started — {h}h interval")

    def _tick(self):
        """매 초 카운트다운 업데이트"""
        if self._next_run_time:
            remaining = self._next_run_time - datetime.now()
            if remaining.total_seconds() > 0:
                h, rem = divmod(int(remaining.total_seconds()), 3600)
                m, s = divmod(rem, 60)
                self.lbl_next.config(text=f"다음 실행까지 {h:02d}:{m:02d}:{s:02d}")
            else:
                self.lbl_next.config(text="")
        else:
            self.lbl_next.config(text="")
        self.after(1000, self._tick)

    # ── 키워드 탭 ─────────────────────────────────────────────────────────────

    def _refresh_keywords(self):
        vault = self.var_vault.get().strip()
        if not vault:
            return
        store = KeywordStore(vault, self.cfg.get("keyword_index_path", KEYWORD_INDEX_REL_PATH))
        store.load()
        kws = store.get_keywords()
        self.lbl_kw_count.config(text=f"키워드: {len(kws)}개")

        # 트리뷰 갱신
        for row in self.kw_tree.get_children():
            self.kw_tree.delete(row)
        for kw, info in sorted(kws.items()):
            self.kw_tree.insert("", "end", values=(
                kw,
                info.get("hub_stem", ""),
                info.get("display", kw),
                info.get("added", ""),
                info.get("hit_count", 0),
            ))

    def _show_kw_menu(self, event):
        item = self.kw_tree.identify_row(event.y)
        if item:
            self.kw_tree.selection_set(item)
            self.kw_menu.post(event.x_root, event.y_root)

    def _delete_keyword(self):
        selected = self.kw_tree.selection()
        if not selected:
            return
        kw = self.kw_tree.item(selected[0])["values"][0]
        if not messagebox.askyesno("확인", f"'{kw}' 키워드를 삭제하시겠습니까?"):
            return
        vault = self.var_vault.get().strip()
        store = KeywordStore(vault, self.cfg.get("keyword_index_path", KEYWORD_INDEX_REL_PATH))
        store.load()
        store.remove(kw)
        store.save()
        self._refresh_keywords()
        self._log(f"🗑 Keyword deleted: {kw}")

    def _add_keyword_dialog(self):
        dialog = tk.Toplevel(self)
        dialog.title("키워드 추가")
        dialog.geometry("440x160")
        dialog.resizable(False, False)
        dialog.grab_set()

        frm = ttk.Frame(dialog, padding=12)
        frm.pack(fill="both", expand=True)

        ttk.Label(frm, text="키워드:").grid(row=0, column=0, sticky="w", pady=4)
        var_kw = tk.StringVar()
        ttk.Entry(frm, textvariable=var_kw, width=35).grid(row=0, column=1, sticky="ew", padx=4)

        ttk.Label(frm, text="허브 문서 stem:").grid(row=1, column=0, sticky="w", pady=4)
        var_hub = tk.StringVar()
        ttk.Entry(frm, textvariable=var_hub, width=35).grid(row=1, column=1, sticky="ew", padx=4)

        ttk.Label(frm, text="표시명 (선택):").grid(row=2, column=0, sticky="w", pady=4)
        var_disp = tk.StringVar()
        ttk.Entry(frm, textvariable=var_disp, width=35).grid(row=2, column=1, sticky="ew", padx=4)

        def on_ok():
            kw = var_kw.get().strip()
            hub = var_hub.get().strip()
            if not kw or not hub:
                messagebox.showwarning("입력 오류", "키워드와 허브 stem을 입력하세요.", parent=dialog)
                return
            vault = self.var_vault.get().strip()
            store = KeywordStore(vault, self.cfg.get("keyword_index_path", KEYWORD_INDEX_REL_PATH))
            store.load()
            store.upsert(kw, hub, var_disp.get().strip() or kw)
            store.save()
            dialog.destroy()
            self._refresh_keywords()
            self._log(f"➕ 키워드 추가: {kw} → {hub}")

        btn_frm = ttk.Frame(frm)
        btn_frm.grid(row=3, column=0, columnspan=2, pady=8)
        ttk.Button(btn_frm, text="추가", command=on_ok, width=10).pack(side="left", padx=4)
        ttk.Button(btn_frm, text="취소", command=dialog.destroy, width=10).pack(side="left", padx=4)
        frm.columnconfigure(1, weight=1)

    # ── 인덱스 파일 탭 ────────────────────────────────────────────────────────

    def _refresh_index_list(self):
        vault = self.var_vault.get().strip()
        if not vault or not Path(vault).exists():
            return
        # vault 전체에서 index_*.md 파일 수집
        paths = sorted(
            Path(vault).rglob("index_*.md"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        self._idx_paths = [str(p) for p in paths]
        self.lbl_idx_count.config(text=f"인덱스 파일: {len(paths)}개")
        self.idx_listbox.delete(0, "end")
        for p in paths:
            # 상대 경로로 표시
            try:
                rel = p.relative_to(vault)
            except ValueError:
                rel = p
            self.idx_listbox.insert("end", str(rel))

    def _on_index_select(self, event=None):
        sel = self.idx_listbox.curselection()
        if not sel:
            return
        idx = sel[0]
        if idx >= len(self._idx_paths):
            return
        path = Path(self._idx_paths[idx])
        try:
            content = path.read_text(encoding="utf-8")
        except Exception as e:
            content = f"❌ 파일 읽기 실패: {e}"
        self.idx_content.configure(state="normal")
        self.idx_content.delete("1.0", "end")
        self.idx_content.insert("end", content)
        self.idx_content.configure(state="disabled")

    # ── Slack 탭 ─────────────────────────────────────────────────────────────

    def _slack_log(self, msg: str):
        """메인 스레드 전용 — Slack 로그 위젯에 직접 출력."""
        self.txt_slack_log.configure(state="normal")
        ts = datetime.now().strftime("%H:%M:%S")
        self.txt_slack_log.insert("end", f"[{ts}] {msg}\n")
        self.txt_slack_log.see("end")
        self.txt_slack_log.configure(state="disabled")

    def _slack_log_threadsafe(self, msg: str):
        """백그라운드 스레드에서 호출 — after()로 위임."""
        self.after(0, lambda m=msg: self._slack_log(m))

    def _clear_slack_log(self):
        self.txt_slack_log.configure(state="normal")
        self.txt_slack_log.delete("1.0", "end")
        self.txt_slack_log.configure(state="disabled")

    def _set_slack_status(self, running: bool):
        if running:
            self.btn_slack.config(text="⏹ Slack 봇 중지")
            self.lbl_slack_status.config(text="상태: 실행 중", foreground="green")
        else:
            self.btn_slack.config(text="▶ Slack 봇 시작")
            self.lbl_slack_status.config(text="상태: 중지", foreground="gray")

    def _on_slack_stopped(self, running: bool):
        """SlackBotRunner가 종료 시 호출 (백그라운드 스레드에서)."""
        self.after(0, lambda: self._set_slack_status(running))

    def _toggle_slack(self):
        if self._slack_runner and self._slack_runner.is_running():
            self._slack_runner.stop()
            self._slack_runner = None
            self._set_slack_status(False)
        else:
            self._save_cfg()
            runner = SlackBotRunner(
                self.cfg,
                log_fn=self._slack_log_threadsafe,
                on_status_fn=self._on_slack_stopped,
            )
            ok = runner.start()
            if ok:
                self._slack_runner = runner
                self._set_slack_status(True)


# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--headless", action="store_true", help="Tkinter 없이 Slack 봇만 실행")
    parser.add_argument("--config", default=None, help="사용할 config 파일 경로 (기본: config.json)")
    args = parser.parse_args()

    # --config 인자로 CONFIG_PATH 오버라이드 (볼트별 봇 인스턴스 지원)
    if args.config:
        CONFIG_PATH = Path(args.config).resolve()

    if args.headless:
        import signal
        import io
        # Windows cp949 환경에서 이모지 출력 가능하도록 stdout을 UTF-8로 교체
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

        cfg = load_config()

        def _log(msg: str):
            print(msg, flush=True)

        def _on_status(running: bool):
            print(f"[STATUS] {'running' if running else 'stopped'}", flush=True)

        runner = SlackBotRunner(cfg, _log, _on_status)
        ok = runner.start()
        if not ok:
            print("[ERROR] 봇 시작 실패", flush=True)
            sys.exit(1)

        print("[READY] Slack bot started", flush=True)

        def _shutdown(sig, frame):
            print("[STOP] 봇 종료 중...", flush=True)
            runner.stop()
            sys.exit(0)

        signal.signal(signal.SIGINT, _shutdown)
        signal.signal(signal.SIGTERM, _shutdown)

        while runner.is_running():
            time.sleep(1)
        print("[STOP] 봇이 예기치 않게 종료됨", flush=True)
    else:
        app = App()
        app.mainloop()
