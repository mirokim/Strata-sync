#!/usr/bin/env python3
"""
md_normalize.py — §4.7 Existing MD file frontmatter normalization

Processing policy:
  - Body content is never modified
  - If no frontmatter, auto-generate based on filename and modification date
  - If frontmatter exists, only supplement missing required fields (date / type / status / tags / origin)
  - Add origin: md field (keep existing origin if present)
  - Output warning if ![[image]] link target not found in attachments/

Required fields:
  date, type, status, tags, origin

Usage:
  python md_normalize.py <active_dir> [--attachments <dir>] [--dry-run] [--verbose]
"""

import re
import sys
import argparse
from pathlib import Path
from datetime import datetime


# ── Date patterns ────────────────────────────────────────────────────
DATE_PATTERNS = [
    re.compile(r'(\d{4})-(\d{2})-(\d{2})'),
    re.compile(r'(\d{4})(\d{2})(\d{2})'),
    re.compile(r'(\d{4})\.(\d{2})\.(\d{2})'),
]

REQUIRED_FIELDS = ['date', 'type', 'status', 'tags', 'origin']


def detect_date_from_stem(stem: str) -> str:
    for pat in DATE_PATTERNS:
        m = pat.search(stem)
        if m:
            y, mo, d = m.group(1), m.group(2), m.group(3)
            try:
                dt = datetime(int(y), int(mo), int(d))
                return dt.strftime('%Y-%m-%d')
            except ValueError:
                continue
    return datetime.today().strftime('%Y-%m-%d')


def detect_date_from_mtime(path: Path) -> str:
    mtime = path.stat().st_mtime
    return datetime.fromtimestamp(mtime).strftime('%Y-%m-%d')


def infer_type_from_stem(stem: str) -> str:
    s = stem.lower()
    if any(k in s for k in ['회의', 'meeting', '미팅', '피드백', 'feedback']):
        return 'meeting'
    if any(k in s for k in ['가이드', 'guide', '매뉴얼', 'manual']):
        return 'guide'
    if any(k in s for k in ['레퍼런스', 'reference', '리서치', 'research']):
        return 'reference'
    if any(k in s for k in ['결정', 'decision', 'adr']):
        return 'decision'
    return 'spec'


def infer_tags_from_stem(stem: str, doc_type: str) -> str:
    tags = [doc_type]
    s = stem.lower()
    kw_map = {
        'gameplay': ['레시피', 'recipe', '크래프팅', 'craft', '아이템', '스킬', '전투', '퀘스트', '던전'],
        'art':      ['art', '원화', '외주', '콘셉', '일러스트', '애니메이션', 'anim'],
        'tech':     ['엔진', 'engine', 'tech', '서버', 'server', '코드', 'code', 'bug', '버그'],
        'reference': ['리서치', 'research', '분석', '레퍼런스', 'reference'],
        'character': ['캐릭터', 'character', '도감', '스킬트리'],
        'world':    ['세계', '맵', 'map', '지역', '지형', '설정', '세계관'],
    }
    for tag, kws in kw_map.items():
        if tag != doc_type and any(k in s for k in kws):
            tags.append(tag)
    unique = list(dict.fromkeys(tags))
    return '[' + ', '.join(unique) + ']'


# ── Parse frontmatter ──────────────────────────────────────────────
def parse_frontmatter(content: str) -> tuple[dict, str, int]:
    """Parse frontmatter. Returns: (fields_dict, fm_raw, fm_end_pos)"""
    if not content.startswith('---'):
        return {}, '', 0
    end = content.find('\n---\n', 4)
    if end == -1:
        return {}, '', 0
    fm_raw  = content[3:end].strip()
    fm_end  = end + 5   # '\n---\n' 이후 위치
    fields  = {}
    for line in fm_raw.splitlines():
        m = re.match(r'^(\w+):\s*(.*)', line)
        if m:
            fields[m.group(1)] = m.group(2).strip()
    return fields, content[:fm_end], fm_end


def get_field(fields: dict, key: str) -> str:
    return fields.get(key, '').strip().strip('"\'')


# ── Frontmatter 보완 ──────────────────────────────────────────────
def supplement_frontmatter(content: str, path: Path) -> tuple[str, list[str]]:
    """Supplement missing fields. Returns list of changed fields."""
    changed = []
    fields, fm_block, body_start = parse_frontmatter(content)

    if not fm_block:
        # No frontmatter → create new
        date     = detect_date_from_stem(path.stem) or detect_date_from_mtime(path)
        doc_type = infer_type_from_stem(path.stem)
        tags     = infer_tags_from_stem(path.stem, doc_type)
        title    = path.stem.replace('_', ' ')
        new_fm = (
            f"---\n"
            f"title: \"{title}\"\n"
            f"date: {date}\n"
            f"type: {doc_type}\n"
            f"status: active\n"
            f"tags: {tags}\n"
            f"origin: md\n"
            f"---\n\n"
        )
        changed.append('frontmatter(newly created)')
        return new_fm + content, changed

    # ── Supplement missing fields ──
    lines = fm_block.rstrip().rstrip('---').strip().splitlines()

    def has_field(key: str) -> bool:
        return any(re.match(rf'^{key}:', l) for l in lines)

    inserts = []

    if not has_field('date'):
        date = detect_date_from_stem(path.stem) or detect_date_from_mtime(path)
        inserts.append(f'date: {date}')
        changed.append('date')

    if not has_field('type'):
        inserts.append(f'type: {infer_type_from_stem(path.stem)}')
        changed.append('type')

    if not has_field('status'):
        inserts.append('status: active')
        changed.append('status')

    if not has_field('tags'):
        doc_type = get_field(fields, 'type') or infer_type_from_stem(path.stem)
        inserts.append(f'tags: {infer_tags_from_stem(path.stem, doc_type)}')
        changed.append('tags')

    # origin: md 추가 (기존 origin 없을 때만)
    if not has_field('origin'):
        inserts.append('origin: md')
        changed.append('origin')

    if not inserts:
        return content, []

    # Insert: add just above the closing --- line
    fm_lines = fm_block.splitlines()
    # fm_block의 마지막 줄이 '---' 이므로 그 앞에 삽입
    close_idx = len(fm_lines) - 1
    for i, l in enumerate(fm_lines):
        if i > 0 and l.strip() == '---':
            close_idx = i
            break
    new_fm_lines = fm_lines[:close_idx] + inserts + fm_lines[close_idx:]
    new_fm = '\n'.join(new_fm_lines) + '\n'
    return new_fm + content[body_start:], changed


# ── 이미지 링크 점검 ──────────────────────────────────────────────
def check_image_links(content: str, path: Path,
                      attachments_dir: Path) -> list[str]:
    """Return warning list if ![[filename]] link target not found in attachments/."""
    if not attachments_dir or not attachments_dir.exists():
        return []
    image_exts = {'.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp',
                  '.bmp', '.tiff', '.tif', '.wmf', '.emf', '.pdf', '.psd'}
    warnings = []
    for img in re.findall(r'!\[\[([^\]]+)\]\]', content):
        fname = img.split('|')[0].strip()
        ext   = Path(fname).suffix.lower()
        if ext in image_exts:
            if not (attachments_dir / fname).exists():
                warnings.append(fname)
    return warnings


# ── Main ─────────────────────────────────────────────────────────
def run(active_dir: Path, attachments_dir: Path | None,
        dry_run: bool, verbose: bool) -> dict:
    stats = {
        'total':       0,
        'changed':     0,
        'no_change':   0,
        'img_warnings': 0,
    }

    for md in sorted(active_dir.glob('*.md')):
        stats['total'] += 1
        try:
            content = md.read_text(encoding='utf-8', errors='replace')
        except Exception:
            continue

        new_content, changed_fields = supplement_frontmatter(content, md)

        # Check image links
        if attachments_dir:
            warns = check_image_links(new_content, md, attachments_dir)
            if warns:
                stats['img_warnings'] += len(warns)
                if verbose:
                    for w in warns:
                        print(f"  ⚠️ 이미지 없음: {md.name[:50]} → {w}")

        if changed_fields:
            stats['changed'] += 1
            if not dry_run:
                md.write_text(new_content, encoding='utf-8')
            if verbose:
                print(f"  Modified: {md.name[:55]}  [{', '.join(changed_fields)}]")
        else:
            stats['no_change'] += 1

    return stats


def main():
    parser = argparse.ArgumentParser(description='§4.7 MD 파일 frontmatter 정규화')
    parser.add_argument('active_dir',    help='active/ folder path')
    parser.add_argument('--attachments', default=None,
                        help='attachments/ 폴더 경로 (기본: active/../attachments)')
    parser.add_argument('--dry-run',     action='store_true', help='Preview without modifying')
    parser.add_argument('--verbose', '-v', action='store_true')
    args = parser.parse_args()

    active_dir = Path(args.active_dir)
    if not active_dir.is_dir():
        print(f"Error: {active_dir} not found"); sys.exit(1)

    att_dir = Path(args.attachments) if args.attachments \
              else active_dir.parent / 'attachments'

    print(f"§4.7 md_normalize 시작{'  [DRY-RUN]' if args.dry_run else ''}...")
    stats = run(active_dir, att_dir if att_dir.exists() else None,
                args.dry_run, args.verbose)

    print(f"\n{'='*50}")
    print(f"§4.7 md_normalize Complete{'  [DRY-RUN]' if args.dry_run else ''}")
    print(f"{'='*50}")
    print(f"  Total MD files:       {stats['total']}개")
    print(f"  Frontmatter supplemented: {stats['changed']}개")
    print(f"  No change:        {stats['no_change']}개")
    if stats['img_warnings']:
        print(f"  ⚠️ 이미지 링크 경고: {stats['img_warnings']}건 (attachments/ 없음)")


if __name__ == '__main__':
    main()
