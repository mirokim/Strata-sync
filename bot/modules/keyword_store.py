"""
keyword_store.py — keyword_index.json CRUD operations
"""
import json
from datetime import datetime
from pathlib import Path

from .constants import KEYWORD_INDEX_REL_PATH


DEFAULT_STORE = {
    "version": 1,
    "updated": "",
    "keywords": {}
    # "keyword": {"hub_stem": "...", "display": "...", "added": "YYYY-MM-DD", "hit_count": 0}
}


class KeywordStore:
    def __init__(self, vault_path: str, rel_path: str = KEYWORD_INDEX_REL_PATH):
        self.store_path = Path(vault_path) / rel_path
        self.data: dict = DEFAULT_STORE.copy()
        self.data["keywords"] = {}

    def load(self) -> bool:
        if not self.store_path.exists():
            return False
        try:
            raw = self.store_path.read_text(encoding="utf-8")
            self.data = json.loads(raw)
            return True
        except Exception:
            return False

    def save(self):
        self.store_path.parent.mkdir(parents=True, exist_ok=True)
        self.data["updated"] = datetime.now().isoformat(timespec="seconds")
        self.store_path.write_text(
            json.dumps(self.data, ensure_ascii=False, indent=2),
            encoding="utf-8"
        )

    def get_keywords(self) -> dict:
        return self.data.get("keywords", {})

    def upsert(self, keyword: str, hub_stem: str, display: str = ""):
        today = datetime.now().strftime("%Y-%m-%d")
        existing = self.data["keywords"].get(keyword)
        if existing:
            existing["hub_stem"] = hub_stem
            existing["display"] = display or keyword
        else:
            self.data["keywords"][keyword] = {
                "hub_stem": hub_stem,
                "display": display or keyword,
                "added": today,
                "hit_count": 0,
            }

    def remove(self, keyword: str):
        self.data["keywords"].pop(keyword, None)

    def increment_hit(self, keyword: str, count: int = 1):
        kw = self.data["keywords"].get(keyword)
        if kw:
            kw["hit_count"] = kw.get("hit_count", 0) + count

    def to_inject_map(self) -> dict:
        """inject_keywords.py 형식: keyword → (hub_stem, display)"""
        return {
            kw: (info["hub_stem"], info.get("display", kw))
            for kw, info in self.data["keywords"].items()
            if info.get("hub_stem")
        }

    def count(self) -> int:
        return len(self.data.get("keywords", {}))
