#!/usr/bin/env python3
"""
fix_image_links.py — Fix broken image links for filenames with parentheses

문제: 파일명에 ')'가 포함된 첨부파일을 참조할 때
  ![[stem_without_paren]]_N.ext)   ← 잘못된 형식
  ![[stem_without_paren) rest]]_N.ext)  ← 잘못된 형식

원인: postprocess_md에서 정규식 [^)]+ 이 ')'에서 멈춰 파일명 잘림

Modified: 두 가지 패턴을 attachment 파일 목록과 대조하여 복원

Usage:
  python fix_image_links.py <active_dir> <attachments_dir>
"""

import re
import sys
from pathlib import Path


def fix_image_links(active_dir: Path, attachments_dir: Path) -> int:
    all_attachments = {f.name for f in attachments_dir.iterdir()} if attachments_dir.exists() else set()

    # 패턴 1: ![[STEM]]_N.ext)  → STEM + ')' + _N.ext 가 attachment에 있는 경우
    pattern1 = re.compile(r'!\[\[([^\]]+)\]\](_\d+\.\w+)\)')

    # 패턴 2: ![[STEM]] REST)   → STEM + ')' + REST 가 attachment에 있는 경우
    pattern2 = re.compile(r'!\[\[([^\]]+)\]\]([^)]*)\)')

    total_fixed = 0

    for md in sorted(active_dir.glob('*.md')):
        content = md.read_text(encoding='utf-8', errors='replace')

        def fix_p1(m):
            stem, suffix = m.group(1), m.group(2)
            candidate = f"{stem}){suffix}"
            if candidate in all_attachments:
                return f'![[{candidate}]]'
            return m.group(0)

        def fix_p2(m):
            stem, suffix = m.group(1), m.group(2)
            candidate = f"{stem}){suffix}"
            if candidate in all_attachments:
                return f'![[{candidate}]]'
            return m.group(0)

        new_content, n1 = pattern1.subn(fix_p1, content)
        new_content, n2 = pattern2.subn(fix_p2, new_content)
        n = n1 + n2

        if n > 0:
            md.write_text(new_content, encoding='utf-8')
            total_fixed += n
            print(f"  Modified: {md.name} ({n}개)")

    return total_fixed


def main():
    if len(sys.argv) < 3:
        print(f"Usage: python {sys.argv[0]} <active_dir> <attachments_dir>")
        sys.exit(1)

    active_dir = Path(sys.argv[1])
    attachments_dir = Path(sys.argv[2])

    print("이미지 링크 버그 수정 starting...")
    n = fix_image_links(active_dir, attachments_dir)
    print(f"\n총 {n}개 링크 수정 Complete")


if __name__ == '__main__':
    main()
