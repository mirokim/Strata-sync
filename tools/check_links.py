#!/usr/bin/env python3
"""
check_links.py — §13.1.1 이미지/문서 링크 분리 점검

매뉴얼 §13.1.1 기준:
  패턴                          처리
  ![[파일명.png/jpg/gif/...]]   이미지 링크 → attachments/ 폴더 존재 확인
  [[stem]] (확장자 없음)        문서 링크 → active 파일 stem 존재 확인
  ![[stem]] (이미지 확장자 없음) 잘못된 패턴 → [[stem]] 으로 수정 필요 (! 제거)

출력:
  A. 깨진 이미지 링크 (![[image.png]] → attachments에 없음)
  B. 깨진 문서 링크 ([[stem]] → active에 없음)
  C. 잘못된 패턴 (![[stem]] 이미지 확장자 없음)
  D. 이미지 링크 전체 현황 (개수, 파일 분포)

사용법:
  python check_links.py <active_dir> [--attachments <dir>] [--fix] [--verbose]

--fix 옵션:
  C 유형 ([[stem]] 잘못된 ! 제거) 자동 수정
"""

import re
import sys
import argparse
from pathlib import Path
from collections import defaultdict


IMAGE_EXTS = {'.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.tiff', '.tif',
              '.wmf', '.emf', '.mp4', '.mov', '.avi', '.pdf', '.psd', '.ai'}  # Obsidian 비지원 포함

# 이미지 확장자가 있는 ![[...]] 패턴
IMG_LINK_RE  = re.compile(r'!\[\[([^\]]+\.(?:png|jpg|jpeg|gif|svg|webp|bmp|tiff|tif))\]\]', re.IGNORECASE)
# 이미지 확장자 없이 ![[...]] 패턴 (잘못된 형태)
BAD_BANG_RE  = re.compile(r'!\[\[([^\]]+)\]\]')
# 일반 문서 wikilink
DOC_LINK_RE  = re.compile(r'(?<!!)\[\[([^\]]+)\]\]')


def scan_file(md: Path, all_stems: set, attachments_dir: Path
              ) -> dict:
    try:
        content = md.read_text(encoding='utf-8', errors='replace')
    except Exception:
        return {}

    # frontmatter 제외
    fm_end = content.find('\n---\n', 4) if content.startswith('---') else -1
    body = content[fm_end + 5:] if fm_end != -1 else content

    broken_images  = []   # A
    broken_docs    = []   # B
    bad_bangs      = []   # C
    ok_images      = []   # 정상 이미지 링크

    # A: 이미지 링크 검사
    for m in IMG_LINK_RE.finditer(body):
        fname = m.group(1).strip()
        target = attachments_dir / fname
        if target.exists():
            ok_images.append(fname)
        else:
            broken_images.append(fname)

    # C: 잘못된 ![[stem]] (이미지 확장자 없음)
    for m in BAD_BANG_RE.finditer(body):
        inner = m.group(1).strip()
        ext = Path(inner).suffix.lower()
        if ext not in IMAGE_EXTS:
            bad_bangs.append(inner)

    # B: 문서 링크 검사 (stem이 [로 시작하면 3중 브래킷 — audit_and_fix F1 대상)
    # 미디어 확장자가 있는 [[stem.ext]]는 이미지/미디어 링크로 처리 (B 제외)
    for m in DOC_LINK_RE.finditer(body):
        inner = m.group(1)
        stem  = inner.split('|')[0].strip()
        if stem.startswith('['):
            continue   # [[[stem]] 패턴 — audit_and_fix.py F1 수정 후 재점검
        ext = Path(stem).suffix.lower()
        if ext in IMAGE_EXTS:
            continue   # 미디어/이미지 확장자 → A타입으로 분류 (별도 처리)
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

        # C 유형 자동 수정
        if fix and r['bad_bangs']:
            n = fix_bad_bangs(md)
            totals['bang_fixed'] += n

    return dict(results), totals


def print_report(results: dict, totals: dict, fix: bool, verbose: bool):
    print(f"\n{'='*58}")
    print(f"§13.1.1 check_links 결과  ({'--fix 적용' if fix else 'DRY-RUN'})")
    print(f"{'='*58}")
    print(f"  검사 파일: {totals['files_checked']}개")
    print(f"  정상 이미지 링크: {totals['ok_images']}개")
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

    print(f"\n── 목표 달성 여부 ──────────────────────────────────────")
    a_ok = totals['broken_images'] == 0
    b_ok = totals['broken_docs'] == 0
    c_ok = totals['bad_bangs'] == 0
    print(f"  깨진 이미지 링크: {totals['broken_images']}개  {'✅' if a_ok else '❌ (attachments 폴더 확인 필요)'}")
    print(f"  깨진 문서 링크:   {totals['broken_docs']}개  {'✅' if b_ok else '❌'}")
    print(f"  잘못된 ! 패턴:    {totals['bad_bangs']}개  {'✅' if c_ok else '❌ (--fix 로 수정 가능)'}")

    if a_ok and b_ok and c_ok:
        print("\n  🎉 모든 링크 정상!")


def main():
    parser = argparse.ArgumentParser(description='§13.1.1 이미지/문서 링크 분리 점검')
    parser.add_argument('active_dir', help='active/ 폴더 경로')
    parser.add_argument('--attachments', help='attachments 폴더 경로 (기본: active/../attachments)')
    parser.add_argument('--fix', action='store_true', help='C 유형 ![[stem]] → [[stem]] 자동 수정')
    parser.add_argument('--verbose', '-v', action='store_true', help='모든 항목 상세 출력')
    args = parser.parse_args()

    active_dir = Path(args.active_dir)
    if not active_dir.is_dir():
        print(f"오류: {active_dir} 없음"); sys.exit(1)

    attachments_dir = Path(args.attachments) if args.attachments \
                      else active_dir.parent / 'attachments'

    print(f"§13.1.1 check_links 시작...")
    print(f"  active:      {active_dir}")
    print(f"  attachments: {attachments_dir} ({'존재' if attachments_dir.exists() else '없음'})")

    results, totals = run(active_dir, attachments_dir, fix=args.fix, verbose=args.verbose)
    print_report(results, totals, fix=args.fix, verbose=args.verbose)


if __name__ == '__main__':
    main()
