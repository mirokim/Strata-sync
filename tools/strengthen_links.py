#!/usr/bin/env python3
"""
strengthen_links.py — §8 Wikilink secondary enhancement

8.1 Fix broken brackets   — [[[stem]]] → [[stem]] pattern normalization
8.2 Domain hub links       — Inject hub links for entity names in body text based on ENTITY_HUB (linked with inject_keywords)
8.3 Ghost→Real replacement — Replace missing [[broken_stem]] → auto-replace via stem prefix matching
8.4 Tag fallback links     — Force inject TAG_HUB links for files with no links after all above steps
8.5 Archive dead links     — Remove links to .archive/-moved files from active

Usage:
  python strengthen_links.py <active_dir> [--archive <archive_dir>] [--verbose]
"""

import re
import sys
import argparse
from pathlib import Path
from collections import Counter, defaultdict


# ── §8.2 Domain hub map ──────────────────────────────────────────────
# Inject hub link when keyword is found in body text
# (shorter aliases that don't overlap with inject_keywords.py)
ENTITY_HUB: dict[str, str] = {
    # Character short aliases (not in inject_keywords)
    "캐릭터G 쇼군":    "416014685_06_ 캐릭터 _ 캐릭터G",
    "캐릭터J 블레이드": "584041454_14_ 캐릭터 _ 캐릭터J 블레이드",
    # System shortcuts
    "점령전 테스트":   "681184425_점령전 테스트_2026_03_11",
    "난투전 테스트":   "642329459_난투전 테스트_2025_12_16",
}

# ── §8.4 Tag-based fallback hub ───────────────────────────────────────
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

# Hub link insertion position (before ## Overview section)
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
    """Replace existing [[...]] with placeholders."""
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


# ── §8.1: Broken bracket normalization ────────────────────────────────
def fix_broken_brackets(content: str) -> tuple[str, int]:
    """Fix [[[stem]]] → [[stem]]. Returns (new_content, count)."""
    # Only fix 4+ brackets (triple brackets are valid as [date] prefix patterns)
    new, n = re.subn(r'\[\[\[\[([^\[\]]+)\]\]', r'[[\1]]', content)
    return new, n


# ── §8.3: Ghost→Real prefix matching ─────────────────────────────────
def build_prefix_map(all_stems: set) -> dict:
    """stem → real stem mapping (for fast prefix-based lookup)."""
    prefix_map = {}
    for stem in all_stems:
        # Also register the form with numeric ID_ prefix removed
        clean = re.sub(r'^\d+_', '', stem)
        if clean and clean != stem:
            if clean not in prefix_map:
                prefix_map[clean] = stem
    return prefix_map


def fix_ghost_links(content: str, all_stems: set, prefix_map: dict) -> tuple[str, int]:
    """Replace missing [[stem]] → real stem via prefix matching."""
    fixed = 0
    def repl(m):
        nonlocal fixed
        inner = m.group(1)
        stem = inner.split('|')[0].strip()
        if stem.startswith('[') or stem in all_stems:
            return m.group(0)  # Valid link
        # Prefix matching
        candidates = [s for s in all_stems if s.startswith(stem) or stem.startswith(s)]
        if not candidates:
            # Look up clean stem in prefix_map
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


# ── §8.5: Archive dead link removal ──────────────────────────────────
def remove_archive_links(content: str, archive_stems: set, active_stems: set) -> tuple[str, int]:
    """Remove links to files moved to archive/ from active."""
    removed = 0
    lines = content.split('\n')
    new_lines = []
    for line in lines:
        links = re.findall(r'(?<!!)\[\[([^\]]+)\]\]', line)
        dead = [l.split('|')[0].strip() for l in links
                if l.split('|')[0].strip() in archive_stems
                and l.split('|')[0].strip() not in active_stems]
        if dead:
            # Remove the link line itself (within ## Related Documents section)
            removed += len(dead)
            # Convert links to plain text or remove lines
            new_line = re.sub(r'(?<!!)\[\[([^\]]+)\]\]',
                              lambda m: m.group(0) if m.group(1).split('|')[0].strip() not in dead else '',
                              line)
            if new_line.strip() and new_line.strip() not in ('- ', '*'):
                new_lines.append(new_line)
        else:
            new_lines.append(line)
    return '\n'.join(new_lines), removed


# ── §8.4: Tag-based fallback ─────────────────────────────────────────
def inject_fallback(content: str, fm: str, all_stems: set) -> tuple[str, bool]:
    """Force inject TAG_HUB links for files with no links."""
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

    # If no ## Related Documents section exists, append at end
    if RELATED_SECTION not in body:
        body = body.rstrip() + f'\n\n{RELATED_SECTION}\n\n- [[{hub_stem}]]\n'
    else:
        body = re.sub(
            rf'({re.escape(RELATED_SECTION)}\n)',
            rf'\1\n- [[{hub_stem}]]\n',
            body, count=1
        )

    return fm_part + body, True


# ── §8.2: ENTITY_HUB link injection ──────────────────────────────────
def inject_entity_hub(content: str, stem: str, all_stems: set) -> tuple[str, int]:
    """Inject hub link when ENTITY_HUB keyword appears in body (first occurrence only).
    Uses the same placeholder approach as inject_keywords.py."""
    fm, body = split_frontmatter(content)

    # Protect code blocks
    code_ph: dict[str, str] = {}
    cc = [0]
    def prot_code(m: re.Match) -> str:
        cc[0] += 1
        k = f'\x00CD{cc[0]}\x00'
        code_ph[k] = m.group(0)
        return k
    body_p = re.sub(r'```[\s\S]*?```|`[^`]+`', prot_code, body, flags=re.DOTALL)

    # Protect existing wikilinks
    body_p, link_ph = protect_links(body_p)

    # Collect first occurrence position for each keyword (deduplicate overlaps, reverse substitute)
    replacements: list[tuple[int, int, str]] = []
    for keyword, target_stem in ENTITY_HUB.items():
        if target_stem == stem or target_stem not in all_stems:
            continue
        esc = re.escape(keyword)
        pat = re.compile(rf'(?<![가-힣\w]){esc}(?![가-힣\w])')
        m = pat.search(body_p)
        if m:
            replacements.append((m.start(), m.end(), f'[[{target_stem}|{keyword}]]'))

    # Sort by position ascending and remove overlaps
    replacements.sort(key=lambda x: x[0])
    filtered: list[tuple[int, int, str]] = []
    last_end = -1
    for start, end, rep in replacements:
        if start >= last_end:
            filtered.append((start, end, rep))
            last_end = end

    # Reverse substitution (preserves preceding offsets)
    for start, end, rep in reversed(filtered):
        body_p = body_p[:start] + rep + body_p[end:]

    # Restore
    body_p = restore_links(body_p, link_ph)
    for k, v in code_ph.items():
        body_p = body_p.replace(k, v)

    return fm + body_p, len(filtered)


# ── Main ─────────────────────────────────────────────────────────────
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

        # §8.1 Broken brackets
        content, n = fix_broken_brackets(content)
        stats['bracket_fixed'] += n
        if n:
            changed = True

        # §8.2 ENTITY_HUB link injection
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

        # §8.3 Ghost→Real (fast pass-through if no ghosts exist)
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
                print(f"  Modified: {md.name[:60]}")

    return stats


def main():
    parser = argparse.ArgumentParser(description='§8 Wikilink secondary enhancement')
    parser.add_argument('active_dir', help='active/ folder path')
    parser.add_argument('--archive', default=None, help='.archive/ folder path')
    parser.add_argument('--verbose', '-v', action='store_true')
    args = parser.parse_args()

    active_dir = Path(args.active_dir)
    archive_dir = Path(args.archive) if args.archive else None

    if not active_dir.is_dir():
        print(f"Error: {active_dir} not found")
        sys.exit(1)

    print("§8 Wikilink secondary enhancement starting...")
    stats = strengthen(active_dir, archive_dir, verbose=args.verbose)

    print(f"\n=== §8 Complete ===")
    print(f"  8.1 Bracket fixes:       {stats['bracket_fixed']} items")
    print(f"  8.2 Entity hub injected: {stats['entity_injected']} items")
    print(f"  8.3 Ghost→Real:          {stats['ghost_fixed']} items")
    print(f"  8.5 Archive Dead:        {stats['archive_dead']} items")
    print(f"  8.4 Fallback injected:   {stats['fallback_injected']} files")
    print(f"  Total changed files:     {stats['files_changed']} files")


if __name__ == '__main__':
    main()
