#!/usr/bin/env python3
"""
pdf_to_md.py — §4.2 PDF → Obsidian Markdown 변환

PDF를 세 케이스로 자동 분기:
  텍스트PDF  — pdfplumber로 텍스트+표 추출, pymupdf로 이미지 추출
  스캔PDF    — 페이지 전체를 PNG 이미지로 변환 (OCR 생략 가능)
  혼합PDF    — 텍스트 추출 + 페이지 이미지 병행 (아트/기획 슬라이드 등)

이미지 파일명 규칙: {stem}_p{페이지번호}_{순번}.png

사용법:
  python pdf_to_md.py <src_dir_or_file> <active_dir> <attachments_dir>

  # 단일 파일
  python pdf_to_md.py /path/file.pdf active/ attachments/

  # 폴더 재귀 (하위 _files 폴더 포함)
  python pdf_to_md.py /path/downloaded_pages active/ attachments/
"""

import re
import sys
import os
import shutil
import argparse
from pathlib import Path
from datetime import datetime

try:
    import pdfplumber
except ImportError:
    print("ERROR: pip install pdfplumber --break-system-packages")
    sys.exit(1)

try:
    import fitz  # pymupdf
except ImportError:
    print("ERROR: pip install pymupdf --break-system-packages")
    sys.exit(1)


# ── 노이즈 제거 패턴 (§4.2.1) ─────────────────────────────────────
NOISE_PATTERNS = [
    re.compile(r'Powered\s+by\s+Confluence', re.I),
    re.compile(r'Edit\s+this\s+page', re.I),
    re.compile(r'View\s+history', re.I),
    re.compile(r'All\s+rights\s+reserved', re.I),
    re.compile(r'CC\s+BY', re.I),
    re.compile(r'https?://\S+\s+\d+/\d+'),   # URL + 페이지번호
    re.compile(r'^\s*\d+\s*/\s*\d+\s*$'),      # 단독 페이지번호
]

# 페이지당 텍스트가 이 수치 이상이면 "텍스트 PDF"
TEXT_PDF_THRESHOLD = 150   # 글자/페이지
HYBRID_THRESHOLD   = 30    # 글자/페이지 (이 미만이면 순수 스캔)

# 이미지 DPI (페이지 → PNG 변환 시)
PAGE_IMAGE_DPI = 150


def detect_pdf_type(pdf_path: Path) -> str:
    """PDF 종류 판별: 'text' | 'hybrid' | 'scan'"""
    try:
        with pdfplumber.open(pdf_path) as pdf:
            if not pdf.pages:
                return 'scan'
            sample_pages = pdf.pages[:min(3, len(pdf.pages))]
            total_chars = sum(
                len((p.extract_text() or '').strip())
                for p in sample_pages
            )
            avg = total_chars / len(sample_pages)
            if avg >= TEXT_PDF_THRESHOLD:
                return 'text'
            elif avg >= HYBRID_THRESHOLD:
                return 'hybrid'
            else:
                return 'scan'
    except Exception:
        return 'scan'


def clean_text(text: str) -> str:
    """노이즈 제거 및 정규화"""
    if not text:
        return ''
    lines = text.split('\n')
    cleaned = []
    for line in lines:
        if any(p.search(line) for p in NOISE_PATTERNS):
            continue
        cleaned.append(line)
    return '\n'.join(cleaned).strip()


def extract_page_image(page, stem: str, page_num: int, img_idx: int, attachments_dir: Path) -> str:
    """pymupdf 페이지를 PNG로 변환 후 attachments/ 저장. 파일명 반환."""
    fname = f"{stem}_p{page_num}_{img_idx}.png"
    out_path = attachments_dir / fname
    if out_path.exists():
        return fname
    try:
        mat = fitz.Matrix(PAGE_IMAGE_DPI / 72, PAGE_IMAGE_DPI / 72)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        pix.save(str(out_path))
        return fname
    except Exception as e:
        return ''


def extract_embedded_images(fitz_page, stem: str, page_num: int, attachments_dir: Path) -> list:
    """페이지 내 임베딩된 이미지 추출. 파일명 목록 반환."""
    fnames = []
    try:
        image_list = fitz_page.get_images(full=True)
        for img_idx, img_info in enumerate(image_list, start=1):
            xref = img_info[0]
            fname = f"{stem}_p{page_num}_{img_idx}.png"
            out_path = attachments_dir / fname
            if out_path.exists():
                fnames.append(fname)
                continue
            try:
                base_image = fitz_page.parent.extract_image(xref)
                img_bytes = base_image.get('image', b'')
                ext = base_image.get('ext', 'png')
                if img_bytes and len(img_bytes) > 2000:  # 너무 작은 이미지(아이콘) 제외
                    fname_ext = f"{stem}_p{page_num}_{img_idx}.{ext}"
                    out_path_ext = attachments_dir / fname_ext
                    out_path_ext.write_bytes(img_bytes)
                    fnames.append(fname_ext)
            except Exception:
                continue
    except Exception:
        pass
    return fnames


def pdf_to_md(pdf_path: Path, active_dir: Path, attachments_dir: Path) -> bool:
    """단일 PDF → MD 변환. 성공 시 True."""
    stem = pdf_path.stem
    # 특수문자 정리 (파일명에 쓸 수 없는 것들)
    safe_stem = re.sub(r'[<>:"/\\|?*]', '_', stem)
    out_md = active_dir / f"{safe_stem}.md"

    if out_md.exists():
        return False  # 이미 변환됨

    pdf_type = detect_pdf_type(pdf_path)
    sections = []
    image_files = []

    try:
        with pdfplumber.open(pdf_path) as pdf:
            n_pages = len(pdf.pages)
            doc = fitz.open(str(pdf_path))

            for page_num in range(1, n_pages + 1):
                pl_page = pdf.pages[page_num - 1]
                fz_page = doc[page_num - 1]
                section_lines = [f"## 페이지 {page_num}"]

                # 텍스트 추출
                raw_text = pl_page.extract_text() or ''
                text = clean_text(raw_text)

                # 표 추출
                tables_md = []
                try:
                    for tbl in pl_page.extract_tables():
                        if not tbl:
                            continue
                        rows = []
                        for i, row in enumerate(tbl):
                            cells = [str(c or '').replace('\n', ' ').replace('|', '\\|') for c in row]
                            rows.append('| ' + ' | '.join(cells) + ' |')
                            if i == 0:
                                rows.append('| ' + ' | '.join(['---'] * len(cells)) + ' |')
                        tables_md.append('\n'.join(rows))
                except Exception:
                    pass

                # 이미지 처리
                if pdf_type == 'text':
                    # 텍스트 PDF: 임베딩 이미지만 추출
                    imgs = extract_embedded_images(fz_page, safe_stem, page_num, attachments_dir)
                    image_files.extend(imgs)
                elif pdf_type == 'hybrid':
                    # 혼합: 텍스트가 빈 페이지는 페이지 전체 이미지로 대체
                    if len(text.strip()) < 50:
                        fname = extract_page_image(fz_page, safe_stem, page_num, 1, attachments_dir)
                        if fname:
                            image_files.append(fname)
                            imgs = [fname]
                        else:
                            imgs = []
                    else:
                        imgs = extract_embedded_images(fz_page, safe_stem, page_num, attachments_dir)
                        image_files.extend(imgs)
                else:  # scan
                    # 스캔: 페이지 전체 이미지
                    fname = extract_page_image(fz_page, safe_stem, page_num, 1, attachments_dir)
                    if fname:
                        image_files.append(fname)
                        imgs = [fname]
                    else:
                        imgs = []

                # 섹션 구성
                if text:
                    section_lines.append(text)
                for tbl in tables_md:
                    section_lines.append(tbl)
                for img in (imgs if pdf_type != 'text' else image_files[-len(imgs):]):
                    section_lines.append(f"![[{img}]]")

                sections.append('\n\n'.join(section_lines))

            doc.close()

    except Exception as e:
        print(f"  ✗ {pdf_path.name}: {e}")
        return False

    # frontmatter
    try:
        mtime = pdf_path.stat().st_mtime
        date_str = datetime.fromtimestamp(mtime).strftime('%Y-%m-%d')
    except Exception:
        date_str = datetime.now().strftime('%Y-%m-%d')

    # 날짜 파일명에서 추출 시도
    m_date = re.search(r'(\d{4})[_\-]?(\d{2})[_\-]?(\d{2})', stem)
    if m_date:
        try:
            date_str = f"{m_date.group(1)}-{m_date.group(2)}-{m_date.group(3)}"
        except Exception:
            pass

    # type 추정
    doc_type = 'spec'
    if any(kw in stem for kw in ['정례', '보고', '피드백', '회의', '이사장']):
        doc_type = 'meeting'
    elif any(kw in stem for kw in ['가이드', '매뉴얼', '튜토리얼']):
        doc_type = 'guide'
    elif any(kw in stem for kw in ['레퍼런스', '분석', '조사']):
        doc_type = 'reference'

    # 본문 생성
    body_content = '\n\n---\n\n'.join(sections)

    n_img = len(image_files)
    md_content = f"""---
title: "{stem}"
date: {date_str}
type: {doc_type}
status: active
tags: []
source: "{pdf_path.name}"
origin: pdf
pdf_type: {pdf_type}
pages: {n_pages if 'n_pages' in dir() else 0}
---

# {stem}

> 원본: `{pdf_path.name}` ({pdf_type} PDF, {n_pages if 'n_pages' in dir() else '?'}페이지)

## 개요

{body_content}
"""

    out_md.write_text(md_content, encoding='utf-8')
    return True


def process_directory(src_dir: Path, active_dir: Path, attachments_dir: Path) -> tuple:
    """디렉토리 내 모든 PDF (재귀) 처리. (성공, 실패, 스킵) 반환."""
    pdfs = list(src_dir.rglob('*.pdf'))
    success = skip = fail = 0
    for pdf in pdfs:
        safe = re.sub(r'[<>:"/\\|?*]', '_', pdf.stem)
        already_exists = (active_dir / f"{safe}.md").exists()
        if already_exists:
            skip += 1
            continue
        ok = pdf_to_md(pdf, active_dir, attachments_dir)
        if ok:
            success += 1
            if success % 20 == 0:
                print(f"  ... {success}개 완료")
        else:
            fail += 1
    return success, fail, skip


def main():
    parser = argparse.ArgumentParser(description='§4.2 PDF → Markdown 변환')
    parser.add_argument('src', help='PDF 파일 또는 디렉토리 경로')
    parser.add_argument('active_dir', help='active/ 폴더 경로')
    parser.add_argument('attachments_dir', help='attachments/ 폴더 경로')
    args = parser.parse_args()

    src = Path(args.src)
    active_dir = Path(args.active_dir)
    attachments_dir = Path(args.attachments_dir)

    active_dir.mkdir(parents=True, exist_ok=True)
    attachments_dir.mkdir(parents=True, exist_ok=True)

    if src.is_file():
        ok = pdf_to_md(src, active_dir, attachments_dir)
        print('✅ 변환 완료' if ok else '⚠️ 스킵됨')
    elif src.is_dir():
        print(f"PDF 변환 시작: {src}")
        total = len(list(src.rglob('*.pdf')))
        print(f"총 {total}개 PDF 발견")
        success, fail, skip = process_directory(src, active_dir, attachments_dir)
        print(f"\n=== §4.2 PDF 변환 완료 ===")
        print(f"  성공: {success}개")
        print(f"  실패: {fail}개")
        print(f"  스킵: {skip}개 (이미 존재)")
    else:
        print(f"오류: {src} 를 찾을 수 없습니다.")
        sys.exit(1)


if __name__ == '__main__':
    main()
