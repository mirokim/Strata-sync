"""
index_generator.py — index_YYYYMMDD.md 생성 (gen_index.py 통합)
"""
import os
import re
import yaml
from datetime import datetime
from collections import defaultdict
from pathlib import Path

TYPE_ICON = {
    "spec":      "📐",
    "decision":  "✅",
    "meeting":   "🗣️",
    "guide":     "📖",
    "reference": "📄",
}


def generate_index(active_dir: str, log_fn=print) -> str | None:
    """active_YYYYMMDD/ 폴더에 index_YYYYMMDD.md 생성, 경로 반환"""
    folder = Path(active_dir)
    if not folder.exists():
        return None

    entries = []
    for f in folder.iterdir():
        if not f.suffix == ".md" or f.stem.startswith("index_"):
            continue
        try:
            raw = f.read_text(encoding="utf-8")
        except Exception:
            continue

        fm = {}
        if raw.startswith("---"):
            end = raw.find("\n---", 3)
            if end != -1:
                try:
                    fm = yaml.safe_load(raw[3:end]) or {}
                except Exception:
                    pass

        stem = f.stem
        title = str(fm.get("title", stem))
        date_str = str(fm.get("date", "1970-01-01"))[:10]
        doc_type = str(fm.get("type", "reference"))
        tags = fm.get("tags") or []

        try:
            dt = datetime.strptime(date_str, "%Y-%m-%d")
        except Exception:
            dt = datetime(1970, 1, 1)

        entries.append({"stem": stem, "title": title, "date": dt,
                         "date_str": date_str, "type": doc_type, "tags": tags})

    entries.sort(key=lambda x: x["date"], reverse=True)

    by_month: dict = defaultdict(list)
    for e in entries:
        by_month[e["date"].strftime("%Y-%m")].append(e)

    lines = [
        "---",
        "date: " + datetime.today().strftime("%Y-%m-%d"),
        "type: guide",
        "status: active",
        "tags: []",
        "---",
        "",
        "# 문서 인덱스",
        "",
        f"> 총 {len(entries)}개 문서 | 날짜 역순",
        "",
    ]

    for month in sorted(by_month.keys(), reverse=True):
        lines.append(f"## {month}")
        lines.append("")
        for e in by_month[month]:
            icon = TYPE_ICON.get(e["type"], "📄")
            tag_str = " ".join(f"`{t}`" for t in (e["tags"] or []))
            display = e["title"] if e["title"] != e["stem"] else e["stem"]
            lines.append(f"- {icon} [[{e['stem']}|{display}]] {tag_str} `{e['date_str']}`")
        lines.append("")

    m = re.search(r"(\d{8})", folder.name)
    stamp = m.group(1) if m else datetime.now().strftime("%Y%m%d")
    out_path = folder / f"index_{stamp}.md"
    out_path.write_text("\n".join(lines), encoding="utf-8")
    log_fn(f"  index_{stamp}.md 생성: {len(entries)}개 항목")
    return str(out_path)
