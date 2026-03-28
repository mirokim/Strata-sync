#!/usr/bin/env python3
"""
pdf_import.py — PDF → Markdown conversion and vault storage

opendataloader-pdf 라이브러리 사용 (벤치마크 1위 PDF 파서)
  pip install -U opendataloader-pdf

Usage:
  python pdf_import.py <pdf_path_or_dir> <output_dir> [--title <제목>]

Output:
  - <output_dir>/<title>.md  (단일 PDF)
  - <output_dir>/<각 파일명>.md  (폴더 입력)
"""

import argparse
import os
import re
import shutil
import sys
import tempfile
from datetime import datetime
from pathlib import Path


def safe_filename(name: str) -> str:
    return re.sub(r'[<>:"/\\|?*]', '_', name).strip()


def make_frontmatter(title: str, source_path: str, today: str) -> str:
    return (
        f'---\n'
        f'title: "{title.replace(chr(34), chr(39))}"\n'
        f'created: {today}\n'
        f'modified: {today}\n'
        f'source: pdf\n'
        f'source_file: "{Path(source_path).name}"\n'
        f'tags: [pdf]\n'
        f'---\n\n'
    )


def convert_pdf(input_path: str, output_dir: str, title: str | None = None) -> list[str]:
    try:
        import opendataloader_pdf  # type: ignore
    except ImportError:
        print("ERROR: opendataloader-pdf 미설치\n  pip install -U opendataloader-pdf", file=sys.stderr)
        sys.exit(1)

    os.makedirs(output_dir, exist_ok=True)
    today = datetime.today().strftime('%Y-%m-%d')
    results: list[str] = []

    with tempfile.TemporaryDirectory() as tmp:
        opendataloader_pdf.convert(
            input_path=[input_path],
            output_dir=tmp,
            format='markdown',
        )

        md_files = list(Path(tmp).rglob('*.md'))
        if not md_files:
            print(f"ERROR: {input_path} — Markdown 출력 없음", file=sys.stderr)
            sys.exit(2)

        for md_file in md_files:
            raw = md_file.read_text(encoding='utf-8', errors='replace')

            # 제목 결정: 명시 > 첫 번째 H1 > PDF 파일명
            doc_title = title
            if not doc_title:
                m = re.search(r'^#\s+(.+)', raw, re.MULTILINE)
                doc_title = m.group(1).strip() if m else Path(input_path).stem

            filename = safe_filename(doc_title) + '.md'
            dest = Path(output_dir) / filename

            content = make_frontmatter(doc_title, input_path, today) + raw
            dest.write_text(content, encoding='utf-8')
            results.append(f'✓ {filename} ({len(raw):,}자)')

    return results


def main() -> None:
    parser = argparse.ArgumentParser(description='PDF → Markdown 변환')
    parser.add_argument('input',  help='PDF 파일 또는 폴더 경로')
    parser.add_argument('output', help='저장할 볼트 폴더 경로')
    parser.add_argument('--title', default='', help='문서 제목 (단일 PDF일 때)')
    args = parser.parse_args()

    input_path = args.input
    if not os.path.exists(input_path):
        print(f'ERROR: 파일 없음: {input_path}', file=sys.stderr)
        sys.exit(1)

    title = args.title.strip() or None
    results = convert_pdf(input_path, args.output, title)

    print(f'PDF 변환 Complete ({len(results)}개)')
    for r in results:
        print(r)


if __name__ == '__main__':
    main()
