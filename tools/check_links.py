#!/usr/bin/env python3
"""
check_links.py — §13.1.1 Image/document link verification

Per manual §13.1.1:
  Pattern                         Action
  ![[filename.png/jpg/gif/...]]   Image link → check existence in attachments/
  [[stem]] (no extension)        Document link → check stem exists in active
  ![[stem]] (no image ext)        Invalid pattern → needs fix to [[stem]] (remove !)

Output:
  A. Broken image links (![[image.png]] → not in attachments)
  B. Broken document links ([[stem]] → not in active)
  C. Invalid pattern (![[stem]] no image extension)
  D. Image link overview (counts, file distribution)

Usage:
  python check_links.py <active_dir> [--attachments <dir>] [--fix] [--verbose]

--fix option:
  Auto-fix type C ([[stem]] remove invalid !)
"""

import re
import sys
import argparse
from pathlib import Path
from collections import defaultdict


IMAGE_EXTS = {'.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.tiff', '.tif',
              '.wmf', '.emf', '.mp4', '.mov', '.avi', '.pdf', '.psd', '.ai'}  # Including Obsidian unsupported

# ![[...]] pattern with image extensions
IMG_LINK_RE  = re.compile(r'!\[\[([^\]]+\.(?:png|jpg|jpeg|gif|svg|webp|bmp|tiff|tif))\]\]', re.IGNORECASE)
# ![[...]] pattern without image extension (incorrect form)
BAD_BANG_RE  = re.compile(r'!\[\[([^\]]+)\]\]')
# Regular document wikilink
DOC_LINK_RE  = re.compile(r'(?<!!)\[\[([^\]]+)\]\]')


def scan_file(md: Path, all_stems: set, attachments_dir: Path
              ) -> dict:
    try:
        content = md.read_text(encoding='utf-8', errors='replace')
    except Exception:
        return {}

    # Exclude frontmatter
    fm_end = content.find('\n---\n', 4) if content.startswith('---') else -1
    body = content[fm_end + 5:] if fm_end != -1 else content

    broken_images  = []   # A
    broken_docs    = []   # B
    bad_bangs      = []   # C
    ok_images      = []   # Valid image links

    # A: Check image links
    for m in IMG_LINK_RE.finditer(body):
        fname = m.group(1).strip()
        target = attachments_dir / fname
        if target.exists():
            ok_images.append(fname)
        else:
            broken_images.append(fname)

    # C: Invalid ![[stem]] (no image extension)
    for m in BAD_BANG_RE.finditer(body):
        inner = m.group(1).strip()
        ext = Path(inner).suffix.lower()
        if ext not in IMAGE_EXTS:
            bad_bangs.append(inner)

    # B: Check document links (stem starting with [ means triple bracket — audit_and_fix F1 target)
    # [[stem.ext]] with media extension treated as image/media link (excluded from B)
    for m in DOC_LINK_RE.finditer(body):
        inner = m.group(1)
        stem  = inner.split('|')[0].strip()
        if stem.startswith('['):
            continue   # [[[stem]] pattern — re-check after audit_and_fix.py F1 fix
        ext = Path(stem).suffix.lower()
        if ext in IMAGE_EXTS:
            continue   # Media/image extension → classified as type A (handled separately)
        if stem and stem not in all_stems:
            broken_docs.append(stem)

    return {
        'broken_images': broken_images,
        'broken_docs':   broken_docs,
        'bad_bangs':     bad_bangs,
        'ok_images':     ok_images,
    }


def fix_bad_bangs(md: Path) -> int:
    """C 유형: ![[stem]] → [[stem]] (! 제거)."""
    content = md.read_text(encoding='utf-8', errors='replace')
    fixed = 0

    def repl(m):
        nonlocal fixed
        inner = m.group(1).strip()
        ext = Path(inner).suffix.lower()
        if ext not in IMAGE_EXTS:
            fixed += 1
            return f'[[{inner}]]'
        return m.group(0)

    new = BAD_BANG_RE.sub(repl, content)
    if fixed:
        md.write_text(new, encoding='utf-8')
    return fixed


def run(active_dir: Path, attachments_dir: Path,
        fix: bool = False, verbose: bool = False) -> dict:
    all_stems = {md.stem for md in active_dir.glob('*.md')}

    results = defaultdict(lambda: {'broken_images': [], 'broken_docs': [],
                                   'bad_bangs': [], 'ok_images': []})
    totals = {'broken_images': 0, 'broken_docs': 0, 'bad_bangs': 0,
              'ok_images': 0, 'files_checked': 0, 'bang_fixed': 0}

    for md in sorted(active_dir.glob('*.md')):
        r = scan_file(md, all_stems, attachments_dir)
        if not r:
            continue
        totals['files_checked'] += 1
        for key in ('broken_images', 'broken_docs', 'bad_bangs', 'ok_images'):
            totals[key] += len(r[key])
        if any(r[k] for k in ('broken_images', 'broken_docs', 'bad_bangs')):
            results[md.name] = r

        # Auto-fix type C
        if fix and r['bad_bangs']:
            n = fix_bad_bangs(md)
            totals['bang_fixed'] += n

    return dict(results), totals


def print_report(results: dict, totals: dict, fix: bool, verbose: bool):
    print(f"\n{'='*58}")
    print(f"§13.1.1 check_links 결과  ({'--fix 적용' if fix else 'DRY-RUN'})")
    print(f"{'='*58}")
    print(f"  Files checked: {totals['files_checked']}개")
    print(f"  정상 이미지 Links: {totals['ok_images']}개")
    print()

    # A
    print(f"  [A] 깨진 이미지 링크 (![[img.png]] → attachments 없음): "
          f"{totals['broken_images']}개")
    if verbose or totals['broken_images']:
        for fname, r in results.items():
            if r['broken_images']:
                print(f"    ● {fname[:55]}")
                for img in r['broken_images'][:5]:
                    print(f"        ![[{img[:50]}]]")
                if len(r['broken_images']) > 5:
                    print(f"        ... 외 {len(r['broken_images'])-5}개")

    # B
    print(f"\n  [B] 깨진 문서 링크 ([[stem]] → active 없음): "
          f"{totals['broken_docs']}개")
    if verbose or totals['broken_docs']:
        for fname, r in results.items():
            if r['broken_docs']:
                print(f"    ● {fname[:55]}")
                for stem in r['broken_docs'][:5]:
                    print(f"        [[{stem[:50]}]]")
                if len(r['broken_docs']) > 5:
                    print(f"        ... 외 {len(r['broken_docs'])-5}개")

    # C
    print(f"\n  [C] 잘못된 패턴 (![[stem]] 이미지 확장자 없음): "
          f"{totals['bad_bangs']}개")
    if fix:
        print(f"      → {totals['bang_fixed']}개 자동 수정 (! 제거)")
    else:
        print(f"      → --fix 옵션 추가 시 자동 수정")
    if verbose or totals['bad_bangs']:
        for fname, r in results.items():
            if r['bad_bangs']:
                print(f"    ● {fname[:55]}")
                for stem in r['bad_bangs'][:5]:
                    print(f"        ![[{stem[:50]}]] → [[{stem[:50]}]]")

    print(f"\n── Goal achievement ──────────────────────────────────────")
    a_ok = totals['broken_images'] == 0
    b_ok = totals['broken_docs'] == 0
    c_ok = totals['bad_bangs'] == 0
    print(f"  깨진 이미지 Links: {totals['broken_images']}개  {'✅' if a_ok else '❌ (attachments 폴더 확인 필요)'}")
    print(f"  깨진 문서 Links:   {totals['broken_docs']}개  {'✅' if b_ok else '❌'}")
    print(f"  잘못된 ! 패턴:    {totals['bad_bangs']}개  {'✅' if c_ok else '❌ (--fix 로 수정 가능)'}")

    if a_ok and b_ok and c_ok:
        print("\n  🎉 All links valid!")


def main():
    parser = argparse.ArgumentParser(description='§13.1.1 이미지/문서 링크 분리 점검')
    parser.add_argument('active_dir', help='active/ folder path')
    parser.add_argument('--attachments', help='attachments 폴더 경로 (기본: active/../attachments)')
    parser.add_argument('--fix', action='store_true', help='C 유형 ![[stem]] → [[stem]] 자동 수정')
    parser.add_argument('--verbose', '-v', action='store_true', help='Detailed output of all items')
    args = parser.parse_args()

    active_dir = Path(args.active_dir)
    if not active_dir.is_dir():
        print(f"Error: {active_dir} not found"); sys.exit(1)

    attachments_dir = Path(args.attachments) if args.attachments \
                      else active_dir.parent / 'attachments'

    print(f"§13.1.1 check_links starting...")
    print(f"  active:      {active_dir}")
    print(f"  attachments: {attachments_dir} ({'존재' if attachments_dir.exists() else '없음'})")

    results, totals = run(active_dir, attachments_dir, fix=args.fix, verbose=args.verbose)
    print_report(results, totals, fix=args.fix, verbose=args.verbose)


if __name__ == '__main__':
    main()
