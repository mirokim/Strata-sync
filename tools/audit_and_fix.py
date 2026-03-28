#!/usr/bin/env python3
"""
audit_and_fix.py — §13.2 Vault auto-correction

Auto-fix items:
  F1. Nested wikilink   [[[stem]] (3-open+2-close), [[[[stem]]]] (4+) → [[stem]]
  F2. Remove HTML remnants  <br>, <b>, <strong>, <em>, <span>, <div>, etc.
  F3. Reduce consecutive blank lines  3+ → 2 (outside frontmatter)
  F4. Supplement empty tags    tags: [] → auto-infer from filename+type
  F5. Fix broken links  Replace [[X]] with existing stem via prefix matching

Audit report items (listed without modification):
  R1. Body under 300 chars (low-content files)
  R2. Repeated wikilinks  (same stem appearing 3+ times)
  R3. File size distribution

Usage:
  python audit_and_fix.py <active_dir> [--dry-run] [--verbose]
"""

import re
import sys
import argparse
from pathlib import Path
from collections import Counter


# ── §13.3 MANUAL_MAP — Manual registration for unresolvable broken links ──────
# Format: 'broken_stem': 'real_stem'
# Example: 'TLS': 'TLS(TimeLineSkill)시스템_588781620',
#      '2026.01.07 피드백_ID': '[2026.01.07] 피드백_ID',
MANUAL_MAP: dict[str, str] = {
    # ── Register manually here ──
    # 'broken_stem': 'real_stem',
}


# ── Auto-infer tags ───────────────────────────────────────────────
def infer_tags(stem: str, doc_type: str) -> list[str]:
    tags = [doc_type]
    s = stem.lower()
    kw_map = {
        'gameplay': ['레시피', 'recipe', '크래프팅', 'craft', 'object', '오브젝트',
                     '아이템', '스킬', '전투', '퀘스트', '던전', '몬스터', '드롭'],
        'art':      ['art', '원화', '외주', 'virtuos', 'humidor', 'mingjiang',
                     '콘셉', '일러스트', '애니메이션', 'anim', '리깅'],
        'tech':     ['엔진', 'engine', 'tech', '서버', 'server', 'db', '데이터베이스',
                     '코드', 'code', 'bug', '버그', '성능', 'performance'],
        'reference': ['리서치', 'research', '분석', '레퍼런스', 'reference',
                      '벤치마크', '비교', '사례'],
        'guide':    ['가이드', 'guide', '매뉴얼', 'manual', '설명서', '튜토리얼'],
        'character': ['캐릭터', 'character', '도감', '스킬트리', '스탯'],
        'world':    ['세계', '맵', 'map', '지역', '지형', '설정', '세계관'],
    }
    for tag, kws in kw_map.items():
        if tag != doc_type and any(k in s for k in kws):
            tags.append(tag)
    return list(dict.fromkeys(tags))


# ── F1: Fix nested wikilinks ───────────────────────────────────────
def fix_nested_wikilinks(content: str) -> tuple[str, int]:
    """[[[stem]] (3열림+2닫힘), [[[[stem]]]] (4중+) → [[stem]] 정규화."""
    count = 0
    # 4+ brackets (both sides 3+)
    new, n = re.subn(r'\[{3,}([^\[\]]+)\]{3,}', r'[[\1]]', content)
    count += n
    # 3-open+2-close pattern: [[[stem]] — frequently occurs in markdown table cells
    new, n = re.subn(r'\[\[\[([^\[\]]+)\]\](?!\])', r'[[\1]]', new)
    count += n
    return new, count


# ── F2: Remove HTML remnants ───────────────────────────────────────────
HTML_TAGS = re.compile(
    r'<(br|hr)\s*/?>|'                              # Empty tags
    r'</(b|strong|em|i|span|div|p|ul|li|a)>|'       # Closing tags
    r'<(b|strong|em|i|span|div|p|ul|li|a)(\s[^>]*)?>',  # Opening tags
    re.IGNORECASE
)
HTML_COMMENT = re.compile(r'<!--.*?-->', re.DOTALL)
HTML_ENTITY  = re.compile(r'&(amp|lt|gt|nbsp|quot);')
ENTITY_MAP   = {'amp': '&', 'lt': '<', 'gt': '>', 'nbsp': ' ', 'quot': '"'}


def fix_html_remnants(content: str) -> tuple[str, int]:
    count = 0
    # Remove comments
    new, n = HTML_COMMENT.subn('', content); count += n
    # Remove tags
    new, n = HTML_TAGS.subn('', new); count += n
    # Restore HTML entities
    new2 = HTML_ENTITY.sub(lambda m: ENTITY_MAP.get(m.group(1), m.group(0)), new)
    if new2 != new:
        count += 1
    return new2, count


# ── F3: Reduce consecutive blank lines (outside frontmatter only) ──────────────────────
def fix_blank_lines(content: str) -> tuple[str, int]:
    """3줄 이상 연속 빈줄 → 2줄."""
    fm_end = -1
    if content.startswith('---'):
        fm_end = content.find('\n---\n', 4)
    if fm_end != -1:
        fm   = content[:fm_end + 5]
        body = content[fm_end + 5:]
    else:
        fm, body = '', content

    new_body, n = re.subn(r'\n{4,}', '\n\n\n', body)
    return fm + new_body, n


# ── F4: Supplement empty tags ─────────────────────────────────────────────
def fix_empty_tags(content: str, stem: str) -> tuple[str, bool]:
    m = re.search(r'tags:\s*\[([^\]]*)\]', content)
    if not m or m.group(1).strip():
        return content, False
    tm = re.search(r'type:\s*(\S+)', content)
    doc_type = tm.group(1) if tm else 'spec'
    tags = infer_tags(stem, doc_type)
    new = content[:m.start()] + f'tags: [{", ".join(tags)}]' + content[m.end():]
    return new, True


# ── F5: Fix broken links (MANUAL_MAP → slash_map → prefix matching) ────
def fix_broken_links(content: str, all_stems: set, prefix_map: dict) -> tuple[str, int]:
    """§13.3 기준: MANUAL_MAP → prefix 매칭 순서로 broken link 수정."""
    fixed = 0
    media_exts = {'.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp',
                  '.tiff', '.tif', '.wmf', '.emf', '.mp4', '.mov', '.avi',
                  '.pdf', '.psd', '.ai'}

    def repl(m):
        nonlocal fixed
        inner = m.group(1)
        stem  = inner.split('|')[0].strip()
        if stem.startswith('[') or stem in all_stems:
            return m.group(0)
        ext = Path(stem).suffix.lower()
        if ext in media_exts:
            return m.group(0)

        display = inner.split('|')[1].strip() if '|' in inner else stem

        # Priority 1: MANUAL_MAP
        if stem in MANUAL_MAP:
            fixed += 1
            return f'[[{MANUAL_MAP[stem]}|{display}]]'

        # Priority 2: Prefix matching (§13.2.1 auto-fix parenthesis truncation bug)
        real = prefix_map.get(stem)
        if real:
            fixed += 1
            return f'[[{real}|{display}]]'

        return m.group(0)

    new = re.sub(r'(?<!!)\[\[([^\]]+)\]\]', repl, content)
    return new, fixed


def build_prefix_map(all_stems: set) -> dict:
    prefix_map = {}
    for stem in all_stems:
        clean = re.sub(r'^\d+_', '', stem)
        if clean and clean != stem and clean not in prefix_map:
            prefix_map[clean] = stem
    return prefix_map


# ── R1: Audit body text under 300 chars ─────────────────────────────────────
def has_image_content(content: str) -> bool:
    """§3.1.1: 이미지 링크(![[...]]) 또는 테이블이 있으면 실질 콘텐츠로 인정."""
    return bool(re.search(r'!\[\[[^\]]+\]\]', content)) or \
           bool(re.search(r'^\|.+\|', content, re.MULTILINE))


def audit_thin_docs(content: str) -> int:
    """Return body text length. Returns -1 for image/table files (excluded)."""
    if has_image_content(content):
        return -1   # Image/table file → excluded from under-300 warning
    fm_end = content.find('\n---\n', 4) if content.startswith('---') else -1
    body   = content[fm_end + 5:] if fm_end != -1 else content
    text   = re.sub(r'\[\[([^\]]+)\]\]', lambda m: (m.group(1).split('|')[-1]), body)
    text   = re.sub(r'[#>\-\*`\|]', ' ', text)
    return len(text.strip())


# ── R2: Repeated wikilinks ────────────────────────────────────────────
def audit_repeated_links(content: str, threshold: int = 3) -> list[str]:
    links  = re.findall(r'(?<!!)\[\[([^\]]+)\]\]', content)
    stems  = [l.split('|')[0].strip() for l in links]
    counts = Counter(stems)
    return [s for s, c in counts.items() if c >= threshold]


# ── Main ─────────────────────────────────────────────────────────
def run(active_dir: Path, dry_run: bool = False, verbose: bool = False) -> dict:
    all_stems  = {md.stem for md in active_dir.glob('*.md')}
    prefix_map = build_prefix_map(all_stems)

    stats = {
        'nested_fixed':   0,
        'html_fixed':     0,
        'blank_fixed':    0,
        'tags_fixed':     0,
        'links_fixed':    0,
        'files_changed':  0,
        'thin_docs':      [],
        'repeated_links': {},
        'size_dist':      Counter(),
    }

    for md in sorted(active_dir.glob('*.md')):
        try:
            content = md.read_text(encoding='utf-8', errors='replace')
        except Exception:
            continue

        original = content
        changed  = False

        # F1
        content, n = fix_nested_wikilinks(content)
        stats['nested_fixed'] += n; changed = changed or bool(n)

        # F2
        content, n = fix_html_remnants(content)
        stats['html_fixed'] += n; changed = changed or bool(n)

        # F3
        content, n = fix_blank_lines(content)
        stats['blank_fixed'] += n; changed = changed or bool(n)

        # F4
        content, ok = fix_empty_tags(content, md.stem)
        stats['tags_fixed'] += ok; changed = changed or ok

        # F5
        content, n = fix_broken_links(content, all_stems, prefix_map)
        stats['links_fixed'] += n; changed = changed or bool(n)

        if changed:
            stats['files_changed'] += 1
            if not dry_run:
                md.write_text(content, encoding='utf-8')
            if verbose:
                print(f"  Modified: {md.name[:60]}")

        # Audit (separate from fixes)
        body_len = audit_thin_docs(content)
        if body_len != -1 and body_len < 300:   # -1 means image/table file → excluded
            stats['thin_docs'].append(md.name)

        repeated = audit_repeated_links(content)
        if repeated:
            stats['repeated_links'][md.name] = repeated

        # File size distribution
        sz = md.stat().st_size
        if sz < 2000:    stats['size_dist']['<2KB'] += 1
        elif sz < 10000: stats['size_dist']['2–10KB'] += 1
        elif sz < 50000: stats['size_dist']['10–50KB'] += 1
        else:            stats['size_dist']['>50KB'] += 1

    return stats


def print_report(stats: dict, dry_run: bool):
    print(f"\n{'='*55}")
    print(f"§13.2 audit_and_fix Complete{'  [DRY-RUN]' if dry_run else ''}")
    print(f"{'='*55}")
    print(f"  F1 중첩 wikilink Modified: {stats['nested_fixed']}건")
    print(f"  F2 HTML 잔재 제거:     {stats['html_fixed']}건")
    print(f"  F3 연속 빈줄 축소:     {stats['blank_fixed']}건")
    print(f"  F4 빈 tags 보완:       {stats['tags_fixed']} files")
    print(f"  F5 깨진 링크 Modified:     {stats['links_fixed']}건")
    print(f"  Total changed files:          {stats['files_changed']}개")

    print(f"\n── Audit report ───────────────────────────────────")
    thin = stats['thin_docs']
    print(f"  R1 본문 300자 미만:    {len(thin)}개")
    if thin:
        for f in thin[:10]:
            print(f"     · {f[:60]}")
        if len(thin) > 10:
            print(f"     ... 외 {len(thin)-10}개")

    rep = stats['repeated_links']
    print(f"  R2 반복 wikilink(3+): {len(rep)} files")
    for fname, stems in list(rep.items())[:5]:
        print(f"     · {fname[:50]}: {stems[:3]}")

    print(f"\n── File size distribution ──────────────────────────────")
    for label, cnt in sorted(stats['size_dist'].items()):
        print(f"  {label:>8}: {cnt:4}개")


def main():
    parser = argparse.ArgumentParser(description='§13.2 Vault 자동 교정')
    parser.add_argument('active_dir', help='active/ folder path')
    parser.add_argument('--dry-run', action='store_true', help='Preview without modifying files')
    parser.add_argument('--verbose', '-v', action='store_true')
    args = parser.parse_args()

    active_dir = Path(args.active_dir)
    if not active_dir.is_dir():
        print(f"Error: {active_dir} not found")
        sys.exit(1)

    print(f"§13.2 audit_and_fix 시작 ({'DRY-RUN' if args.dry_run else '실제 수정'})...")
    stats = run(active_dir, dry_run=args.dry_run, verbose=args.verbose)
    print_report(stats, args.dry_run)


if __name__ == '__main__':
    main()
