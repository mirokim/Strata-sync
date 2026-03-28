#!/usr/bin/env python3
"""
docx_to_md.py — Graph RAG data refinement manual v3.8 §4.5 implementation
DOCX → Obsidian-compatible Markdown conversion

Usage:
  python docx_to_md.py <docx_path> --active <active_dir> --attachments <att_dir>
  python docx_to_md.py <docx_dir>  --active <active_dir> --attachments <att_dir>
"""

import re
import sys
import argparse
from pathlib import Path
from datetime import datetime

try:
    from docx import Document
    from docx.oxml.ns import qn
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    import docx.opc.constants as opc_const
except ImportError:
    print("ERROR: python-docx 미설치. pip install python-docx --break-system-packages")
    sys.exit(1)


def sanitize_filename(name: str) -> str:
    return re.sub(r'[\\/*?:"<>|]', '_', name).strip()


def detect_type(filename: str) -> str:
    fname = filename.lower()
    if any(kw in fname for kw in ['회의', '피드백', '보고', 'meeting']):
        return 'meeting'
    if any(kw in fname for kw in ['가이드', 'guide', '매뉴얼']):
        return 'guide'
    if any(kw in fname for kw in ['결정', 'decision']):
        return 'decision'
    return 'spec'


def detect_tags(filename: str) -> list:
    tags = []
    for kw in ['이사장', '피드백', '정례보고', '정례 보고', '회장님']:
        if kw in filename:
            tags.append('chief')
            break
    return tags


def heading_level(para) -> int:
    """Return heading level from paragraph style (0=not a heading)."""
    style_name = para.style.name if para.style else ''
    if style_name.startswith('Heading '):
        try:
            return int(style_name.split(' ')[1])
        except (ValueError, IndexError):
            return 0
    # 굵은 텍스트만 있는 짧은 단락을 헤딩으로 간주 (§4.5 보완)
    return 0


def para_to_md(para) -> str:
    """Paragraph → Markdown text."""
    style_name = para.style.name if para.style else ''

    # 헤딩 처리
    lvl = heading_level(para)
    text = para.text.strip()
    if not text:
        return ''

    if lvl > 0:
        return f"{'#' * min(lvl, 6)} {text}"

    # 리스트 (List Paragraph 스타일)
    if 'List' in style_name:
        # Estimate indentation level
        num_pr = para._p.find(qn('w:numPr'))
        indent = 0
        if num_pr is not None:
            ilvl = num_pr.find(qn('w:ilvl'))
            if ilvl is not None:
                indent = int(ilvl.get(qn('w:val'), 0))
        # Bullet/number distinction (simplified: always bullet)
        return '  ' * indent + f"- {text}"

    # Apply inline formatting
    parts = []
    for run in para.runs:
        run_text = run.text
        if not run_text:
            continue
        if run.bold and run.italic:
            run_text = f"***{run_text}***"
        elif run.bold:
            run_text = f"**{run_text}**"
        elif run.italic:
            run_text = f"*{run_text}*"
        parts.append(run_text)

    return ''.join(parts) if parts else text


def table_to_md(table) -> str:
    """DOCX table → Markdown table."""
    rows = []
    for i, row in enumerate(table.rows):
        cells = []
        for cell in row.cells:
            cell_text = cell.text.strip().replace('|', '\\|').replace('\n', ' ')
            cells.append(cell_text)
        rows.append('| ' + ' | '.join(cells) + ' |')
        if i == 0:  # Header separator
            rows.append('|' + '---|' * len(row.cells))
    return '\n'.join(rows)


def extract_images(doc, stem: str, attachments_dir: Path) -> list:
    """Extract inline images → save to attachments/."""
    image_links = []
    img_counter = 0

    rels = doc.part.rels
    for rel in rels.values():
        if "image" in rel.reltype:
            img_counter += 1
            try:
                img_data = rel.target_part.blob
                content_type = rel.target_part.content_type
                # Determine extension
                ext_map = {
                    'image/png': 'png', 'image/jpeg': 'jpg',
                    'image/gif': 'gif', 'image/bmp': 'bmp',
                    'image/webp': 'webp',
                }
                ext = ext_map.get(content_type, 'png')
                filename = f"{stem}_{img_counter}.{ext}"
                dst = attachments_dir / filename
                dst.write_bytes(img_data)
                image_links.append(filename)
            except Exception:
                pass

    return image_links


def docx_to_md(docx_path: Path, active_dir: Path, attachments_dir: Path) -> dict:
    """Convert a single DOCX file."""
    stem = sanitize_filename(docx_path.stem)
    title = docx_path.stem
    doc_type = detect_type(title)
    tags = detect_tags(title)

    try:
        doc = Document(docx_path)
    except Exception as e:
        return {'file': str(docx_path), 'status': 'error', 'msg': str(e)}

    try:
        mtime = datetime.fromtimestamp(docx_path.stat().st_mtime).strftime('%Y-%m-%d')
    except Exception:
        mtime = datetime.now().strftime('%Y-%m-%d')

    # Extract images
    image_links = extract_images(doc, stem, attachments_dir)

    # Convert body
    body_parts = []
    has_heading = False

    for block in doc.element.body:
        tag = block.tag.split('}')[-1] if '}' in block.tag else block.tag

        if tag == 'p':
            # python-docx Paragraph 객체로 래핑
            from docx.text.paragraph import Paragraph
            para = Paragraph(block, doc)
            md_line = para_to_md(para)
            if md_line:
                if md_line.startswith('#'):
                    has_heading = True
                body_parts.append(md_line)

        elif tag == 'tbl':
            from docx.table import Table
            table = Table(block, doc)
            body_parts.append('\n' + table_to_md(table) + '\n')

    # 헤딩 없는 문서 → ## 개요 주입 (§4.5 주의사항)
    if not has_heading and body_parts:
        body_parts.insert(0, '## 개요')

    # Add image links at end of body (inclusion priority over position accuracy)
    for img in image_links:
        body_parts.append(f'\n![[{img}]]')

    body = '\n\n'.join(p for p in body_parts if p.strip())

    # Frontmatter
    tags_yaml = '[' + ', '.join(tags) + ']' if tags else '[]'
    frontmatter = f"""---
title: "{title.replace('"', "'")}"
date: {mtime}
type: {doc_type}
status: active
tags: {tags_yaml}
source: "{docx_path.name}"
origin: docx
---"""

    md_content = frontmatter + '\n\n' + f"# {title}\n\n" + body

    out_path = active_dir / f"{stem}.md"
    try:
        out_path.write_text(md_content, encoding='utf-8')
    except Exception as e:
        return {'file': str(docx_path), 'status': 'error', 'msg': str(e)}

    return {
        'file': str(docx_path),
        'status': 'ok',
        'out': str(out_path),
        'images': len(image_links),
    }


def main():
    parser = argparse.ArgumentParser(description='DOCX → Obsidian MD 변환 (§4.5)')
    parser.add_argument('input', nargs='+', help='DOCX 파일 또는 폴더')
    parser.add_argument('--active', default='refined_vault/active', help='MD 출력 폴더')
    parser.add_argument('--attachments', default='refined_vault/attachments', help='이미지 출력 폴더')
    args = parser.parse_args()

    active_dir = Path(args.active)
    attachments_dir = Path(args.attachments)
    active_dir.mkdir(parents=True, exist_ok=True)
    attachments_dir.mkdir(parents=True, exist_ok=True)

    docx_files = []
    for inp in args.input:
        p = Path(inp)
        if p.is_dir():
            docx_files.extend(sorted(p.rglob('*.docx')))
        elif p.suffix.lower() == '.docx':
            docx_files.append(p)

    print(f"DOCX {len(docx_files)}개 변환 starting...")
    ok, errors = 0, 0
    for docx_path in docx_files:
        r = docx_to_md(docx_path, active_dir, attachments_dir)
        if r['status'] == 'ok':
            ok += 1
            print(f"  ✓ {docx_path.name} ({r.get('images', 0)} 이미지)")
        else:
            errors += 1
            print(f"  ✗ {docx_path.name} — {r.get('msg', '')}")

    print(f"\nComplete: 성공 {ok}개, 오류 {errors}개")


if __name__ == '__main__':
    main()
