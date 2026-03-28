"""
Wiki 링크 1차 강화 스크립트 (enhance_wikilinks.py)
────────────────────────────────────────────────────────
기능:
  1. 클러스터 링크 주입 — 같은 태그를 가진 문서끼리 상호 링크
  2. 제목 매칭 링크   — 본문에 등장하는 다른 문서 제목을 [[wikilink]]로 변환
  3. Ghost 노드 링크  — 파일이 없는 [[링크]]를 실제 파일로 리다이렉트

사용법:
    python enhance_wikilinks.py <vault_active_dir>

예시:
    python enhance_wikilinks.py ./vault/active/

의존 패키지:
    pip install PyYAML
"""

import os
import re
import sys
import yaml

# ── 설정: Ghost → Real 매핑 ────────────────────────────────────────────────
# 파일이 없는 ghost 링크를 실제 허브 파일로 교체
# 팀 상황에 맞게 수정
GHOST_TO_REAL: dict[str, str] = {
    # '[[ghost 링크 텍스트]]': '[[실제_파일_stem|표시 텍스트]]',
    # 예시:
    # '[[아트 파이프라인]]': '[[아트_허브|아트 파이프라인]]',
}

# ── 유틸 ──────────────────────────────────────────────────────────────────────

def load_frontmatter(text: str) -> dict:
    if text.startswith("---"):
        end = text.find("---", 3)
        if end != -1:
            try:
                return yaml.safe_load(text[3:end]) or {}
            except Exception:
                pass
    return {}


def protect_links(text: str) -> tuple[str, list[str]]:
    """기존 [[...]] 블록을 placeholder로 치환하여 보호"""
    links: list[str] = []
    def replacer(m):
        idx = len(links)
        links.append(m.group(0))
        return f"\x00LINK{idx}\x00"
    return re.sub(r"\[\[.*?\]\]", replacer, text), links


def restore_links(text: str, links: list[str]) -> str:
    for i, link in enumerate(links):
        text = text.replace(f"\x00LINK{i}\x00", link)
    return text


def inject_cluster_links(content: str, related: list[str]) -> str:
    """파일 하단에 ## 관련 문서 섹션 추가"""
    marker = "## 관련 문서"
    if marker in content:
        return content  # 이미 있으면 스킵
    links = "\n".join(f"- [[{stem}]]" for stem in related)
    return content.rstrip() + f"\n\n{marker}\n{links}\n"


def inject_title_links(content: str, title_map: dict[str, str]) -> str:
    """본문에 등장하는 다른 문서 제목을 wikilink로 변환"""
    protected, saved = protect_links(content)
    for title, stem in sorted(title_map.items(), key=lambda x: -len(x[0])):
        pattern = r"(?<!\[)" + re.escape(title) + r"(?!\])"
        protected = re.sub(
            pattern,
            f"[[{stem}|{title}]]" if stem != title else f"[[{title}]]",
            protected,
            count=1  # 첫 번째 출현만 변환
        )
    return restore_links(protected, saved)


def apply_ghost_replacements(content: str) -> str:
    for ghost, real in GHOST_TO_REAL.items():
        content = content.replace(ghost, real)
    return content


# ── 메인 ──────────────────────────────────────────────────────────────────────

def run(active_dir: str):
    md_files = [f for f in os.listdir(active_dir) if f.endswith(".md")]
    print(f"대상 파일: {len(md_files)}개")

    # 메타데이터 수집
    meta: dict[str, dict] = {}
    for fname in md_files:
        path = os.path.join(active_dir, fname)
        with open(path, encoding="utf-8") as f:
            text = f.read()
        fm = load_frontmatter(text)
        stem = os.path.splitext(fname)[0]
        meta[stem] = {"tags": fm.get("tags", []), "title": fm.get("title", stem), "text": text}

    # 태그별 그룹
    tag_groups: dict[str, list[str]] = {}
    for stem, info in meta.items():
        for tag in (info["tags"] or []):
            tag_groups.setdefault(tag, []).append(stem)

    # 제목 → stem 매핑 (제목이 stem과 다른 경우)
    title_map = {info["title"]: stem for stem, info in meta.items() if info["title"] != stem}

    updated = 0
    for stem, info in meta.items():
        original = info["text"]
        text = original

        # 1. Ghost → Real 교체
        text = apply_ghost_replacements(text)

        # 2. 제목 매칭 링크
        other_titles = {t: s for t, s in title_map.items() if s != stem}
        if other_titles:
            text = inject_title_links(text, other_titles)

        # 3. 클러스터 링크
        related = []
        for tag in (info["tags"] or []):
            for other in tag_groups.get(tag, []):
                if other != stem and other not in related:
                    related.append(other)
        if related:
            text = inject_cluster_links(text, related[:10])  # 최대 10개

        if text != original:
            with open(os.path.join(active_dir, f"{stem}.md"), "w", encoding="utf-8") as f:
                f.write(text)
            updated += 1

    print(f"업데이트: {updated}개")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    run(sys.argv[1])
