"""
Strata Sync Source Management Bot — 볼트 관리 + Slack 봇 통합 GUI
──────────────────────────────────────────────────────────────────
기능:
  - vault MD 파일 스캔 + keyword_index.json 자동 관리
  - wikilink 주입 + 클러스터 링크 강화
  - index_YYYYMMDD.md 자동 갱신 (타이머 1h / 5h)
  - index MD 파일 브라우저 (생성된 인덱스 열람)
  - Slack 봇 (Socket Mode, 페르소나 + RAG)

실행:
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

# .env 파일 로드 (시크릿 우선순위: .env > config.json > UI 입력)
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / ".env")
except ImportError:
    pass  # python-dotenv 없으면 env vars만 사용

# 모듈 경로 추가
sys.path.insert(0, str(Path(__file__).parent))

from modules.vault_scanner import scan_vault, find_active_folders
from modules.keyword_store import KeywordStore
from modules.claude_client import ClaudeClient
from modules.wikilink_updater import process_folder
from modules.index_generator import generate_index
from modules.progress_updater import ProgressUpdater
from modules.mirofish_runner import run_simulation as mirofish_run_python, STANCE_KO
from modules.constants import DEFAULT_HAIKU_MODEL, DEFAULT_SONNET_MODEL, KEYWORD_INDEX_REL_PATH
from modules.rag_electron import RAG_API_BASE
from modules.api_keys import get_anthropic_key
from modules.config_schema import BotConfig, default_config

CONFIG_PATH = Path(__file__).parent / "config.json"  # --config 인자로 오버라이드 가능


def _clean_search_query(q: str) -> str:
    """
    검색용 쿼리에서 메타 지시 표현을 제거합니다.
    BM25/TF-IDF가 "보고서", "분석", "방향" 같은 볼트 공통 단어에 오염되지 않도록 보정.

    적용 순서:
      1. 복합 메타동사: "분석해줘", "정리해줘", "제안해줘" 등
      2. 메타명사+동작: "보고서 써줘", "리포트 만들어줘"
      3. 순수 요청 어미: "알려줘", "찾아줘", "해줘", "줘" 등
    원본이 전부 제거되면 원본 그대로 반환.
    """
    out = q.strip()
    # 1. 복합 메타동사 (동사 자체가 메타 의미 + 요청 어미)
    out = re.sub(
        r'\s*(분석|정리|요약|검토|설명|비교|제안|작성|소개|추천|추출|뽑아)(해줘|해주세요|해봐줘|해봐|줘|주세요|해)\s*$',
        '', out, flags=re.IGNORECASE,
    )
    # 2. 메타명사 + 동작동사: "보고서 써줘", "리포트 만들어줘"
    out = re.sub(
        r'\s*(보고서|리포트|report)\s*[\w가-힣]*(써|만들|작성|export|pdf)[\w가-힣\s]*$',
        '', out, flags=re.IGNORECASE,
    )
    # 3. 순수 요청 어미
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
    # env vars override config.json (시크릿은 .env에서만 관리)
    if os.getenv("ANTHROPIC_API_KEY"):
        cfg["claude_api_key"] = os.environ["ANTHROPIC_API_KEY"]
    if os.getenv("SLACK_BOT_TOKEN"):
        cfg["slack_bot_token"] = os.environ["SLACK_BOT_TOKEN"]
    if os.getenv("SLACK_APP_TOKEN"):
        cfg["slack_app_token"] = os.environ["SLACK_APP_TOKEN"]
    return cfg


_SECRET_KEYS = {"claude_api_key", "slack_bot_token", "slack_app_token"}

def save_config(cfg: dict):
    # 로컬 config.json에 전체 저장 (시크릿 포함).
    # env var가 있으면 load_config에서 덮어씌우므로 env 우선순위는 유지됨.
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
            self.log("❌ 볼트 경로가 없거나 존재하지 않습니다.")
            return

        self.log(f"\n{'='*50}")
        self.log(f"🚀 실행 시작: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        self.log(f"볼트: {vault_path}")

        # 1. 볼트 스캔
        self.log("\n📂 볼트 스캔 중...")
        docs = scan_vault(vault_path)
        self.log(f"  총 {len(docs)}개 MD 파일 발견")

        active_folders = find_active_folders(vault_path)
        self.log(f"  active 폴더: {len(active_folders)}개 → {[Path(f).name for f in active_folders]}")

        # 2. Keyword store 로드
        store = KeywordStore(vault_path, cfg.get("keyword_index_path", KEYWORD_INDEX_REL_PATH))
        loaded = store.load()
        self.log(f"\n🔑 키워드 인덱스: {'로드됨' if loaded else '새로 생성'} ({store.count()}개 키워드)")

        # 3. Claude로 새 키워드 발견 (API key 있을 때만)
        if api_key:
            self.log("\n🤖 Claude Haiku — 키워드 발견 중...")
            try:
                client = ClaudeClient(api_key, cfg.get("worker_model", DEFAULT_HAIKU_MODEL))
                # active 폴더의 최신 문서 샘플
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
                    self.log(f"  {added}개 키워드 발견/갱신")
                else:
                    self.log("  active 폴더에 문서 없음 — 스킵")
            except Exception as e:
                self.log(f"  ⚠️ Claude API 오류: {e}")
        else:
            self.log("\n⚠️  API 키 없음 — 키워드 발견 스킵 (기존 인덱스 사용)")

        store.save()
        self.log(f"  키워드 인덱스 저장 완료 ({store.count()}개)")

        # 4. active 폴더별 wikilink 처리
        keyword_map = store.to_inject_map()
        total_updated = 0
        total_hits: dict = {}

        for folder in active_folders:
            self.log(f"\n🔗 wikilink 처리: {Path(folder).name}")
            result = process_folder(folder, keyword_map, log_fn=self.log)
            total_updated += result["updated"]
            for kw, cnt in result["keyword_hits"].items():
                total_hits[kw] = total_hits.get(kw, 0) + cnt

        self.log(f"\n  총 {total_updated}개 파일 업데이트")
        if total_hits:
            top = sorted(total_hits.items(), key=lambda x: -x[1])[:5]
            self.log(f"  키워드 히트 TOP5: {', '.join(f'{k}({v})' for k,v in top)}")

        # 5. index 갱신 (최신 active 폴더)
        if active_folders:
            self.log(f"\n📋 인덱스 갱신: {Path(active_folders[0]).name}")
            generate_index(active_folders[0], log_fn=self.log)

        self.log(f"\n✅ 완료: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        self.on_done()

    def run_once(self):
        def _safe():
            try:
                self._run_cycle()
            except Exception as e:
                self.log(f"❌ 치명적 오류: {e}")
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
                    self.log(f"❌ 치명적 오류: {e}")
                finally:
                    self.on_done()
                # interval 대기 (10초마다 stop 체크)
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
    """Slack SocketModeHandler를 백그라운드 스레드로 관리."""

    def __init__(self, cfg: dict, log_fn, on_status_fn):
        self.cfg = cfg
        self._log = log_fn          # thread-safe (after() 기반)
        self._on_status = on_status_fn
        self._handler = None
        self._thread: threading.Thread | None = None

    def is_running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def start(self) -> bool:
        """슬랙 봇 시작. 성공 시 True."""
        try:
            from slack_bolt import App
            from slack_bolt.adapter.socket_mode import SocketModeHandler
            from slack_sdk import WebClient
        except ImportError:
            self._log("❌ slack-bolt 패키지 필요: pip install slack-bolt")
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
        # api_keys 모듈이 우선순위(Electron > config > env)를 단일 관리
        api_key    = get_anthropic_key(cfg)
        top_n      = cfg.get("slack_rag_top_n", 5)

        if not bot_token or not app_token:
            self._log("❌ slack_bot_token / slack_app_token 이 설정에 없습니다.")
            return False
        if not vault_path or not Path(vault_path).exists():
            self._log(f"❌ 볼트 경로 없음: {vault_path!r}")
            return False

        import re as _re
        web = WebClient(token=bot_token)
        app    = App(token=bot_token)

        PERSONA_TAG_RE = _re.compile(r"\[([^\]]+)\]")
        BOT_MENTION_RE = _re.compile(r"<@[A-Z0-9]+>")
        # MiroFish 자연어 감지: 🐟 이모지, mirofish 키워드, 또는 시뮬레이션 동작어
        # 트리거: "시뮬레이션" 또는 "시뮬" (단독 키워드)
        MIROFISH_RE = _re.compile(
            r"시뮬레이션|시뮬",
            _re.IGNORECASE,
        )
        # 보고서 생성 인텐트: chatStore.ts의 REPORT_INTENT_RE와 동일
        REPORT_INTENT_RE = _re.compile(
            r"보고서.{0,20}(써|만들|작성|뽑아|정리|export|pdf)|(대화|채팅).{0,20}보고서|보고서.{0,20}(대화|채팅)|(pdf|PDF).{0,20}(만들|보고서|저장|export)",
            _re.IGNORECASE,
        )

        # 페르소나 수: "5명", "10명 으로"
        MIRO_PERSONAS_RE = _re.compile(r"(\d{1,2})\s{0,3}명")
        # 라운드 수: "3라운드", "5 라운드", "3라운드로"
        MIRO_ROUNDS_RE   = _re.compile(r"(\d{1,2})\s{0,3}라운드로?")
        # 타겟 세그먼트: "코어", "캐주얼", "하드코어", "라이트", "신규", "복귀" 유저
        MIRO_SEGMENT_RE  = _re.compile(
            r"(코어\s*게이머|캐주얼\s*게이머|하드코어\s*게이머|라이트\s*유저|신규\s*유저|복귀\s*유저|"
            r"코어\s*유저|캐주얼\s*유저|하드코어\s*유저|[가-힣a-zA-Z]+\s*세그먼트)",
            _re.IGNORECASE,
        )
        # A vs B 비교: "X vs Y", "X 대비 Y", "X 와 Y 비교"
        MIRO_VS_RE = _re.compile(
            r"(.+?)\s+(?:vs\.?|대비|와\s+(.+?)\s+비교)\s+(.+)",
            _re.IGNORECASE,
        )
        # 프리셋 참조: "[프리셋:이름]" 또는 "[preset:name]"
        MIRO_PRESET_RE = _re.compile(r"\[(?:프리셋|preset)\s*:\s*([^\]]+)\]", _re.IGNORECASE)
        # MiroFish 결과 캐시: (topic, num_personas, num_rounds) → (result, timestamp)
        _miro_cache: dict[tuple, tuple] = {}
        _miro_cache_lock = threading.Lock()
        _MIRO_CACHE_TTL = 1800   # 30분
        _MIRO_CACHE_MAX = 200    # 캐시 최대 항목 수
        # 스레드/DM별 대화 히스토리 (key: "channel:thread_ts", 최대 키 1000개)
        _MAX_HISTORY_KEYS = 1000
        _conv_history: dict[str, list[dict]] = {}
        _conv_history_lock = threading.Lock()

        # ── 슬랙 사용자별 장기 기억 ──────────────────────────────────────────
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
            """매 5턴마다 대화를 요약해 사용자 기억 갱신."""
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
                "아래 대화를 300자 이내로 핵심 결정사항·합의·중요 컨텍스트 중심으로 요약하세요. 요약만 출력."
            )
            if existing:
                summary_prompt += f"\n\n기존 기억:\n{existing}"
            try:
                summary = claude.complete(summary_prompt, f"대화:\n{hist_text}", max_tokens=400).strip()
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

        _VISION_MODEL = DEFAULT_SONNET_MODEL  # 항상 Claude 사용 (GPT/Gemini 설정 무시)

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
            Enterprise Grid 폴백: files.info API로 썸네일 URL을 받아 다운로드.
            url_private_download는 SSO에 막히지만 thumb_* URL은 별도 CDN에서 서빙되어
            봇 토큰 Authorization 헤더로 접근 가능한 경우가 많음.
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
                        self._log(f"[Vision] SSRF 차단: 허용되지 않은 URL {thumb_url[:80]}")
                        continue
                    self._log(f"[Vision] Enterprise thumb 시도: {key}")
                    r = _req.get(
                        thumb_url,
                        headers={"Authorization": f"Bearer {bot_token}"},
                        allow_redirects=False,  # don't follow redirects to prevent redirect-based SSRF
                        timeout=15,
                    )
                    if r.ok and r.content and r.content[:1] != b"<":
                        self._log(f"[Vision] thumb 다운로드 완료: {len(r.content)}바이트")
                        return r.content
            except Exception as e:
                self._log(f"[Vision] files.info 실패: {e}")
            return None

        # Anthropic base64 이미지 한도: 5MB base64 ≈ 3.75MB raw → 여유분 포함 3.5MB
        _MAX_IMG_BYTES = 3_500_000

        def _shrink_image(raw: bytes, mimetype: str, file_id: str | None) -> tuple[bytes, str] | None:
            """이미지를 Anthropic 허용 범위(≤3.5MB)로 줄임. PIL 리사이즈 → Slack thumb 순 폴백."""
            # PIL 리사이즈 시도
            try:
                from PIL import Image
                import io as _io
                # Decompression bomb protection: limit to 50MP
                if len(raw) > 20_000_000:
                    self._log(f"[Vision] 이미지 크기 초과 ({len(raw)//1024//1024}MB), 건너뜀")
                    raise ValueError("raw image too large")
                Image.MAX_IMAGE_PIXELS = 50_000_000
                img = Image.open(_io.BytesIO(raw))
                # 장변 1568px 이하로 축소 (Anthropic 권장 최대치)
                if max(img.size) > 1568:
                    ratio = 1568 / max(img.size)
                    img = img.resize((int(img.size[0] * ratio), int(img.size[1] * ratio)), Image.LANCZOS)
                # 투명도 없으면 JPEG 변환 (용량 절감)
                if img.mode in ("RGBA", "P", "LA"):
                    img = img.convert("RGB")
                buf = _io.BytesIO()
                img.save(buf, format="JPEG", quality=85, optimize=True)
                result = buf.getvalue()
                self._log(f"[Vision] PIL 리사이즈 완료: {len(result)//1024}KB")
                return result, "image/jpeg"
            except ImportError:
                self._log("[Vision] PIL 없음 → Slack thumb 시도")
            except Exception as e:
                self._log(f"[Vision] PIL 오류: {e}")
            # Slack thumb 폴백 (files.info → thumb_1024/720/480)
            if file_id:
                thumb = _fetch_via_files_info(file_id)
                if thumb:
                    self._log(f"[Vision] Slack thumb 사용: {len(thumb)//1024}KB")
                    return thumb, "image/jpeg"
            return None

        def _download_images(image_files: list) -> list[dict]:
            """이미지 다운로드 → [{"data": base64, "mediaType": str}] 리스트 반환."""
            import base64 as _b64
            results = []
            for f in image_files[:3]:
                url = f.get("url_private_download") or f.get("url_private")
                raw = download_slack_file(url or "", bot_token, log_fn=self._log) if url else None
                file_id = f.get("id")
                # Enterprise Grid 폴백: SSO 차단 시 files.info → thumb URL 시도
                if not raw and file_id:
                    raw = _fetch_via_files_info(file_id)
                if not raw:
                    self._log("[Vision] 다운로드 실패")
                    continue
                mimetype = f.get("mimetype") or "image/png"
                # 너무 크면 리사이즈 (Anthropic 5MB base64 한도)
                if len(raw) > _MAX_IMG_BYTES:
                    self._log(f"[Vision] {len(raw)//1024}KB 초과 → 리사이즈")
                    shrunk = _shrink_image(raw, mimetype, file_id)
                    if not shrunk:
                        self._log("[Vision] 리사이즈 실패 → 스킵")
                        continue
                    raw, mimetype = shrunk
                self._log(f"[Vision] {len(raw)//1024}KB magic={raw[:4].hex()}")
                results.append({"data": _b64.standard_b64encode(raw).decode(), "mediaType": mimetype})
            return results

        def _describe_images(downloaded: list[dict], query: str) -> str | None:
            """다운로드된 이미지들을 Claude로 묘사 (RAG 쿼리 보강용). 실패 시 None."""
            if not api_key:
                return None
            content_parts: list = [
                {"type": "image", "source": {"type": "base64", "media_type": img["mediaType"], "data": img["data"]}}
                for img in downloaded
            ]
            desc_prompt = (
                f"{query}\n\n"
                "이미지에서 보이는 캐릭터의 외형(복장, 색상, 헤어, 표정, 분위기, 소품 등)을 "
                "구체적으로 묘사해주세요. 묘사만 출력, 평가나 결론은 제외."
            )
            content_parts.append({"type": "text", "text": desc_prompt})
            try:
                import anthropic as _ant
                msg = _ant.Anthropic(api_key=api_key).messages.create(
                    model=_VISION_MODEL,
                    max_tokens=800,
                    system="당신은 게임 캐릭터 아트 분석 전문가입니다. 이미지를 객관적으로 묘사합니다.",
                    messages=[{"role": "user", "content": content_parts}],
                )
                return msg.content[0].text
            except Exception as e:
                self._log(f"[Vision] 묘사 오류: {e}")
                return None

        _IMAGE_WORDS = ["이미지", "사진", "그림", "원화", "일러스트", "레퍼런스", "image", "photo", "pic"]
        # 이미지 검색 시 제거할 동작/수량 단어 (주제어만 남기기 위함)
        _ACTION_WORDS = ["보여줘", "보여주세요", "찾아줘", "찾아주세요", "보내줘", "보내주세요",
                         "줘", "주세요", "검색해줘", "있어", "있나요", "있어요",
                         "하나", "한장", "몇개", "주", "좀", "제발", "꼭"]

        def _upload_images_to_slack(image_paths: list[str], channel: str, thread_ts: str | None) -> int:
            """볼트 이미지를 Slack에 업로드. 업로드 성공 건수 반환."""
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
                    self._log(f"[Image] 업로드 완료: {filename}")
                except Exception as e:
                    self._log(f"[Image] 업로드 실패 ({os.path.basename(path)}): {e}")
            return uploaded

        _SLACK_MAX = 3800  # Slack 블록 실질 한도 (4000자 버퍼)

        def _say_long(text: str, say_fn, thread_ts: str | None, *, update_ts: str | None = None, channel: str | None = None):
            """4000자 초과 텍스트를 자동 분할하여 게시. update_ts가 있으면 첫 청크는 chat_update."""
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
            """단일 MiroFish 시뮬레이션 실행 (Electron → Python 폴백). 결과 dict 반환."""

            def update(msg: str):
                if think_ts:
                    try:
                        web.chat_update(channel=channel, ts=think_ts, text=msg)
                    except Exception as _ue:
                        self._log(f"[MiroFish] chat_update 실패 (무시): {_ue}")

            # 캐시 체크 — context 해시 포함 (같은 토픽이라도 맥락이 다르면 별도 캐시)
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
                    update(f"🐟 *캐시 결과 사용* ({age_min}분 전)\n주제: *{topic}*\n_(새 결과를 원하면 '새로 시뮬레이션' 을 입력하세요)_")
                    self._log(f"[MiroFish] 캐시 히트: {topic!r} ({age_min}분 경과)")
                    return cached_result

            # Electron 위임 + 하트비트 스레드 (중간 진행 보고)
            if not is_electron_alive():
                self._log("[MiroFish] Electron 오프라인 → 시뮬레이션 실행 불가")
                update(
                    f"🐟 *MiroFish 시뮬레이션 불가*\n주제: *{topic}*\n\n"
                    f"🔴 *샌드박스 맵 앱이 응답하지 않습니다.*\n\n"
                    f"*확인해주세요:*\n"
                    f"• 샌드박스 맵 앱이 실행 중인지 확인\n"
                    f"• 앱 실행 직후라면 30초 정도 기다린 뒤 다시 요청"
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

            # 하트비트: 20초마다 /mirofish-progress 폴링 → 실시간 피드 업데이트
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
                            st = STANCE_KO.get(p.get("stance", ""), p.get("stance", ""))
                            lines.append(f"*[R{p['round']}] {p['personaName']}* ({st})\n> {p['content']}")
                        feed_preview = "\n\n".join(lines)
                        update(
                            f"🐟 *MiroFish 진행 중* (R{cur_round}/{num_rounds})\n"
                            f"주제: *{topic}* | ⏱️ {elapsed}초\n\n"
                            f"{feed_preview}\n\n_...계속 실행 중..._"
                        )
                    else:
                        update(
                            f"🐟 *MiroFish 시뮬레이션 진행 중...*\n"
                            f"주제: *{topic}* | 페르소나: {num_personas}명 | 라운드: {num_rounds}회\n"
                            f"_(⏱️ {elapsed}초 경과)_"
                        )
                except Exception:
                    update(
                        f"🐟 *MiroFish 시뮬레이션 진행 중...*\n"
                        f"주제: *{topic}* | 페르소나: {num_personas}명 | 라운드: {num_rounds}회\n"
                        f"_(⏱️ {elapsed}초 경과)_"
                    )

            result = _result_holder[0]

            # 에러 응답 처리: {'feed': [], 'report': '오류: ...'} 또는 in-flight 응답 → None으로 처리해 폴백 진입
            _report_str = result.get("report", "") if isinstance(result, dict) else ""
            if isinstance(result, dict) and not result.get("feed") and isinstance(_report_str, str) and (
                _report_str.startswith("오류:") or "이미 실행 중" in _report_str
            ):
                self._log(f"[MiroFish] Electron 오류 응답: {result.get('report', '')[:100]}")
                result = None

            # Electron 폴백: Python 직접 실행
            if result is None:
                self._log("[MiroFish] Electron 미실행 → Python 폴백")
                live_key = get_anthropic_key(self.cfg)
                if not live_key:
                    return None
                model = get_model_for_tag("chief")
                claude_cli = ClaudeClient(live_key, model)

                round_count = [0]
                def progress_log(msg: str):
                    self._log(msg)
                    if "[MiroFish] 라운드" in msg:
                        round_count[0] += 1
                        update(
                            f"🐟 *MiroFish 시뮬레이션*\n주제: *{topic}*\n"
                            f"라운드 {round_count[0]}/{num_rounds} 진행 중..."
                        )
                # NOTE: mirofish_runner.run_simulation은 segment 미지원 — Electron 경로에서만 segment가 반영됨
                result = mirofish_run_python(topic, num_personas, num_rounds, claude_cli, log_fn=progress_log, context=context)

            if result:
                with _miro_cache_lock:
                    _miro_cache[cache_key] = (result, time.time())
                    # 캐시 크기 초과 시 오래된 항목부터 제거
                    if len(_miro_cache) > _MIRO_CACHE_MAX:
                        oldest_keys = sorted(_miro_cache, key=lambda k: _miro_cache[k][1])
                        for _k in oldest_keys[:len(_miro_cache) - _MIRO_CACHE_MAX]:
                            del _miro_cache[_k]

            return result

        # ── MiroFish HTML 보고서 생성 ────────────────────────────────────────────
        _REPORTS_DIR = Path(__file__).parent / "reports" / "mirofish"
        _CHAT_REPORTS_DIR = Path(__file__).parent / "reports" / "chat"

        def _generate_report_html(title: str, content: str) -> Path:
            """LLM 보고서 마크다운을 wkhtmltopdf 호환 HTML 파일로 저장. 파일 경로 반환."""
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
                    # 코드블록 토글
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

                    # 테이블 행 감지
                    if line.startswith("|") and line.endswith("|"):
                        if not in_table:
                            in_table = True
                        # 구분선 행(|---|---| 패턴)은 건너뜀
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
            self._log(f"[보고서] HTML 저장: {filepath}")
            return filepath

        def _generate_mirofish_html(
            topic: str, report: str, feed: list,
            num_personas: int, num_rounds: int,
            pm_brief: str | None = None,
        ) -> Path:
            """MiroFish 결과를 HTML 파일로 저장. 파일 경로 반환."""
            _REPORTS_DIR.mkdir(parents=True, exist_ok=True)

            now_str   = datetime.now().strftime("%Y%m%d_%H%M")
            safe_topic = _re.sub(r'[\\/*?:"<>|]', "", topic)[:40].strip()
            filename   = f"{now_str}_{safe_topic}.html"
            filepath   = _REPORTS_DIR / filename

            # 스탠스별 집계
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

            # 보고서 마크다운 → 기본 HTML 변환
            import html as _html_mod

            # wkhtmltopdf는 BMP 외 이모지(U+1F000+) 및 일부 특수문자를 ☒로 출력 → 사전 제거
            _EMOJI_RE = _re.compile(
                "["
                "\U0001F000-\U0001FFFF"   # 이모지 보충 블록 전체
                "\u2600-\u27BF"           # 잡다한 기호 (☐☑☒ 등 포함)
                "\u2B00-\u2BFF"           # 보충 화살표·기하
                "\u23E9-\u23F3"           # 시계·미디어 기호
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
                        # 인라인 볼드 **text**
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
                repost_tag = '<div class="repost-label">↩ 리포스트</div>' if is_repost else ""
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
                      <span class="feed-engagement">좋아요 {likes} / 리포스트 {reposts}</span>
                    </div>
                    {repost_tag}
                    <div class="feed-content">{content}</div>
                  </div>
                </div>""")

            # 스탠스 분포 바
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
              <h2>PM 브리프</h2>
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
/* 헤더 — wkhtmltopdf 호환: gradient 대신 단색, opacity 미사용 */
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
/* feed: table 레이아웃으로 flex 대체 */
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
  <h1>MiroFish 시뮬레이션 보고서</h1>
  <div class="meta">주제: {_html_mod.escape(topic)} | {datetime.now().strftime("%Y-%m-%d %H:%M")}</div>
  <div class="stats">
    <div class="stat"><span class="val">{num_personas}</span><span class="lbl">페르소나</span></div>
    <div class="stat"><span class="val">{num_rounds}</span><span class="lbl">라운드</span></div>
    <div class="stat"><span class="val">{total_posts}</span><span class="lbl">총 게시물</span></div>
    <div class="stat"><span class="val">{stance_counts.get('supportive',0)}</span><span class="lbl">지지</span></div>
    <div class="stat"><span class="val">{stance_counts.get('opposing',0)}</span><span class="lbl">반대</span></div>
    <div class="stat"><span class="val">{stance_counts.get('neutral',0)}</span><span class="lbl">중립</span></div>
  </div>
</div>
<div class="content">
  {brief_section}
  <div class="section">
    <h2>분석 보고서</h2>
    <div class="report-text">{md_to_html(report)}</div>
  </div>
  <div class="section">
    <h2>시뮬레이션 피드 ({total_posts}개)</h2>
    <div class="stance-bar">{''.join(stance_bar_parts)}</div>
    {''.join(feed_html_parts)}
  </div>
</div>
<footer>Generated by Strata Sync Bot · MiroFish</footer>
</body>
</html>"""

            filepath.write_text(html, encoding="utf-8")
            self._log(f"[MiroFish] HTML 보고서 저장: {filepath}")
            return filepath

        def _upload_file_to_slack(filepath: Path, channel: str, thread_ts: str | None, title: str = "") -> bool:
            """파일을 Slack에 업로드. 성공 여부 반환."""
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
                self._log(f"[MiroFish] HTML 업로드 완료: {filename}")
                return True
            except Exception as e:
                self._log(f"[MiroFish] HTML 업로드 실패: {e}")
                return False

        def _format_and_post_miro(result: dict, topic: str, num_personas: int, num_rounds: int,
                                   say, channel: str, thread_ts: str | None, think_ts: str | None,
                                   report_only: bool, label: str = "", pm_brief: str | None = None):
            """MiroFish 결과를 Slack에 게시 + 볼트 자동 저장."""
            def update(msg: str, blocks: list | None = None):
                if think_ts:
                    try:
                        kw: dict = {"channel": channel, "ts": think_ts, "text": msg}
                        if blocks:
                            kw["blocks"] = blocks
                        web.chat_update(**kw)
                    except Exception as _ue:
                        self._log(f"[MiroFish] chat_update 실패 (무시): {_ue}")

            feed   = result.get("feed", [])
            report = result.get("report", "")

            # ── Slack 요약 메시지 (간결) ─────────────────────────────────────
            prefix = f"*{label}* " if label else ""
            stance_counts: dict[str, int] = {}
            for p in feed:
                s = p.get("stance", "neutral")
                stance_counts[s] = stance_counts.get(s, 0) + 1

            stance_summary = "  ".join(
                f"{STANCE_KO.get(s, s)} {c}건"
                for s, c in sorted(stance_counts.items(), key=lambda x: -x[1])
            ) or "—"

            # 보고서에서 첫 의미있는 단락(최대 400자)만 미리보기로 추출
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
                    "text": {"type": "plain_text", "text": f"🐟  {title_prefix}MiroFish 시뮬레이션 완료", "emoji": True},
                },
                {
                    "type": "section",
                    "text": {"type": "mrkdwn", "text": f"*{topic}*"},
                },
                {
                    "type": "section",
                    "fields": [
                        {"type": "mrkdwn", "text": f"*페르소나*\n{num_personas}명"},
                        {"type": "mrkdwn", "text": f"*라운드*\n{num_rounds}회"},
                        {"type": "mrkdwn", "text": f"*게시물*\n{len(feed)}개"},
                        {"type": "mrkdwn", "text": f"*반응 분포*\n{stance_summary}"},
                    ],
                },
                {
                    "type": "context",
                    "elements": [{"type": "mrkdwn", "text": "📄 결과 보고서 생성 중..."}],
                },
            ]
            slack_summary = f"🐟 MiroFish 완료: {topic} ({len(feed)}개 반응 · {stance_summary})"
            update(slack_summary, blocks=summary_blocks)

            # ── HTML 보고서 생성 + Slack 업로드 (비동기) ────────────────────
            def _async_post():
                try:
                    # 후속 시뮬레이션 제안
                    # fallback 보고서(API 키 없음 등)는 오류 맥락을 LLM에 노출하지 않음
                    _is_fallback = "API 키가 없어" in report or not report.strip()
                    _report_summary = "" if _is_fallback else report[:800]
                    followup_prompt = (
                        f"다음 MiroFish 유저 반응 시뮬레이션이 완료됐어:\n"
                        f"주제: {topic}\n"
                        + (f"보고서 요약: {_report_summary}\n\n" if _report_summary else "\n")
                        + f"이 결과를 바탕으로 게임 기획자가 더 깊이 탐구할 수 있는 "
                        f"파생 시뮬레이션 주제 2-3개를 짧게 제안해줘.\n"
                        f"각 제안은 한 줄로, 실제로 입력할 수 있는 🐟 명령어 형식으로."
                    )
                    followup, _ = ask_via_electron(followup_prompt, tag="chief")
                    if followup:
                        say(
                            blocks=[
                                {
                                    "type": "section",
                                    "text": {
                                        "type": "mrkdwn",
                                        "text": f"*💡  후속 시뮬레이션 제안*\n\n{followup.strip()}",
                                    },
                                },
                            ],
                            text=f"💡 후속 시뮬레이션 제안\n\n{followup.strip()}",
                            thread_ts=thread_ts,
                        )
                except Exception as _e:
                    self._log(f"[MiroFish] 후속 제안 실패: {_e}")

                try:
                    # HTML 생성 → PDF 변환 → Slack 업로드 (HTML은 로컬 백업)
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
                        self._log(f"[MiroFish] PDF 변환 실패 ({type(_pdf_e).__name__}: {_pdf_e}) → HTML 업로드")
                        upload_path = html_path
                    _upload_file_to_slack(
                        upload_path, channel, thread_ts,
                        title=f"MiroFish — {topic}"
                    )
                    # 업로드 완료 후 메시지 업데이트
                    ext = upload_path.suffix.upper().lstrip(".")
                    done_blocks = [
                        {
                            "type": "header",
                            "text": {"type": "plain_text", "text": f"🐟  {title_prefix}MiroFish 시뮬레이션 완료", "emoji": True},
                        },
                        {
                            "type": "section",
                            "text": {"type": "mrkdwn", "text": f"*{topic}*"},
                        },
                        {
                            "type": "section",
                            "fields": [
                                {"type": "mrkdwn", "text": f"*페르소나*\n{num_personas}명"},
                                {"type": "mrkdwn", "text": f"*라운드*\n{num_rounds}회"},
                                {"type": "mrkdwn", "text": f"*게시물*\n{len(feed)}개"},
                                {"type": "mrkdwn", "text": f"*반응 분포*\n{stance_summary}"},
                            ],
                        },
                        {
                            "type": "context",
                            "elements": [{"type": "mrkdwn", "text": f"📎 보고서 {ext} 파일이 아래에 첨부됐어요."}],
                        },
                    ]
                    update(
                        f"🐟 MiroFish 완료: {topic} · {ext} 보고서 첨부",
                        blocks=done_blocks,
                    )
                except Exception as _e:
                    self._log(f"[MiroFish] 보고서 생성 실패: {_e}")

                try:
                    # 볼트 저장
                    saved = save_mirofish_to_vault(topic, report, feed, brief=pm_brief)
                    if saved and saved.get("ok"):
                        fname = saved.get("filename", "")
                        self._log(f"[MiroFish] 볼트 저장 완료: {fname}")
                    elif saved:
                        self._log(f"[MiroFish] 볼트 저장 실패: {saved}")
                    else:
                        self._log("[MiroFish] 볼트 저장 실패 — Electron 미실행 또는 응답 없음")
                except Exception as _e:
                    self._log(f"[MiroFish] 볼트 저장 예외: {_e}")

            threading.Thread(target=_async_post, daemon=True).start()

            # 시뮬레이션 결과를 스레드 히스토리에 저장 → 후속 "요약/분석해줘" 질문 시 컨텍스트 제공
            hist_key = f"{channel}:{thread_ts or 'dm'}"
            summary_for_hist = report[:1500] if len(report) > 1500 else report
            with _conv_history_lock:
                prior = _conv_history.get(hist_key, [])
                _conv_history[hist_key] = (prior + [
                    {"role": "user",      "content": f"[MiroFish 시뮬레이션] 주제: {topic}"},
                    {"role": "assistant", "content": f"[시뮬레이션 완료] 보고서:\n{summary_for_hist}"},
                ])[-40:]

        def _handle_mirofish(query: str, say, channel: str, thread_ts: str | None, image_files: list | None = None):
            """MiroFish 시뮬레이션 요청 처리."""
            # 파라미터 파싱
            personas_m = MIRO_PERSONAS_RE.search(query)
            rounds_m   = MIRO_ROUNDS_RE.search(query)
            num_personas = int(personas_m.group(1)) if personas_m else 5
            num_rounds   = int(rounds_m.group(1))   if rounds_m   else 3
            num_personas = max(3, min(50, num_personas))
            num_rounds   = max(2, min(10, num_rounds))

            # 보고서 전용 모드 — "시뮬 보고서" / "시뮬레이션 보고서" 키워드
            report_only = bool(_re.search(r"시뮬레이션?\s*보고서|시뮬\s*보고서", query))

            # 세그먼트 추출
            seg_m = MIRO_SEGMENT_RE.search(query)
            segment: str | None = seg_m.group(0).strip() if seg_m else None

            # 프리셋 참조 추출: [프리셋:이름]
            preset_m = MIRO_PRESET_RE.search(query)
            preset_personas: list[dict] | None = None
            preset_label = ""
            if preset_m:
                preset_name_raw = preset_m.group(1).strip()
                settings_data = get_electron_settings() or {}
                saved_presets = settings_data.get("presets", [])
                # 이름 퍼지 매칭 (소문자 포함 검색)
                matched = next(
                    (p for p in saved_presets if preset_name_raw.lower() in p.get("name", "").lower()),
                    None,
                )
                if matched:
                    preset_personas = matched.get("personas", []) or None
                    preset_label = f" | 프리셋: {matched['name']}"
                    if preset_personas:
                        num_personas = len(preset_personas)
                    self._log(f"[MiroFish] 프리셋 '{matched['name']}' 적용 ({num_personas}명)")
                else:
                    preset_list = ", ".join(f"'{p.get('name','')}'" for p in saved_presets[:5])
                    say(text=f"🐟 프리셋 `{preset_name_raw}`을 찾을 수 없습니다.\n저장된 프리셋: {preset_list or '없음'}",
                        thread_ts=thread_ts)
                    return

            # A vs B 비교 모드 감지: "주제A vs 주제B"
            vs_m = _re.search(r"(.+?)\s+vs\.?\s+(.+)", query, _re.IGNORECASE)
            is_vs_mode = bool(vs_m)

            # 주제 추출: 트리거 키워드 + 수치 옵션만 제거 (segment는 topic에 유지 — 제거 시 topic이 불완전해짐)
            topic = MIROFISH_RE.sub("", query)
            topic = MIRO_PERSONAS_RE.sub("", topic)
            topic = MIRO_ROUNDS_RE.sub("", topic)
            if preset_m:
                topic = MIRO_PRESET_RE.sub("", topic)
            topic = _re.sub(r"\s*보고서\s*", " ", topic)
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

            self._log(f"[MiroFish] 주제='{topic}' 페르소나={num_personas} 라운드={num_rounds} 세그먼트={segment!r} 프리셋={bool(preset_personas)} vs={is_vs_mode}")

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
                    self._log(f"[MiroFish] RAG 컨텍스트 {len(ctx_parts)}개 문서 주입")

            # 이미지 처리: imageDirectPass 설정에 따라 직접 전달 vs 텍스트 변환
            sim_images: list[dict] | None = None
            if image_files:
                if think_ts:
                    try:
                        web.chat_update(channel=channel, ts=think_ts,
                                        text=f"🐟  *MiroFish*  {topic}\n_🖼️ 이미지 처리 중..._")
                    except Exception as _ue:
                        self._log(f"[MiroFish] chat_update 실패 (무시): {_ue}")
                images_payload = _download_images(image_files)
                if images_payload:
                    image_direct = get_electron_settings() or {}
                    if image_direct.get("imageDirectPass", True):
                        sim_images = images_payload
                        self._log(f"[MiroFish] 이미지 {len(sim_images)}개 직접 전달 모드")
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
                            self._log(f"[MiroFish] 이미지 텍스트 변환 컨텍스트 주입 ({len(desc_answer)}자)")

            # ── PM AI 브리프 생성 ──────────────────────────────────────────
            # 원본 요청 + RAG 문서를 PM AI가 분석 → MiroFish용 구조화된 브리프 생성
            # (raw context를 그대로 넘기는 것보다 의도를 정확히 해석한 브리프가 더 효과적)
            if think_ts:
                try:
                    web.chat_update(channel=channel, ts=think_ts,
                                    text=f"🐟  *MiroFish*  {topic}\n_🧠 브리프 작성 중..._")
                except Exception as _ue:
                    self._log(f"[MiroFish] chat_update 실패 (무시): {_ue}")

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
                    self._log("[MiroFish] API 키 없음 → PM 브리프 생성 건너뜀")
                    _brief_done.set()
                    return
                try:
                    _brief_cli = ClaudeClient(_brief_api_key, _BRIEF_MODEL)
                    _brief_system = "유저 리서치 전문가. MiroFish 시뮬레이션용 구조화 브리프 작성."
                    _brief_result[0] = _brief_cli.complete(_brief_system, "".join(brief_prompt_parts), max_tokens=700)
                    self._log(f"[MiroFish] PM 브리프 생성 완료: {len(_brief_result[0] or '')}자")
                except Exception as _e:
                    self._log(f"[MiroFish] PM 브리프 생성 예외: {_e}")
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
                        self._log(f"[MiroFish] chat_update 실패 (무시): {_ue}")
                if _brief_elapsed >= _BRIEF_TIMEOUT:
                    self._log("[MiroFish] PM 브리프 타임아웃 → raw context 유지")
                    break

            brief_answer = _brief_result[0]
            if brief_answer and brief_answer.strip():
                # 원본 topic이 context 내용으로 대체되지 않도록 명시적 분리 prefix 추가
                context = f"[원본 시뮬레이션 주제: {topic}]\n\n" + brief_answer.strip()[:1150]
                self._log(f"[MiroFish] PM 브리프 → context 교체 ({len(context)}자)")
            else:
                self._log("[MiroFish] PM 브리프 없음 → raw RAG context 유지")

            # 브리프 완료 → 시뮬레이션 전환 알림 (이후 20초 동안 상태 업데이트 없는 공백 방지)
            if think_ts:
                try:
                    web.chat_update(channel=channel, ts=think_ts,
                                    text=f"🐟  *MiroFish*  {topic}\n_⚙️ 페르소나 생성 중..._")
                except Exception as _ue:
                    self._log(f"[MiroFish] chat_update 실패 (무시): {_ue}")

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
                        self._log(f"[MiroFish] chat_update 실패 (무시): {_ue}")

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

            # 시뮬레이션 데이터 수신 후 → 보고서 작성 전 중간 상태 표시
            if result and think_ts:
                try:
                    web.chat_update(
                        channel=channel, ts=think_ts,
                        text=f"🐟  *MiroFish*  {topic}  —  {len(result.get('feed', []))}개 반응 수집\n_📝 보고서 작성 중..._",
                    )
                except Exception:
                    pass

            if not result:
                self._log("[MiroFish] 시뮬레이션 결과 없음 → 실패 알림")
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
            # ("보고서 써줘", "분석해줘", "방향 제안해줘" 같은 요청 동사구 제거)
            # 최종 LLM 생성에는 원본 query 유지 (보고서·분석 등 지시 의미가 필요)
            search_query = _clean_search_query(query)
            if search_query != query:
                self._log(f"[쿼리정제] '{query[:40]}' → '{search_query[:40]}'")

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
                    preset_lines = "  _(아직 저장된 프리셋이 없어요. 렘브란트 맵 Settings > MiroFish 에서 만들 수 있어요)_"
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
                                    "`PvP 업데이트 시뮬 보고서`  — 피드 없이 보고서만\n"
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
                            "elements": [{"type": "mrkdwn", "text": "🔖 볼트 문서에 `#시뮬레이션필요` 태그 → 자동 알림   •   ⏰ 스케줄 자동 실행: Settings > MiroFish"}],
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
            status = "✦ 이미지 분석 중..." if image_files else "✦ 깊게 생각하는 중..."
            thinking = say(text=f"{status}", thread_ts=thread_ts)
            think_ts = (thinking or {}).get("ts")
            progress = ProgressUpdater(
                web, channel, think_ts, name=name, emoji=emoji,
                is_electron=True, log_fn=self._log,
            ) if think_ts else None

            # 이미지가 있으면: 다운로드 → Electron에 직접 전달 (LLM이 이미지 + RAG 문서 함께 분석)
            images_payload: list[dict] = []
            if image_files:
                self._log(f"[Vision] {name}: 이미지 {len(image_files)}개 다운로드 중...")
                images_payload = _download_images(image_files)
                if images_payload:
                    self._log(f"[Vision] {len(images_payload)}개 Electron으로 전달")
                else:
                    self._log("[Vision] 이미지 다운로드 0건 → 텍스트만으로 RAG 폴백")

            self._log(f"[Slack] {name}: {query[:60]}")

            # 명시적 이미지 요청 감지 → /images 검색
            vault_image_paths: list[str] = []
            is_img_req = any(w in query for w in _IMAGE_WORDS)
            if is_img_req:
                # 이미지/동작 단어 제거 → 주제어(캐릭터명 등)만 남김
                img_query = query
                for w in _IMAGE_WORDS + _ACTION_WORDS:
                    img_query = img_query.replace(w, " ")
                img_query = " ".join(img_query.split()).strip("~,. !?") or query
                vault_image_paths = get_images_via_electron(img_query)
                self._log(f"[Image] 명시적 검색 '{img_query[:40]}': {len(vault_image_paths)}개")

            # 스레드별 히스토리 조회 (DM은 channel을 key로 사용)
            hist_key = f"{channel}:{thread_ts or 'dm'}"
            with _conv_history_lock:
                history = list(_conv_history.get(hist_key, []))
            if history:
                self._log(f"[Slack] 히스토리 {len(history)//2}턴 복원")

            claude = None  # 폴백에서 덮어씀, 사용자 기억 갱신에 사용
            # 1순위: Electron /ask — 렘브란트 맵의 BFS RAG + LLM 파이프라인 그대로 사용
            if progress: progress.start("electron")

            # Electron HTTP 준비 확인 (3초 이내 /settings 응답)
            # TCP만 열려있고 HTTP 미응답 = 재시동 중 → 즉시 폴백 (65초 대기 방지)
            if not is_electron_alive():
                if progress:
                    progress.set_message("🔴 샌드박스 맵 앱이 꺼져 있거나 시작 중이에요. Python RAG로 처리 중...")
                self._log("[RAG] Electron HTTP 미응답 (오프라인/재시동) → 폴백")
                answer, auto_image_paths = None, []
            else:
                answer, auto_image_paths = ask_via_electron(query, tag=tag, history=history, images=images_payload or None)
                if answer is None and progress:
                    # 앱은 켜져 있었지만 응답 없음 = 빌드 중 or 타임아웃
                    progress.set_message("⏱️ 앱 응답 시간 초과. Python RAG로 처리 중...")

            if progress: progress.done("electron")
            if answer:
                self._log("[RAG] Electron /ask 성공 (BFS+LLM)")
                if auto_image_paths:
                    self._log(f"[Image] 자동 이미지 {len(auto_image_paths)}개")
                final = answer
            else:
                auto_image_paths = []
                # 폴백: Python 자체 RAG + 서브 에이전트 10개 + Claude
                self._log("[RAG] Electron 미실행 → 서브 에이전트 RAG")
                # 폴백 경로는 세분화된 스텝으로 표시
                if progress:
                    progress._remaining = ["search", "analyze", "webcheck", "answer"]
                # Claude 클라이언트 초기화 (쿼리 리라이팅·멀티쿼리·분석에 공통 사용)
                model = get_model_for_tag(tag)
                live_key = get_anthropic_key(self.cfg) or api_key
                claude = ClaudeClient(live_key, model) if live_key else None
                self._log(f"[모델] {model}")

                # ── 쿼리 리라이팅 (검색 최적화) ──────────────────────────
                if claude:
                    _rewrite_sys = "질문→검색 키워드 변환. 동사·어미·조사 제거, 핵심 명사 중심, 20자 이내. 쿼리만 출력."
                    try:
                        _rewritten = claude.complete(_rewrite_sys, search_query, max_tokens=40).strip()
                        if _rewritten and 3 < len(_rewritten) < 80:
                            self._log(f"[쿼리리라이팅] '{search_query[:40]}' → '{_rewritten[:40]}'")
                            search_query = _rewritten
                    except Exception as _e:
                        self._log(f"[쿼리리라이팅] 실패 (무시): {_e}")

                # 서브 에이전트가 최대 10개 문서를 분석하므로 top_n*2 검색
                fetch_n = max(top_n * 2, 10)
                if progress: progress.start("search")
                results = search_via_electron(search_query, top_n=fetch_n)
                if results is None:
                    results = search_vault(search_query, vault_path, top_n=fetch_n)
                    self._log(f"[RAG] simple search ({len(results)}건)")
                else:
                    self._log(f"[RAG] Electron TF-IDF ({len(results)}건)")

                # 쿼리에 "최신/최근/올해 연도" 가 있으면 날짜 기준 부스팅
                # BM25는 날짜를 모르므로, 최신 문서가 내용이 짧아도 상위에 오도록 보정
                _cur_year = str(datetime.now().year)
                _prev_year = str(datetime.now().year - 1)
                if results and any(w in query for w in ["최신", "최근", _cur_year]):
                    for r in results:
                        d = r.get("date", "")
                        r["_date_boost"] = 2 if _cur_year in d else (1 if _prev_year in d else 0)
                    results.sort(key=lambda r: (-r["_date_boost"], -r.get("score", 0)))
                    self._log(f"[RAG] 최신 요청 → 날짜 부스팅 적용 (top: {results[0].get('date','')})")

                # ── 멀티-쿼리 분해 (복합 질문 → 서브쿼리 병합 + 수렴 조기 종료) ──
                if claude and results and len(query) > 25:
                    _decomp_sys = "질문을 2개의 독립 검색 쿼리로 분해, 줄바꿈 구분, 10자 이내. 단순 질문이면 빈 응답."
                    try:
                        _sub_raw = claude.complete(_decomp_sys, query, max_tokens=60).strip()
                        _sub_queries = [
                            q.strip() for q in _sub_raw.split("\n")
                            if q.strip() and 2 < len(q.strip()) < 60
                        ]
                        if len(_sub_queries) >= 2:
                            self._log(f"[멀티쿼리] 분해: {_sub_queries}")
                            _seen_stems = {r.get("stem") for r in results}
                            _zero_gain_rounds = 0  # 수렴 조기 종료 카운터
                            for _sq in _sub_queries:
                                _prev_count = len(_seen_stems)
                                _sub_res = search_via_electron(_sq, top_n=5) or search_vault(_sq, vault_path, top_n=5)
                                for _r in (_sub_res or []):
                                    if _r.get("stem") not in _seen_stems:
                                        results.append(_r)
                                        _seen_stems.add(_r.get("stem"))
                                # 수렴 체크: 새 문서 없으면 카운터 증가 → 2회 연속이면 조기 종료
                                if len(_seen_stems) == _prev_count:
                                    _zero_gain_rounds += 1
                                    if _zero_gain_rounds >= 2:
                                        self._log("[멀티쿼리] 수렴 감지 → 조기 종료")
                                        break
                                else:
                                    _zero_gain_rounds = 0
                            self._log(f"[멀티쿼리] 병합 후 {len(results)}건")
                    except Exception as _e:
                        self._log(f"[멀티쿼리] 실패 (무시): {_e}")

                # ── 핫스코어 재랭킹 (OpenViking memory_lifecycle 기반) ──────
                # 자주/최근 참조된 문서에 보너스를 부여해 재정렬
                if results:
                    results = apply_hotness_rerank(results)
                    self._log(f"[핫스코어] 재랭킹 완료 (top: {results[0].get('title','')[:30]})")

                if progress: progress.done("search")

                # ── 비용 제어 설정 읽기 ──────────────────────────────────
                _cost_settings = get_electron_settings() or {}
                _self_review_enabled = _cost_settings.get("selfReview", True)
                _n_agents = int(_cost_settings.get("nAgents", 6))

                # ── 서브 에이전트 문서 분석 ──────────────────────────────
                if progress: progress.start("analyze")
                if claude and results:
                    rag_context = build_multi_agent_context(
                        claude, search_query, results, n_agents=_n_agents, log_fn=self._log
                    )
                else:
                    rag_context = build_rag_context(results, max_chars=6000)
                if progress: progress.done("analyze")

                # ── 웹 검색: AI가 스스로 필요 판단 ─────────────────────
                # Claude가 웹 검색 필요 여부를 먼저 판단 (vault 결과 부족하거나 최신 정보 필요 시)
                web_ctx = ""
                if progress: progress.start("webcheck")
                if claude:
                    decision_sys = '볼트 문서로 충분히 답할 수 있으면 NO, 외부 최신 정보가 필요하면 YES. 형식: "NO" 또는 "YES: <검색어>"'
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
                            self._log(f"[웹검색] 메인 에이전트 결정: \"{search_q}\" 검색 중...")
                            if progress: progress.done("webcheck"); progress.start("websearch")
                            web_results = search_web(search_q or query, max_results=5)
                            if web_results:
                                web_ctx = build_web_context(web_results)
                                self._log(f"[웹검색] {len(web_results)}건 확보")
                            else:
                                self._log("[웹검색] 결과 없음")
                        else:
                            self._log("[웹검색] 메인 에이전트 판단: 볼트 정보 충분 → 스킵")
                            if progress: progress.done("webcheck")
                    except Exception as e:
                        self._log(f"[웹검색 판단] 오류: {e} → 스킵")
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
                        combined += f"\n\n---\n## 📌 이 사용자와의 이전 대화 기억\n{_user_memory[user_id]}\n---"
                    if rag_context:
                        combined += f"\n\n{rag_context}"
                    if web_ctx:
                        combined += f"\n\n{web_ctx}"
                    # 페르소나별 분석 프레임
                    _PERSONA_ANALYSIS_FRAMES = {
                        "chief": (
                            "[PM 분석 관점] ① 프로젝트 방향·목표 정합성 "
                            "② 리소스·일정·우선순위 실현 가능성 ③ 주요 리스크와 완화 방안"
                        ),
                        "art": (
                            "[아트 분석 관점] ① 스타일·비주얼 일관성·톤앤매너 영향 "
                            "② 플레이어 시각 메시지와 감성 ③ 기술 구현 가능성과 퀄리티 균형"
                        ),
                        "spec": (
                            "[기획 분석 관점] ① 밸런스·플레이어 경험·재미 요소 영향 "
                            "② 기존 시스템 연계성·의존성 ③ 유저 직관성과 납득 가능성"
                        ),
                        "tech": (
                            "[기술 분석 관점] ① 기술 부채·성능·확장성 영향 "
                            "② 구현 복잡도와 테스트 가능성 ③ 기존 코드베이스 호환성"
                        ),
                    }
                    if tag in _PERSONA_ANALYSIS_FRAMES:
                        combined += f"\n\n{_PERSONA_ANALYSIS_FRAMES[tag]}"
                    combined += (
                        "\n\n[답변 지침]\n"
                        "• 사고 순서: 핵심 의도 파악 → 문서 근거 확인 → 인사이트 도출 → 불확실 내용은 명시적 구분\n"
                        "• 문서 간 상충 시: 명시적으로 지적하고 최신 확인 권고\n"
                        "• 말투: 항상 전문적인 존댓말(~합니다/~습니다 체)\n"
                        "• 사실 준수: 볼트 문서·웹 결과·사용자 발화 기반만. 미확인 내용은 '검색된 문서에서 확인되지 않습니다'로 명시. '볼트 문서' 또는 '검색된 문서'로 표현."
                    )
                    try:
                        answer = claude.complete(combined, query, max_tokens=2000, cache_system=True)
                        # ── 2-pass 자기 검토 (selfReview 설정으로 ON/OFF) ──
                        if _self_review_enabled:
                            _review_sys = (
                                "[답변]이 [질문]을 충분히 다뤘는지 검토하세요.\n"
                                "빠진 핵심 관점이 있으면 [보완]에 추가. 충분하면 [최종답변]만 출력.\n"
                                "형식: [최종답변]\\n(내용)\\n\\n[보완]\\n(내용, 없으면 생략)"
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
                # 참조된 문서 접근 기록 → 핫스코어 학습
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

            # ── 보고서 인텐트 → PDF 비동기 생성 + Slack 업로드 ─────────────────
            if REPORT_INTENT_RE.search(query) and answer and not answer.startswith("❌"):
                import threading as _threading
                def _async_report_pdf():
                    try:
                        title_m = _re.search(r'["\u300c\u300e\u201c](.+?)["\u300d\u300f\u201d]', query)
                        report_title = title_m.group(1) if title_m else (query[:40].strip() or "보고서")
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
                            self._log(f"[보고서] PDF 변환 완료: {pdf_path.name}")
                            upload_path = pdf_path
                        except Exception as _pdf_e:
                            self._log(f"[보고서] PDF 변환 실패 ({type(_pdf_e).__name__}: {_pdf_e}) → HTML 업로드")
                            upload_path = html_path
                        _upload_file_to_slack(upload_path, channel, thread_ts, title=f"📄 {report_title}")
                    except Exception as _e:
                        self._log(f"[보고서] PDF 생성 실패: {_e}")
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

        # ── 스케줄 체크 스레드 ───────────────────────────────────────────────
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
                        self._log(f"[스케줄] 자동 실행: '{sched_topic}' {sched_np}명 {sched_nr}라운드")

                        def _run_sched(t=sched_topic, np=sched_np, nr=sched_nr):
                            try:
                                thinking = web.chat_postMessage(
                                    channel=notify_channel,
                                    text=f"🐟 *[자동 스케줄] MiroFish 시뮬레이션 시작*\n주제: _{t}_\n페르소나: {np}명 | 라운드: {nr}회\n\n_⏳ 실행 중..._",
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
                                                            text=f"🐟 [자동 스케줄] 시뮬레이션 실패: _{t}_")
                                        except Exception as _ue:
                                            self._log(f"[스케줄] chat_update 실패 (무시): {_ue}")
                            except Exception as e:
                                self._log(f"[스케줄] 실행 오류: {e}")

                        threading.Thread(target=_run_sched, daemon=True).start()

                except Exception as e:
                    self._log(f"[스케줄] 체크 오류: {e}")
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
                        self._log(f"[태그스캔] #시뮬레이션필요 {len(found)}건 감지")
                except Exception as e:
                    self._log(f"[태그스캔] 오류: {e}")
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
        self._log("🟢 Slack 봇 시작 — 모델: 렘브란트 맵 페르소나 설정 따름")
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
        ttk.Label(slack_cfg, text="알림 채널 (스케줄·태그):").grid(row=3, column=0, sticky="w", padx=6, pady=3)
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
        self._log(f"💾 새 인스턴스 config 생성: {name}")
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
        self._log("💾 설정 저장됨")

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
            self._log("⏹ 타이머 중지")
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
            self._log(f"⏱ 타이머 시작 — {h}시간 주기")

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
        self._log(f"🗑 키워드 삭제: {kw}")

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
