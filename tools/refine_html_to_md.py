#!/usr/bin/env python3
"""
refine_html_to_md.py — Graph RAG 데이터 정제 매뉴얼 v3.8 §4.1 구현
Confluence HTML 내보내기 → Obsidian 호환 Markdown 변환
markdownify 기반 고속 변환 (멀티프로세싱 병렬 처리)

사용법:
  python refine_html_to_md.py <html_dir> [<html_dir2> ...] \
      --active refined_vault/active \
      --attachments refined_vault/attachments
"""

import os
import re
import sys
import shutil
import os
import argparse
import multiprocessing
from pathlib import Path
from datetime import datetime

try:
    from bs4 import BeautifulSoup, NavigableString, Tag
except ImportError:
    print("ERROR: beautifulsoup4 미설치. pip install beautifulsoup4 lxml --break-system-packages")
    sys.exit(1)

try:
    import markdownify as md_lib
except ImportError:
    print("ERROR: markdownify 미설치. pip install markdownify --break-system-packages")
    sys.exit(1)

# ── 상수 ─────────────────────────────────────────────────────────────────
IMAGE_EXTS = {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'}

TYPE_KEYWORDS = {
    'meeting': ['회의록', '피드백', '정례보고', '정례 보고', '미팅', 'meeting', '회의'],
    'guide':   ['가이드', '매뉴얼', 'guide', 'manual', '온보딩', '튜토리얼', 'tutorial', '설치', '사용법'],
    'decision':['결정', 'decision', 'adr', '의사결정', '방향', '검토'],
    'reference':['레퍼런스', 'reference', '참고', '벤치마크', '외부', '조사'],
}
CHIEF_KEYWORDS = ['이사장', '피드백', '정례보고', '정례 보고', '회장님']

NOISE_PATTERNS = [
    r'Powered by Confluence',
    r'Edit this page',
    r'View history',
    r'All rights reserved',
    r'CC BY',
]


def sanitize_filename(name: str) -> str:
    return re.sub(r'[\\/*?:"<>|]', '_', name).strip()


def detect_type(filename: str) -> str:
    fname_lower = filename.lower()
    for t, kws in TYPE_KEYWORDS.items():
        for kw in kws:
            if kw.lower() in fname_lower:
                return t
    return 'spec'


def detect_tags(filename: str, title: str) -> list:
    tags = []
    text = filename + ' ' + title
    for kw in CHIEF_KEYWORDS:
        if kw in text:
            tags.append('chief')
            break
    return tags


def parse_meta(soup: BeautifulSoup) -> tuple:
    """메타 div에서 생성일, 수정일, 원본 URL 추출."""
    meta_div = soup.find('div', class_='meta')
    if not meta_div:
        return '', '', ''

    meta_text = meta_div.get_text(separator=' ', strip=True)
    m_created = re.search(r'생성[:\s]+(\d{4}-\d{2}-\d{2})', meta_text)
    m_modified = re.search(r'수정[:\s]+(\d{4}-\d{2}-\d{2})', meta_text)
    created = m_created.group(1) if m_created else ''
    modified = m_modified.group(1) if m_modified else ''

    link = meta_div.find('a')
    source_url = link['href'] if link and link.get('href') else ''

    return created, modified, source_url


def preprocess_confluence(soup: BeautifulSoup, stem: str,
                          files_dir: Path, attachments_dir: Path) -> list:
    """
    Confluence 전용 태그 전처리:
    - ac:image → img 태그로 교체 (markdownify가 처리)
    - 불필요한 ac:* 태그 제거/언랩
    반환: 복사된 이미지 파일명 목록
    """
    image_files = []
    img_counter = [0]

    # ── 최적화: files_dir 파일 목록을 미리 캐시 (마운트된 경로에서 exists() 반복 호출 방지) ──
    files_map = {}  # lowercase_name → Path
    try:
        if files_dir.exists():
            for f in files_dir.iterdir():
                files_map[f.name.lower()] = f
    except Exception:
        pass

    def resolve_image(orig_filename: str) -> str:
        """
        이미지를 attachments 폴더로 심볼릭 링크 또는 복사.
        새 파일명 반환 (존재하지 않으면 '').
        """
        img_counter[0] += 1
        ext = Path(orig_filename).suffix.lower() or '.png'
        new_name = f"{stem}_{img_counter[0]}{ext}"

        # 캐시에서 파일 탐색 (대소문자 무관)
        src = files_map.get(orig_filename) or files_map.get(orig_filename.lower())
        if src is None:
            return ''

        dst = attachments_dir / new_name
        if dst.exists():
            image_files.append(new_name)
            return new_name
        try:
            # 심볼릭 링크로 연결 (빠름). 실패 시 복사
            os.symlink(src.resolve(), dst)
        except Exception:
            try:
                shutil.copy2(src, dst)
            except Exception:
                return ''
        image_files.append(new_name)
        return new_name

    # ac:image → img 태그로 변환 (markdownify가 ![]() 처리)
    for ac_img in soup.find_all('ac:image'):
        ri_att = ac_img.find('ri:attachment')
        if ri_att and ri_att.get('ri:filename'):
            new_fname = resolve_image(ri_att['ri:filename'])
            if new_fname:
                # markdownify가 인식하는 img 태그로 교체
                img_tag = soup.new_tag('img', src=new_fname, alt=new_fname)
                ac_img.replace_with(img_tag)
            else:
                ac_img.decompose()
        else:
            ac_img.decompose()

    # 제거할 macro 이름
    REMOVE_MACROS = {'toc', 'change-history', 'recently-updated', 'pagetree',
                     'children', 'excerpt', 'panel-heading'}

    for macro in soup.find_all('ac:structured-macro'):
        name = macro.get('ac:name', '').lower()
        if name in REMOVE_MACROS:
            macro.decompose()
            continue
        body = macro.find('ac:rich-text-body')
        if body:
            macro.replace_with(body)
        else:
            macro.unwrap()

    for tag in soup.find_all('ac:rich-text-body'):
        tag.unwrap()

    for tag in soup.find_all('ac:parameter'):
        tag.decompose()

    for tag_name in ['ac:layout-cell', 'ac:layout-section', 'ac:layout']:
        for tag in soup.find_all(tag_name):
            tag.unwrap()

    for tag in soup.find_all(re.compile(r'^ri:')):
        tag.decompose()

    for tag in soup.find_all(re.compile(r'^ac:')):
        tag.unwrap()

    return image_files


def is_stub(md_body: str, threshold: int = 50) -> bool:
    """§3.1.1 스텁 판단: 실질 본문 글자 수 threshold 미만."""
    text = md_body
    text = re.sub(r'^---.*?---\s*', '', text, flags=re.DOTALL)
    text = re.sub(r'^# .+\n?', '', text, flags=re.MULTILINE)
    text = re.sub(r'^>\s*원본:.*\n?', '', text, flags=re.MULTILINE)
    text = re.sub(r'!\[\[[^\]]+\]\]', '', text)
    text = re.sub(r'\s+', '', text)
    return len(text) < threshold


def postprocess_md(md: str) -> str:
    """Markdown 후처리."""
    # markdownify가 생성한 img 링크를 Obsidian ![[]] 형식으로 변환
    # ![alt](filename) → ![[filename]]
    md = re.sub(r'!\[[^\]]*\]\(([^)]+)\)', lambda m: f'![[{Path(m.group(1)).name}]]', md)

    # 노이즈 패턴 제거
    for pattern in NOISE_PATTERNS:
        md = re.sub(pattern, '', md, flags=re.IGNORECASE)

    # 연속 빈줄 축소 (4줄 이상 → 2줄)
    md = re.sub(r'\n{4,}', '\n\n\n', md)

    # HTML 잔재 태그 제거
    md = re.sub(r'<[^>]+>', '', md)

    return md.strip()


def convert_html(args: tuple) -> dict:
    """
    단일 HTML 파일 변환.
    multiprocessing.Pool에서 호출됨.
    """
    html_path, active_dir, attachments_dir = args
    html_path = Path(html_path)
    active_dir = Path(active_dir)
    attachments_dir = Path(attachments_dir)

    fname = html_path.stem
    m = re.match(r'^(\d+)_(.*)', fname)
    page_id = m.group(1) if m else ''
    title = m.group(2) if m else fname
    stem = sanitize_filename(fname)

    parent = html_path.parent
    files_dir = parent / f"{page_id}_files" if page_id else parent / f"{fname}_files"
    if not files_dir.exists():
        files_dir = parent / f"{html_path.stem}_files"

    try:
        with open(html_path, 'r', encoding='utf-8', errors='replace') as f:
            raw = f.read()
    except Exception as e:
        return {'file': str(html_path), 'status': 'error', 'msg': str(e)}

    soup = BeautifulSoup(raw, 'lxml')

    # 메타 추출
    html_title_tag = soup.find('title')
    doc_title = html_title_tag.get_text(strip=True) if html_title_tag else title
    created_date, modified_date, source_url = parse_meta(soup)
    date = modified_date or created_date or datetime.now().strftime('%Y-%m-%d')

    # meta div 및 h1 제거 (frontmatter에서 처리)
    meta_div = soup.find('div', class_='meta')
    if meta_div:
        meta_div.decompose()
    first_h1 = (soup.body or soup).find('h1')
    if first_h1:
        first_h1.decompose()

    # Confluence 전처리 + 이미지 복사
    image_files = preprocess_confluence(soup, stem, files_dir, attachments_dir)

    # markdownify로 HTML → MD 변환 (고속)
    body_html = str(soup.body) if soup.body else str(soup)
    md_body = md_lib.markdownify(
        body_html,
        heading_style='ATX',
        bullets='-',
        strip=['script', 'style', 'head'],
        newline_style='backslash',
    )

    md_body = postprocess_md(md_body)

    # type, tags 판별
    doc_type = detect_type(fname)
    tags = detect_tags(fname, doc_title)

    # 스텁 판단
    stub = is_stub(md_body)

    # Frontmatter
    tags_yaml = '[' + ', '.join(tags) + ']' if tags else '[]'
    frontmatter = f"""---
title: "{doc_title.replace('"', "'")}"
date: {date}
type: {doc_type}
status: active
tags: {tags_yaml}
source: "{source_url}"
origin: html
page_id: "{page_id}"
---"""

    source_line = f"\n> 원본: [{doc_title}]({source_url})\n\n" if source_url else ''
    md_content = frontmatter + '\n\n' + f"# {doc_title}\n" + source_line + md_body

    # 스텁은 .archive/로, 정상은 active/로
    if stub:
        out_dir = active_dir.parent / '.archive'
        out_dir.mkdir(parents=True, exist_ok=True)
    else:
        out_dir = active_dir

    out_path = out_dir / f"{stem}.md"
    try:
        out_path.write_text(md_content, encoding='utf-8')
    except Exception as e:
        return {'file': str(html_path), 'status': 'error', 'msg': str(e)}

    return {
        'file': str(html_path),
        'status': 'stub' if stub else 'ok',
        'out': str(out_path),
        'images': len(image_files),
    }


def main():
    parser = argparse.ArgumentParser(description='Confluence HTML → Obsidian MD (§4.1)')
    parser.add_argument('html_dirs', nargs='+', help='HTML 폴더(들)')
    parser.add_argument('--active', default='refined_vault/active')
    parser.add_argument('--attachments', default='refined_vault/attachments')
    parser.add_argument('--workers', type=int, default=None)
    args = parser.parse_args()

    active_dir = Path(args.active)
    attachments_dir = Path(args.attachments)
    active_dir.mkdir(parents=True, exist_ok=True)
    attachments_dir.mkdir(parents=True, exist_ok=True)

    html_files = []
    for d in args.html_dirs:
        d = Path(d)
        if not d.exists():
            print(f"WARNING: 없음 — {d}")
            continue
        found = sorted(d.glob('*.html'))
        print(f"  {d}: {len(found)}개")
        html_files.extend(found)

    print(f"\n총 {len(html_files)}개 변환 시작...")
    tasks = [(str(p), str(active_dir), str(attachments_dir)) for p in html_files]

    workers = args.workers or min(multiprocessing.cpu_count(), 8)
    print(f"병렬 워커: {workers}")

    with multiprocessing.Pool(workers) as pool:
        results = []
        for i, r in enumerate(pool.imap_unordered(convert_html, tasks), 1):
            results.append(r)
            if i % 100 == 0 or i == len(tasks):
                ok = sum(1 for x in results if x['status'] == 'ok')
                stub = sum(1 for x in results if x['status'] == 'stub')
                err = sum(1 for x in results if x['status'] == 'error')
                print(f"  진행: {i}/{len(tasks)} — ok:{ok} stub:{stub} error:{err}", flush=True)

    ok_n = sum(1 for r in results if r['status'] == 'ok')
    stub_n = sum(1 for r in results if r['status'] == 'stub')
    err_n = sum(1 for r in results if r['status'] == 'error')
    imgs = sum(r.get('images', 0) for r in results)
    errors = [r for r in results if r['status'] == 'error']

    print(f"\n=== 변환 완료 ===")
    print(f"  active:    {ok_n}개")
    print(f"  .archive:  {stub_n}개 (스텁)")
    print(f"  오류:      {err_n}개")
    print(f"  이미지:    {imgs}개")
    if errors:
        for r in errors[:5]:
            print(f"  ERROR: {r['file']} — {r['msg']}")


if __name__ == '__main__':
    main()
