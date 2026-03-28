#!/usr/bin/env python3
"""
extract_images.py — §4.2 PDF 이미지 추출 독립 스크립트

기능:
  - PDF 1개 또는 폴더 내 모든 PDF에서 이미지를 추출
  - 이미지를 attachments/ 폴더에 저장
  - 파일명 규칙: {stem}_p{페이지번호}_{순번}.png  (§4.0 공통 원칙)
  - 최소 크기 필터링: 너비·높이 모두 100px 미만 아이콘/불릿 제외
  - 추출된 이미지 목록과 MD 내 삽입 wikilink 문자열 출력

라이브러리:
  pip install pymupdf Pillow

사용법:
  python extract_images.py <input_pdf_or_dir> <attachments_dir> [--min-width 100] [--min-height 100] [--verbose]
"""

import sys
import argparse
from pathlib import Path


MIN_WIDTH_DEFAULT  = 100   # 최소 너비 픽셀
MIN_HEIGHT_DEFAULT = 100   # 최소 높이 픽셀


def extract_images_from_pdf(pdf_path: Path, attachments_dir: Path,
                             min_width: int, min_height: int,
                             verbose: bool) -> list[Path]:
    """PDF 1개에서 이미지를 추출하여 attachments_dir 에 저장."""
    try:
        import fitz  # pymupdf
    except ImportError:
        print("오류: pymupdf 미설치. 'pip install pymupdf' 실행 후 재시도하세요.")
        sys.exit(1)

    attachments_dir.mkdir(parents=True, exist_ok=True)

    doc      = fitz.open(str(pdf_path))
    stem     = pdf_path.stem
    saved    = []
    idx_global = 0

    for page_num, page in enumerate(doc, start=1):
        image_list = page.get_images(full=True)
        for img_idx, img_info in enumerate(image_list, start=1):
            xref = img_info[0]
            try:
                base_img = doc.extract_image(xref)
            except Exception:
                continue

            width  = base_img.get('width',  0)
            height = base_img.get('height', 0)
            if width < min_width or height < min_height:
                if verbose:
                    print(f"  건너뜀 (소형 {width}×{height}): p{page_num}_{img_idx}")
                continue

            ext      = base_img.get('ext', 'png')
            img_data = base_img['image']

            # PNG 통일 (JPEG·WebP 포함 모든 형식 → PNG 저장)
            out_name = f"{stem}_p{page_num:03d}_{img_idx:02d}.png"
            out_path = attachments_dir / out_name

            if ext == 'png':
                out_path.write_bytes(img_data)
            else:
                # PIL로 변환
                try:
                    from PIL import Image
                    import io
                    img_obj = Image.open(io.BytesIO(img_data)).convert('RGBA')
                    img_obj.save(str(out_path), 'PNG')
                except ImportError:
                    # PIL 없으면 원본 확장자로 저장
                    out_path = attachments_dir / f"{stem}_p{page_num:03d}_{img_idx:02d}.{ext}"
                    out_path.write_bytes(img_data)
                except Exception:
                    out_path.write_bytes(img_data)

            saved.append(out_path)
            idx_global += 1
            if verbose:
                print(f"  추출: {out_path.name}  ({width}×{height})")

    doc.close()
    return saved


def generate_wikilinks(saved: list[Path]) -> str:
    """추출된 이미지 목록 → MD 내 삽입용 wikilink 문자열 생성."""
    if not saved:
        return ''
    lines = ['', '## 추출 이미지', '']
    for p in saved:
        lines.append(f'![[{p.name}]]')
    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(description='§4.2 PDF 이미지 추출')
    parser.add_argument('input',           help='PDF 파일 또는 PDF 파일이 있는 폴더')
    parser.add_argument('attachments_dir', help='이미지 저장 폴더 (attachments/)')
    parser.add_argument('--min-width',  type=int, default=MIN_WIDTH_DEFAULT,
                        help=f'최소 너비 픽셀 (기본: {MIN_WIDTH_DEFAULT})')
    parser.add_argument('--min-height', type=int, default=MIN_HEIGHT_DEFAULT,
                        help=f'최소 높이 픽셀 (기본: {MIN_HEIGHT_DEFAULT})')
    parser.add_argument('--verbose', '-v', action='store_true')
    args = parser.parse_args()

    input_path = Path(args.input)
    att_dir    = Path(args.attachments_dir)

    if input_path.is_file():
        pdf_files = [input_path]
    elif input_path.is_dir():
        pdf_files = sorted(input_path.glob('*.pdf'))
    else:
        print(f"오류: {input_path} 없음"); sys.exit(1)

    total_saved = 0
    for pdf in pdf_files:
        print(f"\n처리 중: {pdf.name}")
        saved = extract_images_from_pdf(
            pdf, att_dir, args.min_width, args.min_height, args.verbose
        )
        total_saved += len(saved)
        if saved:
            print(f"  → {len(saved)}개 이미지 추출")
            print(generate_wikilinks(saved))
        else:
            print("  → 추출된 이미지 없음 (소형 제외 후)")

    print(f"\n{'='*50}")
    print(f"§4.2 extract_images 완료")
    print(f"{'='*50}")
    print(f"  처리 PDF:   {len(pdf_files)}개")
    print(f"  추출 이미지: {total_saved}개 → {att_dir}")


if __name__ == '__main__':
    main()
