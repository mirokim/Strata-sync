"""
이미지/문서 링크 분리 점검 스크립트 (check_links.py)  v1.0
────────────────────────────────────────────────────────
기능:
  active/ 폴더의 마크다운 파일에서 wikilink를 이미지 링크와
  문서 링크로 분리하고, 각각의 문제를 보고한다.

점검 항목:
  ① ![[stem]] (이미지 확장자 없음) — 잘못된 패턴 (! 제거 권장)
  ② ![[image.ext]] — 이미지 링크 존재 여부 (attachments/ 확인)
  ③ [[stem]] — 문서 링크 broken 여부 (active stem 집합 기준)
  ④ 이미지 파일명 규칙 위반 ({stem}_p{page}_{idx}.png 기준)

사용법:
    python check_links.py <vault_dir> [--vault <vault_root>]

의존 패키지:
    없음 (표준 라이브러리만 사용)
"""

import os
import re
import sys

IMAGE_EXTS = {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.tiff'}
WIKILINK_PAT    = re.compile(r'(!?)\[\[([^\[\]]+?)\]\]')
IMG_NAME_PAT    = re.compile(r'.+_p\d+_\d+\.(png|jpg|jpeg|gif|webp)$', re.I)


def resolve_active_dir(vault_dir: str) -> str:
    active = os.path.join(vault_dir, 'active')
    if os.path.isdir(active):
        return active
    return vault_dir


def run(active_dir: str, vault_root: str | None = None) -> None:
    vault_root = vault_root or active_dir

    # 유효 stem 집합 (전체 vault 기준)
    all_stems: set[str] = set()
    for root, dirs, files in os.walk(vault_root):
        dirs[:] = [d for d in dirs if not d.startswith('.')]
        for f in files:
            if f.endswith('.md'):
                all_stems.add(f[:-3])

    # attachments/ 폴더 파일 집합
    attachment_files: set[str] = set()
    for cand in [os.path.join(vault_root, 'attachments'),
                 os.path.join(active_dir, 'attachments')]:
        if os.path.isdir(cand):
            for f in os.listdir(cand):
                attachment_files.add(f.lower())

    md_files = sorted(f for f in os.listdir(active_dir) if f.endswith('.md'))
    total = len(md_files)

    bad_bang:    list[tuple[str, str]] = []   # ① ![[non-image]]
    broken_img:  list[tuple[str, str]] = []   # ② ![[img]] 파일 없음
    broken_doc:  list[tuple[str, str]] = []   # ③ [[stem]] broken
    bad_imgname: list[tuple[str, str]] = []   # ④ 이미지 파일명 규칙 위반

    for fname in md_files:
        path = os.path.join(active_dir, fname)
        stem = fname[:-3]
        try:
            with open(path, encoding='utf-8') as f:
                text = f.read()
        except Exception:
            continue

        for m in WIKILINK_PAT.finditer(text):
            bang    = m.group(1)      # '!' or ''
            content = m.group(2)
            inner   = content.split('|')[0].strip()
            _, ext  = os.path.splitext(inner)
            is_img_ext = ext.lower() in IMAGE_EXTS

            if bang:
                if not is_img_ext:
                    # ① ![[stem]] 잘못된 패턴
                    bad_bang.append((stem, inner[:60]))
                else:
                    # ② 이미지 링크 — attachments 존재 확인
                    img_fname = os.path.basename(inner)
                    if img_fname.lower() not in attachment_files:
                        broken_img.append((stem, inner[:60]))
                    else:
                        # ④ 이미지 파일명 규칙
                        if not IMG_NAME_PAT.match(img_fname):
                            bad_imgname.append((stem, img_fname))
            else:
                if not is_img_ext and inner and inner not in all_stems:
                    # ③ 문서 broken link
                    broken_doc.append((stem, inner[:60]))

    print(f"\n{'='*60}")
    print(f" 링크 점검 보고서  v1.0")
    print(f" 대상: {active_dir}")
    print(f" 파일 수: {total}개  |  vault stem 수: {len(all_stems)}개")
    print(f"{'='*60}\n")

    def show(label: str, items: list, warn: bool = True) -> None:
        status = 'WARN' if (items and warn) else 'PASS'
        print(f"[{status}] {label}: {len(items)}건")
        for item in items[:8]:
            print(f"       - {item[0][:40]}: {item[1]}")
        if len(items) > 8:
            print(f"       ... 외 {len(items)-8}건")
        print()

    show("① ![[non-image]] 잘못된 bang 패턴 (! 제거 필요)", bad_bang)
    show("② 존재하지 않는 이미지 링크 (![[img]])", broken_img)
    show("③ 존재하지 않는 문서 링크 ([[stem]])", broken_doc)
    show("④ 이미지 파일명 규칙 위반 (stem_p#_#.ext 기대)", bad_imgname, warn=False)

    total_issues = len(bad_bang) + len(broken_img) + len(broken_doc)
    print(f"{'='*60}")
    print(f" 수정 권장 이슈: {total_issues}건  "
          f"(audit_and_fix.py --fix 로 일부 자동 수정 가능)")
    print(f"{'='*60}\n")


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    vault = sys.argv[3] if len(sys.argv) >= 4 and sys.argv[2] == '--vault' else None
    active_dir = resolve_active_dir(sys.argv[1])
    run(active_dir, vault or sys.argv[1])
