"""
Wiki 링크 2차 강화 스크립트 (strengthen_links.py)
────────────────────────────────────────────────────────
기능:
  1. 깨진 브래킷 수정   — [[[[제목]]  →  [[제목]]
  2. 도메인 허브 링크   — 본문에 엔티티명 등장 시 허브 문서 링크 주입
  3. 계층 부모 링크     — 제목 구조에서 상위 문서 자동 링크
  4. Ghost → Real 교체  — 고PageRank ghost 노드를 실제 허브로 대체
  5. Fallback 링크      — 위 모든 방법 후에도 링크 없는 파일에 태그 허브 링크 삽입

사용법:
    python strengthen_links.py <vault_active_dir>

예시:
    python strengthen_links.py ./vault/active/

의존 패키지:
    pip install PyYAML
"""

import os
import re
import sys
import yaml

# ── 설정 ─────────────────────────────────────────────────────────────────────

# 핵심 엔티티명 → 허브 파일 stem 매핑
# 팀/프로젝트 상황에 맞게 수정
ENTITY_HUB: dict[str, str] = {
    # "엔티티명": "허브_파일_stem",
    # ── 캐릭터 허브 ────────────────────────────────────────────────────────
    # 본문에 캐릭터명이 등장하는 파일에 해당 캐릭터 허브 문서 링크를 자동 주입
    # (Confluence ID 접미사로 인해 단축명 → full stem 연결)
    # "캐릭터명": "허브_파일_stem" 형태로 매핑 추가
    "캐릭터E":         "03. 캐릭터 _ 캐릭터E_342982926",
    "캐릭터B":         "04. 캐릭터 _ 캐릭터B _ 리뉴얼_653564141",
    "캐릭터F":       "05. 캐릭터 _ 캐릭터F _ 리뉴얼_658869554",
    "캐릭터G":         "06. 캐릭터 _ 캐릭터G_416014685",
    "미니626":        "09. 캐릭터 _ 미니626_435550254",
    "캐릭터H":           "12. 캐릭터 _ 캐릭터H_467470414",
    "캐릭터I":         "13. 캐릭터 _ 캐릭터I_634228037",
    "캐릭터J 블레이드": "14. 캐릭터 _ 캐릭터J 블레이드_584041454",
    "캐릭터C":           "캐릭터C(Wolyoung)_652885523",
    # ── 시스템 허브 ────────────────────────────────────────────────────────
    "캐릭터 구현 현황": "캐릭터 구현 현황_550050211",
}

# Ghost → Real 매핑 (고PageRank ghost 노드 교체용)
GHOST_TO_REAL: dict[str, str] = {
    # '[[ghost]]': '[[실제_파일|ghost]]',
}

# 태그별 대표 허브 (fallback 링크용)
TAG_HUB: dict[str, str] = {
    # "태그명": "대표_허브_파일_stem",
    "art":      "캐릭터 구현 현황_550050211",
    "chief":    "캐릭터 구현 현황_550050211",
    "level":    "캐릭터 구현 현황_550050211",
    "tech":     "캐릭터 구현 현황_550050211",
    "guide":    "캐릭터 구현 현황_550050211",
}

# ── 유틸 ──────────────────────────────────────────────────────────────────────

def load_frontmatter(text: str) -> dict:
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            try:
                return yaml.safe_load(text[3:end]) or {}
            except Exception:
                pass
    return {}


def has_links(text: str) -> bool:
    return bool(re.search(r"\[\[", text))


def fix_broken_brackets(text: str) -> str:
    """[[[[ 4중 이상 브래킷 → [[ 2중 브래킷으로 수정"""
    return re.sub(r"\[{3,}([^\[\]]+?)\]{2}", r"[[\1]]", text)


def inject_entity_links(text: str) -> str:
    """본문에 엔티티명 등장 시 허브 링크 주입"""
    for entity, hub_stem in ENTITY_HUB.items():
        if entity in text and f"[[{hub_stem}" not in text:
            # 파일 하단에 링크 추가
            link = f"[[{hub_stem}|{entity}]]"
            if "## 관련 문서" in text:
                text = text.replace("## 관련 문서\n", f"## 관련 문서\n- {link}\n")
            else:
                text = text.rstrip() + f"\n\n## 관련 문서\n- {link}\n"
    return text


def inject_ghost_to_real(text: str) -> str:
    for ghost, real in GHOST_TO_REAL.items():
        text = text.replace(ghost, real)
    return text


def inject_fallback(text: str, tags: list) -> str:
    """링크가 전혀 없으면 태그 허브 링크 추가"""
    if has_links(text):
        return text
    for tag in (tags or []):
        hub = TAG_HUB.get(tag)
        if hub:
            link = f"[[{hub}]]"
            text = text.rstrip() + f"\n\n## 관련 문서\n- {link}\n"
            return text
    return text


# ── 메인 ──────────────────────────────────────────────────────────────────────

def run(active_dir: str):
    md_files = [f for f in os.listdir(active_dir) if f.endswith(".md")]
    print(f"대상 파일: {len(md_files)}개")
    updated = 0

    for fname in md_files:
        path = os.path.join(active_dir, fname)
        with open(path, encoding="utf-8") as f:
            original = f.read()

        fm = load_frontmatter(original)
        tags = fm.get("tags", [])

        text = original
        text = fix_broken_brackets(text)
        text = inject_ghost_to_real(text)
        text = inject_entity_links(text)
        text = inject_fallback(text, tags)

        if text != original:
            with open(path, "w", encoding="utf-8") as f:
                f.write(text)
            updated += 1

    no_link = 0
    for fname in md_files:
        with open(os.path.join(active_dir, fname), encoding="utf-8") as f:
            if not has_links(f.read()):
                no_link += 1
    print(f"업데이트: {updated}개 | 링크 없는 파일: {no_link}개")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    run(sys.argv[1])
