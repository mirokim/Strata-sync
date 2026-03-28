#!/usr/bin/env python3
"""
check_keyword_density.py — §9.6 KEYWORD_MAP density monitoring

Pre-check what % of documents each keyword will be injected into before running inject_keywords.py.
Output warning for keywords exceeding the threshold (default 15%).

Usage:
  python check_keyword_density.py <active_dir> [--threshold 15]
"""

import re
import sys
import argparse
from pathlib import Path

# KEYWORD_MAP 공유 — inject_keywords.py 에서 import
try:
    import importlib.util
    _spec = importlib.util.spec_from_file_location(
        'inject_keywords',
        Path(__file__).parent / 'inject_keywords.py',
    )
    _mod = importlib.util.module_from_spec(_spec)   # type: ignore[arg-type]
    _spec.loader.exec_module(_mod)                  # type: ignore[union-attr]
    KEYWORD_MAP: dict[str, str] = _mod.KEYWORD_MAP
except Exception as e:
    print(f"Error: inject_keywords.py 를 로드할 수 없습니다 — {e}")
    sys.exit(1)


def split_frontmatter(content: str) -> tuple[str, str]:
    if content.startswith('---'):
        end = content.find('\n---\n', 4)
        if end != -1:
            return content[:end + 5], content[end + 5:]
    return '', content


def check_density(active_dir: Path, threshold: float = 15.0) -> None:
    md_files = list(active_dir.glob('*.md'))
    total = len(md_files)
    if total == 0:
        print("Error: .md 파일이 없습니다.")
        sys.exit(1)

    # Count files where each keyword appears
    counts: dict[str, int] = {kw: 0 for kw in KEYWORD_MAP}
    patterns: dict[str, re.Pattern] = {}
    for kw in KEYWORD_MAP:
        esc = re.escape(kw)
        patterns[kw] = re.compile(rf'(?<![가-힣\w]){esc}(?![가-힣\w])')

    for md in md_files:
        try:
            content = md.read_text(encoding='utf-8', errors='replace')
        except Exception:
            continue
        _, body = split_frontmatter(content)
        for kw, pat in patterns.items():
            if pat.search(body):
                counts[kw] += 1

    # Calculate ratios and sort (descending)
    results: list[tuple[str, str, float]] = []
    for kw, target in KEYWORD_MAP.items():
        pct = counts[kw] / total * 100
        results.append((kw, target, pct))
    results.sort(key=lambda x: -x[2])

    # Output
    print("=" * 65)
    print(f"§9.6 KEYWORD_MAP 밀도 점검 (임계값: {threshold:.0f}%, 총 {total} files)")
    print("=" * 65)

    warnings: list[tuple[str, float]] = []
    BAR_WIDTH = 20

    print(f"\n{'키워드':<14} {'등장%':>6}  {'막대그래프':<{BAR_WIDTH}}  대상 stem")
    print("-" * 65)
    for kw, target, pct in results:
        bar_len = int(pct / 100 * BAR_WIDTH)
        bar = '█' * bar_len + '░' * (BAR_WIDTH - bar_len)
        flag = ' ⚠️ ' if pct >= threshold else '    '
        stem_short = target[:35] + ('…' if len(target) > 35 else '')
        print(f"{kw:<14} {pct:5.1f}%  {bar}  {stem_short}{flag}")
        if pct >= threshold:
            warnings.append((kw, pct))

    print()
    if warnings:
        print(f"⚠️  Threshold({threshold:.0f}%) 초과 키워드: {len(warnings)}개")
        for kw, pct in warnings:
            print(f"   '{kw}' ({pct:.1f}%) — inject_keywords.py 실행 전 제거 검토")
        print()
        print("※ 제거 판단 기준: 고유 허브 의미가 없는 범용어는 제거.")
        print("  고유명사·캐릭터명은 등장률이 높아도 BFS 탐색 필수이므로 유지.")
    else:
        print(f"✅ 모든 키워드 임계값 이하 — inject_keywords.py 실행 가능")


def main():
    parser = argparse.ArgumentParser(description='§9.6 KEYWORD_MAP 밀도 감시')
    parser.add_argument('active_dir', help='active/ folder path')
    parser.add_argument('--threshold', type=float, default=15.0,
                        help='Warning threshold %% (기본: 15)')
    args = parser.parse_args()

    active_dir = Path(args.active_dir)
    if not active_dir.is_dir():
        print(f"Error: {active_dir} folder not found.")
        sys.exit(1)

    check_density(active_dir, threshold=args.threshold)


if __name__ == '__main__':
    main()
