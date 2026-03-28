#!/usr/bin/env python3
"""
scan_cleanup.py — §3 Stub/old version file detection and .archive/ move

Detection items:
  S1. Stubs (actual body under 50 chars)  per §3.1.1
  S2. Empty pages (only frontmatter or no actual content)
  S3. status: outdated + no superseded_by  per §3.3
  S4. Old version files (v1/old/backup/draft pattern in filename)
  S5. Operational files (room booking, admin notices, meal info, etc.)  per §3.1

Behavior:
  --dry-run : 탐지만 하고 Not moved (기본)
  --fix     : .archive/ 폴더로 Actual move
  --verbose : Output detection reasons

Usage:
  python scan_cleanup.py <active_dir> [--archive <archive_dir>] [--fix] [--verbose]
"""

import re
import sys
import shutil
import argparse
from pathlib import Path
from datetime import datetime, timedelta


# ── Pattern definitions ───────────────────────────────────────────────────
STUB_CHAR_LIMIT = 50          # 실질 본문 기준 (§3.1.1)
OLD_VERSION_PATTERNS = re.compile(
    r'(?i)_v0\.\d|_old|_backup|_bak|_copy|_draft(?!\d)|_deprecated'
)
OPS_KEYWORDS = [
    '회의실 예약', '총무 공지', '식사 안내', '청소 안내', '주차 안내',
    '경비 청구', '출퇴근 기록', '비품 신청', '시설 점검',
]


def body_char_count(content: str) -> int:
    """Per §3.1.1: character count after removing frontmatter, H1, and source links."""
    text = content
    # Remove frontmatter
    if text.startswith('---'):
        end = text.find('\n---\n', 4)
        text = text[end + 5:] if end != -1 else text
    # Remove H1
    text = re.sub(r'^#\s+.+', '', text, flags=re.MULTILINE)
    # Remove original link lines (> 원본: ...)
    text = re.sub(r'^>\s*원본\s*:.*', '', text, flags=re.MULTILINE)
    # Only pure characters after removing wikilinks, markdown symbols, and spaces
    text = re.sub(r'!\[\[[^\]]*\]\]', '', text)     # 이미지 링크 제거
    text = re.sub(r'\[\[([^\]|]+)\|?[^\]]*\]\]', r'\1', text)  # wikilink → 텍스트
    text = re.sub(r'[#\-\*>`\|=_~]', '', text)
    text = re.sub(r'\s+', '', text)
    return len(text.strip())


def get_frontmatter_field(content: str, field: str) -> str:
    m = re.search(rf'^{field}:\s*(.+)$', content, re.MULTILINE)
    return m.group(1).strip().strip('"\'') if m else ''


def has_image_content(content: str) -> bool:
    """§3.1.1 Note: Image links (![[...]]) or tables count as actual content."""
    has_img   = bool(re.search(r'!\[\[[^\]]+\]\]', content))
    has_table = bool(re.search(r'^\|.+\|', content, re.MULTILINE))
    return has_img or has_table


def is_stub(content: str) -> bool:
    """Stub determination: body under 50 chars AND no images/tables."""
    if has_image_content(content):
        return False   # 이미지·테이블 파일은 스텁으로 판정하지 않음
    return body_char_count(content) < STUB_CHAR_LIMIT


def is_outdated_no_superseded(content: str) -> bool:
    status = get_frontmatter_field(content, 'status')
    superseded = get_frontmatter_field(content, 'superseded_by')
    return status.lower() in ('outdated', 'deprecated') and not superseded


def is_old_version_filename(stem: str) -> bool:
    return bool(OLD_VERSION_PATTERNS.search(stem))


def is_ops_content(content: str) -> bool:
    for kw in OPS_KEYWORDS:
        if kw in content:
            return True
    return False


def scan(active_dir: Path) -> dict[str, list]:
    results: dict[str, list] = {
        'stub':        [],
        'outdated':    [],
        'old_version': [],
        'ops':         [],
    }

    for md in sorted(active_dir.glob('*.md')):
        # Exclude generated hub/index files
        if md.stem in ('_index', 'currentSituation', 'chief persona') or \
           md.stem.startswith('회의록_') or md.stem.startswith('_index_') or \
           md.stem.startswith('_tech_'):
            continue
        try:
            content = md.read_text(encoding='utf-8', errors='replace')
        except Exception:
            continue

        if is_stub(content):
            results['stub'].append(md)
        if is_outdated_no_superseded(content):
            results['outdated'].append(md)
        if is_old_version_filename(md.stem):
            results['old_version'].append(md)
        if is_ops_content(content):
            results['ops'].append(md)

    return results


def move_to_archive(files: list, archive_dir: Path, reason: str) -> int:
    archive_dir.mkdir(parents=True, exist_ok=True)
    moved = 0
    for md in files:
        dest = archive_dir / md.name
        if dest.exists():
            dest = archive_dir / f"{md.stem}_dup_{md.suffix}"
        shutil.move(str(md), str(dest))
        moved += 1
    return moved


def print_report(results: dict, fix: bool, verbose: bool, moved: dict):
    print(f"\n{'='*55}")
    print(f"§3 scan_cleanup Complete  ({'Actual move' if fix else 'DRY-RUN'})")
    print(f"{'='*55}")

    categories = [
        ('stub',        'S1 스텁 (본문 50자 미만)'),
        ('outdated',    'S3 outdated (superseded_by 없음)'),
        ('old_version', 'S4 구버전 파일명'),
        ('ops',         'S5 운영성 내용'),
    ]

    total_detected = 0
    for key, label in categories:
        files = results[key]
        n = len(files)
        total_detected += n
        mv = moved.get(key, 0)
        status = f"→ {mv}개 이동" if fix and mv else ("→ Not moved" if fix else "→ dry-run")
        print(f"\n  {label}: {n}개  {status}")
        if verbose or not fix:
            for f in files[:15]:
                chars = body_char_count(f.read_text(encoding='utf-8', errors='replace')) \
                        if key == 'stub' else ''
                suffix = f" ({chars}자)" if chars != '' else ''
                print(f"    · {f.name[:65]}{suffix}")
            if len(files) > 15:
                print(f"    ... 외 {len(files)-15}개")

    print(f"\n  Total detected: {total_detected}개")
    if not fix:
        print("  ⚠️  Actual move하려면 --fix 옵션을 추가하세요.")


def main():
    parser = argparse.ArgumentParser(description='§3 스텁·구버전 파일 탐지 및 .archive/ 이동')
    parser.add_argument('active_dir', help='active/ folder path')
    parser.add_argument('--archive', help='.archive/ 폴더 경로 (기본: active/../.archive)')
    parser.add_argument('--fix', action='store_true', help='Execute actual move to .archive/')
    parser.add_argument('--verbose', '-v', action='store_true', help='Detailed output of detected files')
    parser.add_argument('--category', choices=['stub', 'outdated', 'old_version', 'ops'],
                        help='Move only specific category (use with --fix)')
    args = parser.parse_args()

    active_dir = Path(args.active_dir)
    if not active_dir.is_dir():
        print(f"Error: {active_dir} not found"); sys.exit(1)

    archive_dir = Path(args.archive) if args.archive else active_dir.parent / '.archive'

    print(f"§3 scan_cleanup starting...")
    print(f"  대상: {active_dir}")
    print(f"  archive: {archive_dir}")

    results = scan(active_dir)
    moved = {}

    if args.fix:
        cats = [args.category] if args.category else ['stub', 'outdated', 'old_version', 'ops']
        for cat in cats:
            files = results[cat]
            if files:
                n = move_to_archive(files, archive_dir, cat)
                moved[cat] = n
                print(f"  {cat}: {n}개 → {archive_dir}")

    print_report(results, args.fix, args.verbose, moved)


if __name__ == '__main__':
    main()
