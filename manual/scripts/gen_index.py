"""
_index.md 생성 스크립트
────────────────────────────────────────────────────────
기능:
  active/ 폴더의 모든 마크다운 파일을 날짜 역순으로 정렬하여
  월별 그룹핑된 인덱스 문서(_index.md)를 생성한다.

사용법:
    python gen_index.py <vault_active_dir>

예시:
    python gen_index.py ./vault/active/

의존 패키지:
    pip install PyYAML
"""

import os
import sys
import yaml
from datetime import datetime
from collections import defaultdict

TYPE_ICON = {
    "spec":      "📐",
    "decision":  "✅",
    "meeting":   "🗣️",
    "guide":     "📖",
    "reference": "📄",
}


def load_frontmatter(text: str) -> dict:
    if text.startswith("---"):
        end = text.find("---", 3)
        if end != -1:
            try:
                return yaml.safe_load(text[3:end]) or {}
            except Exception:
                pass
    return {}


def run(active_dir: str):
    entries = []

    for fname in os.listdir(active_dir):
        if not fname.endswith(".md") or fname == "_index.md":
            continue
        path = os.path.join(active_dir, fname)
        with open(path, encoding="utf-8") as f:
            text = f.read()
        fm = load_frontmatter(text)
        stem = os.path.splitext(fname)[0]
        title = fm.get("title", stem)
        date_str = str(fm.get("date", "1970-01-01"))
        doc_type = fm.get("type", "reference")
        tags = fm.get("tags", [])

        try:
            dt = datetime.strptime(date_str[:10], "%Y-%m-%d")
        except Exception:
            dt = datetime(1970, 1, 1)

        entries.append({
            "stem": stem, "title": title, "date": dt,
            "date_str": date_str[:10], "type": doc_type, "tags": tags,
        })

    entries.sort(key=lambda x: x["date"], reverse=True)

    # 월별 그룹핑
    by_month: dict[str, list] = defaultdict(list)
    for e in entries:
        month = e["date"].strftime("%Y-%m")
        by_month[month].append(e)

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

    out_path = os.path.join(active_dir, "_index.md")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    print(f"_index.md 생성 완료: {len(entries)}개 항목 → {out_path}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    run(sys.argv[1])
