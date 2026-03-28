"""
PDF → Markdown 변환 스크립트
────────────────────────────────────────────────────────
사용법:
    python pdf_to_md.py <input.pdf> <output_folder> [source_url]

출력:
    output_folder/<파일명>.md
    (프론트매터 포함, 페이지 구분 주석 삽입)

의존 패키지:
    pip install pdfplumber
"""

import sys
import os
import re
import warnings
from datetime import date

warnings.filterwarnings("ignore")

try:
    import pdfplumber
except ImportError:
    print("ERROR: pdfplumber가 설치되어 있지 않습니다.")
    print("  pip install pdfplumber")
    sys.exit(1)

# ── 노이즈 패턴 ──────────────────────────────────────────────────────────────
# 플랫폼별 헤더/푸터/저작권 문구 등 제거 대상
NOISE_PATTERNS = [
    r"^\s*\d+\s*$",                              # 단독 페이지 번호
    r"https?://\S+\s+\d+/\d+",                  # URL + 페이지 번호
    r"Powered by (Atlassian|Notion|Confluence)", # 플랫폼 잔재
    r"Edit this page",
    r"View history",
    r"CC BY",                                    # 저작권 고지
    r"All rights reserved",
    r"이 저작물은.*따라",
    r"저작권.*보호",
]

# ── 함수 ─────────────────────────────────────────────────────────────────────

def clean_text(text: str) -> str:
    """페이지 텍스트에서 노이즈 라인 제거"""
    lines = text.split("\n")
    cleaned = []
    for line in lines:
        skip = any(re.search(p, line, re.IGNORECASE) for p in NOISE_PATTERNS)
        if not skip and line.strip():
            cleaned.append(line)
    return "\n".join(cleaned)


def extract_tables(page) -> list[str]:
    """페이지에서 마크다운 테이블 추출"""
    tables = []
    for table in page.extract_tables():
        if not table:
            continue
        rows = []
        for i, row in enumerate(table):
            cells = [str(c or "").replace("\n", " ").strip() for c in row]
            rows.append("| " + " | ".join(cells) + " |")
            if i == 0:
                rows.append("| " + " | ".join(["---"] * len(cells)) + " |")
        tables.append("\n".join(rows))
    return tables


def pdf_to_markdown(pdf_path: str, output_dir: str, source_url: str = "") -> str:
    """PDF 파일을 단일 Markdown 파일로 변환"""
    os.makedirs(output_dir, exist_ok=True)
    base_name = os.path.splitext(os.path.basename(pdf_path))[0]
    output_path = os.path.join(output_dir, f"{base_name}.md")

    frontmatter = (
        "---\n"
        f"date: {date.today().isoformat()}\n"
        "type: reference\n"
        "status: active\n"
        "tags: []\n"
        f'source: "{source_url}"\n'
        "origin: pdf\n"
        "---\n\n"
        f"# {base_name}\n\n"
    )

    body_parts = []
    with pdfplumber.open(pdf_path) as pdf:
        total = len(pdf.pages)
        for i, page in enumerate(pdf.pages):
            # 텍스트
            text = page.extract_text() or ""
            text = clean_text(text)

            # 테이블 (텍스트 추출로 누락되는 경우 보완)
            table_md = "\n\n".join(extract_tables(page))

            if text or table_md:
                body_parts.append(f"\n<!-- PAGE {i+1}/{total} -->\n")
                if text:
                    body_parts.append(text)
                if table_md:
                    body_parts.append("\n\n" + table_md)

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(frontmatter + "\n".join(body_parts))

    print(f"저장 완료: {output_path}")
    return output_path


# ── 진입점 ───────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)

    _pdf   = sys.argv[1]
    _out   = sys.argv[2]
    _src   = sys.argv[3] if len(sys.argv) > 3 else ""

    if not os.path.isfile(_pdf):
        print(f"ERROR: 파일을 찾을 수 없습니다: {_pdf}")
        sys.exit(1)

    pdf_to_markdown(_pdf, _out, _src)
