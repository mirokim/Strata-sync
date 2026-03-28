#!/usr/bin/env python3
"""
strengthen_links.py — §8 Wiki링크 2차 강화

8.1 깨진 브래킷 수정   — [[[stem]]] → [[stem]] 패턴 정규화
8.2 도메인 허브 링크   — ENTITY_HUB 기반 본문 내 엔티티명 → 허브 링크 (inject_keywords와 연동)
8.3 Ghost→Real 교체   — 파일 없는 [[broken_stem]] → 실제 stem prefix 매칭으로 자동 교체
8.4 태그 Fallback 링크 — 위 모든 단계 후에도 링크 없는 파일 → TAG_HUB 강제 주입
8.5 Archive Dead Link — .archive/ 이동된 파일 참조 링크 active에서 제거

사용법:
  python strengthen_links.py <active_dir> [--archive <archive_dir>] [--verbose]
"""

import re
import sys
import argparse
from pathlib import Path
from collections import Counter, defaultdict


# ── §8.2 도메인 허브 맵 ──────────────────────────────────────────────
# 본문 텍스트에 해당 키워드가 있으면 허브 링크 주입
# (inject_keywords.py 에서 이미 처리된 것과 겹치지 않게, 더 짧은 alias 위주)
ENTITY_HUB: dict[str, str] = {
    # 캐릭터 단축 alias (inject_keywords에 없는 것)
    "다이잔 쇼군":    "416014685_06_ 캐릭터 _ 다이잔",
    "바도스 블레이드": "584041454_14_ 캐릭터 _ 바도스 블레이드",
    # 시스템 단축
    "점령전 테스트":   "681184425_점령전 테스트_2026_03_11",
    "난투전 테스트":   "642329459_난투전 테스트_2025_12_16",
}

# ── §8.4 태그 기반 Fallback 허브 ─────────────────────────────────────
TAG_HUB: dict[str, str] = {
    'chief':     'chief persona',
    'meeting':   'chief persona',
    'character': '_index',
    'gameplay':  '_index',
    'art':       '_index',
    'tech':      '_index',
    'spec':      '_index',
    'guide':     '_index',
    'world':     '_index',
    'reference': '_index',
    'sound':     '_index',
    'data':      '_index',
}

# 허브 링크 삽입 위치 (## 개요 섹션 직전)
RELATED_SECTION = '## 관련 문서'


def split_frontmatter(content: str) -> tuple[str, str]:
    if content.startswith('---'):
        end = content.find('\n---\n', 4)
        if end != -1:
            return content[:end + 5], content[end + 5:]
    return '', content


def get_tags(fm: str) -> list[str]:
    m = re.search(r'tags:\s*\[([^\]]*)\]', fm)
    if not m:
        return []
    return [t.strip() for t in m.group(1).split(',') if t.strip()]


def protect_links(body: str) -> tuple[str, dict]:
    """기존 [[...]] 를 placeholder로 치환."""
    placeholders = {}
    counter = [0]
    def repl(m):
        counter[0] += 1
        key = f'\x00WL{counter[0]}\x00'
        placeholders[key] = m.group(0)
        return key
    body_p = re.sub(r'\[\[[^\]]+\]\]', repl, body)
    return body_p, placeholders


def restore_links(body_p: str, placeholders: dict) -> str:
    for key, orig in placeholders.items():
        body_p = body_p.replace(key, orig)
    return body_p


# ── §8.1: 깨진 브래킷 정규화 ──────────────────────────────────────────
def fix_broken_brackets(content: str) -> tuple[str, int]:
    """[[[stem]]] → [[stem]] 수정. (new_content, count) 반환."""
    # 4중 이상 대괄호만 수정 (3중은 [날짜] 접두사 패턴으로 유효)
    new, n = re.subn(r'\[\[\[\[([^\[\]]+)\]\]', r'[[\1]]', content)
    return new, n


# ── §8.3: Ghost→Real prefix 매칭 ─────────────────────────────────────
def build_prefix_map(all_stems: set) -> dict:
    """stem → 실제 stem 매핑 (prefix 기반 빠른 조회용)."""
    prefix_map = {}
    for stem in all_stems:
        # 숫자ID_ 제거한 형태도 prefix로 등록
        clean = re.sub(r'^\d+_', '', stem)
        if clean and clean != stem:
            if clean not in prefix_map:
                prefix_map[clean] = stem
    return prefix_map


def fix_ghost_links(content: str, all_stems: set, prefix_map: dict) -> tuple[str, int]:
    """파일 없는 [[stem]] → prefix 매칭으로 실제 stem 교체."""
    fixed = 0
    def repl(m):
        nonlocal fixed
        inner = m.group(1)
        stem = inner.split('|')[0].strip()
        if stem.startswith('[') or stem in all_stems:
            return m.group(0)  # 정상 링크
        # prefix 매칭
        candidates = [s for s in all_stems if s.startswith(stem) or stem.startswith(s)]
        if not candidates:
            # prefix_map에서 clean stem 조회
            real = prefix_map.get(stem)
            if real:
                fixed += 1
                display = inner.split('|')[1].strip() if '|' in inner else stem
                return f'[[{real}|{display}]]'
        elif len(candidates) == 1:
            real = candidates[0]
            fixed += 1
            display = inner.split('|')[1].strip() if '|' in inner else stem
            return f'[[{real}|{display}]]'
        return m.group(0)

    new = re.sub(r'(?<!!)\[\[([^\]]+)\]\]', repl, content)
    return new, fixed


# ── §8.5: Archive Dead Link 제거 ─────────────────────────────────────
def remove_archive_links(content: str, archive_stems: set, active_stems: set) -> tuple[str, int]:
    """archive/ 로 이동된 파일의 링크를 active에서 제거."""
    removed = 0
    lines = content.split('\n')
    new_lines = []
    for line in lines:
        links = re.findall(r'(?<!!)\[\[([^\]]+)\]\]', line)
        dead = [l.split('|')[0].strip() for l in links
                if l.split('|')[0].strip() in archive_stems
                and l.split('|')[0].strip() not in active_stems]
        if dead:
            # 링크 줄 자체를 제거 (## 관련 문서 섹션 내)
            removed += len(dead)
            # 링크를 plain text로 변환하거나 줄 제거
            new_line = re.sub(r'(?<!!)\[\[([^\]]+)\]\]',
                              lambda m: m.group(0) if m.group(1).split('|')[0].strip() not in dead else '',
                              line)
            if new_line.strip() and new_line.strip() not in ('- ', '*'):
                new_lines.append(new_line)
        else:
            new_lines.append(line)
    return '\n'.join(new_lines), removed


# ── §8.4: 태그 기반 Fallback ─────────────────────────────────────────
def inject_fallback(content: str, fm: str, all_stems: set) -> tuple[str, bool]:
    """링크 없는 파일에 TAG_HUB 링크 강제 주입."""
    fm_part, body = split_frontmatter(content)
    existing_links = re.findall(r'\[\[[^\]]+\]\]', body)
    if existing_links:
        return content, False

    tags = get_tags(fm_part)
    hub_stem = None
    for tag in tags:
        if tag in TAG_HUB:
            candidate = TAG_HUB[tag]
            if candidate in all_stems:
                hub_stem = candidate
                break

    if not hub_stem:
        hub_stem = '_index' if '_index' in all_stems else None

    if not hub_stem:
        return content, False

    # ## 관련 문서 섹션이 없으면 끝에 추가
    if RELATED_SECTION not in body:
        body = body.rstrip() + f'\n\n{RELATED_SECTION}\n\n- [[{hub_stem}]]\n'
    else:
        body = re.sub(
            rf'({re.escape(RELATED_SECTION)}\n)',
            rf'\1\n- [[{hub_stem}]]\n',
            body, count=1
        )

    return fm_part + body, True


# ── §8.2: ENTITY_HUB 링크 주입 ───────────────────────────────────────
def inject_entity_hub(content: str, stem: str, all_stems: set) -> tuple[str, int]:
    """ENTITY_HUB 키워드가 본문에 등장하면 허브 링크 주입 (첫 1회).
    inject_keywords.py 와 동일한 placeholder 방식 사용."""
    fm, body = split_frontmatter(content)

    # 코드블록 보호
    code_ph: dict[str, str] = {}
    cc = [0]
    def prot_code(m: re.Match) -> str:
        cc[0] += 1
        k = f'\x00CD{cc[0]}\x00'
        code_ph[k] = m.group(0)
        return k
    body_p = re.sub(r'```[\s\S]*?```|`[^`]+`', prot_code, body, flags=re.DOTALL)

    # 기존 wikilink 보호
    body_p, link_ph = protect_links(body_p)

    # 각 키워드 첫 등장 위치 수집 (겹침 제거 후 역순 치환)
    replacements: list[tuple[int, int, str]] = []
    for keyword, target_stem in ENTITY_HUB.items():
        if target_stem == stem or target_stem not in all_stems:
            continue
        esc = re.escape(keyword)
        pat = re.compile(rf'(?<![가-힣\w]){esc}(?![가-힣\w])')
        m = pat.search(body_p)
        if m:
            replacements.append((m.start(), m.end(), f'[[{target_stem}|{keyword}]]'))

    # 위치 오름차순 정렬 후 겹침 제거
    replacements.sort(key=lambda x: x[0])
    filtered: list[tuple[int, int, str]] = []
    last_end = -1
    for start, end, rep in replacements:
        if start >= last_end:
            filtered.append((start, end, rep))
            last_end = end

    # 역순 치환 (앞 오프셋 유지)
    for start, end, rep in reversed(filtered):
        body_p = body_p[:start] + rep + body_p[end:]

    # 복원
    body_p = restore_links(body_p, link_ph)
    for k, v in code_ph.items():
        body_p = body_p.replace(k, v)

    return fm + body_p, len(filtered)


# ── 메인 ─────────────────────────────────────────────────────────────
def strengthen(active_dir: Path, archive_dir: Path | None = None, verbose: bool = False) -> dict:
    all_stems = {md.stem for md in active_dir.glob('*.md')}
    archive_stems = set()
    if archive_dir and archive_dir.is_dir():
        archive_stems = {md.stem for md in archive_dir.glob('*.md')}

    prefix_map = build_prefix_map(all_stems)

    stats = {
        'bracket_fixed': 0,
        'entity_injected': 0,
        'ghost_fixed': 0,
        'archive_dead': 0,
        'fallback_injected': 0,
        'files_changed': 0,
    }

    for md in sorted(active_dir.glob('*.md')):
        try:
            content = md.read_text(encoding='utf-8', errors='replace')
        except Exception:
            continue

        fm, body = split_frontmatter(content)
        changed = False

        # §8.1 깨진 브래킷
        content, n = fix_broken_brackets(content)
        stats['bracket_fixed'] += n
        if n:
            changed = True

        # §8.2 ENTITY_HUB 링크 주입
        content, n = inject_entity_hub(content, md.stem, all_stems)
        stats['entity_injected'] += n
        if n:
            changed = True

        # §8.5 Archive Dead Link
        if archive_stems:
            content, n = remove_archive_links(content, archive_stems, all_stems)
            stats['archive_dead'] += n
            if n:
                changed = True

        # §8.3 Ghost→Real (현재 ghost가 없으면 빠르게 통과)
        content, n = fix_ghost_links(content, all_stems, prefix_map)
        stats['ghost_fixed'] += n
        if n:
            changed = True

        # §8.4 Fallback
        content, injected = inject_fallback(content, fm, all_stems)
        if injected:
            stats['fallback_injected'] += 1
            changed = True

        if changed:
            md.write_text(content, encoding='utf-8')
            stats['files_changed'] += 1
            if verbose:
                print(f"  수정: {md.name[:60]}")

    return stats


def main():
    parser = argparse.ArgumentParser(description='§8 Wiki링크 2차 강화')
    parser.add_argument('active_dir', help='active/ 폴더 경로')
    parser.add_argument('--archive', default=None, help='.archive/ 폴더 경로')
    parser.add_argument('--verbose', '-v', action='store_true')
    args = parser.parse_args()

    active_dir = Path(args.active_dir)
    archive_dir = Path(args.archive) if args.archive else None

    if not active_dir.is_dir():
        print(f"오류: {active_dir} 없음")
        sys.exit(1)

    print("§8 Wiki링크 2차 강화 시작...")
    stats = strengthen(active_dir, archive_dir, verbose=args.verbose)

    print(f"\n=== §8 완료 ===")
    print(f"  8.1 브래킷 수정:      {stats['bracket_fixed']}건")
    print(f"  8.2 엔티티 허브 주입: {stats['entity_injected']}건")
    print(f"  8.3 Ghost→Real:      {stats['ghost_fixed']}건")
    print(f"  8.5 Archive Dead:    {stats['archive_dead']}건")
    print(f"  8.4 Fallback 주입:   {stats['fallback_injected']}개 파일")
    print(f"  총 변경 파일:        {stats['files_changed']}개")


if __name__ == '__main__':
    main()
