#!/usr/bin/env python3
"""
incremental_update.py — 신규 HTML 파일 증분 처리 도구

새로운 Confluence HTML 파일이 downloaded_pages/ 에 추가되었을 때
refined_vault/ 에 이미 있는 파일은 건너뛰고 신규 파일만 변환.

사용법:
  python incremental_update.py \\
      --src    /path/to/downloaded_pages \\
      --vault  /path/to/refined_vault \\
      --scripts /path/to/.manual/scripts

  # 변환 후 자동으로 normalize + enhance + gen_index 실행
  python incremental_update.py --src ... --vault ... --scripts ... --full-pipeline
"""

import sys
import subprocess
import argparse
from pathlib import Path


def get_existing_page_ids(active_dir: Path) -> set:
    """이미 변환된 파일의 page_id 수집."""
    import re
    ids = set()
    for md in active_dir.glob('*.md'):
        try:
            content = md.read_text(encoding='utf-8', errors='replace')[:400]
            m = re.search(r'page_id:\s*["\']?(\d+)["\']?', content)
            if m:
                ids.add(m.group(1))
        except Exception:
            continue
    return ids


def find_new_html_files(src_dirs: list, existing_ids: set) -> list:
    """신규 HTML 파일 목록 (기존 page_id 제외)."""
    import re
    new_files = []
    for src_dir in src_dirs:
        src_path = Path(src_dir)
        if not src_path.is_dir():
            print(f"  ⚠️  경로 없음: {src_dir}")
            continue
        for html in src_path.glob('*.html'):
            # page_id를 파일명에서 추출 (숫자_제목.html 형식)
            m = re.match(r'^(\d+)_', html.stem)
            page_id = m.group(1) if m else None
            if page_id and page_id in existing_ids:
                continue  # 이미 존재
            new_files.append(html)
    return new_files


def run_pipeline_step(script: Path, args: list):
    """외부 스크립트 실행."""
    cmd = [sys.executable, str(script)] + args
    result = subprocess.run(cmd, capture_output=False)
    return result.returncode


def main():
    parser = argparse.ArgumentParser(description='신규 HTML 증분 변환')
    parser.add_argument('--src', nargs='+', required=True,
                        help='downloaded_pages 폴더 경로 (여러 개 가능)')
    parser.add_argument('--vault', required=True,
                        help='refined_vault/ 폴더 경로')
    parser.add_argument('--scripts', required=True,
                        help='.manual/scripts/ 폴더 경로')
    parser.add_argument('--full-pipeline', action='store_true',
                        help='변환 후 normalize + enhance + gen_index 실행')
    args = parser.parse_args()

    vault = Path(args.vault)
    active_dir = vault / 'active'
    scripts_dir = Path(args.scripts)

    if not active_dir.is_dir():
        print(f"오류: active/ 폴더 없음: {active_dir}")
        sys.exit(1)

    print("기존 page_id 수집 중...")
    existing = get_existing_page_ids(active_dir)
    print(f"  기존 파일: {len(existing)}개")

    print("신규 HTML 탐색 중...")
    new_html = find_new_html_files(args.src, existing)
    print(f"  신규 파일: {len(new_html)}개")

    if not new_html:
        print("신규 파일 없음. 종료.")
        return

    # 임시 폴더에 신규 파일 모아서 변환
    import tempfile, shutil
    with tempfile.TemporaryDirectory() as tmp:
        tmp_src = Path(tmp) / 'new_html'
        tmp_src.mkdir()
        for html in new_html:
            # files 폴더도 같이 복사
            shutil.copy2(html, tmp_src / html.name)
            files_dir = html.parent / f'{html.stem}_files'
            if files_dir.is_dir():
                shutil.copytree(files_dir, tmp_src / files_dir.name)

        print(f"\n변환 시작 ({len(new_html)}개)...")
        ret = run_pipeline_step(
            scripts_dir / 'refine_html_to_md.py',
            [str(tmp_src), str(active_dir), str(vault / 'attachments')]
        )
        if ret != 0:
            print("변환 실패!")
            sys.exit(ret)

    if args.full_pipeline:
        print("\n파이프라인 추가 단계 실행...")

        print("  normalize_frontmatter.py ...")
        run_pipeline_step(scripts_dir / 'normalize_frontmatter.py', [str(active_dir)])

        print("  enhance_wikilinks.py ...")
        run_pipeline_step(scripts_dir / 'enhance_wikilinks.py', [str(active_dir)])

        print("  inject_keywords.py ...")
        inject = scripts_dir / 'inject_keywords.py'
        if not inject.exists():
            inject = scripts_dir.parent.parent / '.tools' / 'inject_keywords.py'
        if inject.exists():
            run_pipeline_step(inject, [str(active_dir)])

        print("  gen_year_hubs.py ...")
        run_pipeline_step(scripts_dir / 'gen_year_hubs.py', [str(active_dir)])

        print("  gen_index.py ...")
        run_pipeline_step(scripts_dir / 'gen_index.py', [str(active_dir)])

    print("\n✅ 증분 업데이트 완료")


if __name__ == '__main__':
    main()
