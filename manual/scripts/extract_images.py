"""
PDF 이미지 추출 스크립트
────────────────────────────────────────────────────────
사용법:
    python extract_images.py <input.pdf> <attachments_folder> [prefix]

예시:
    python extract_images.py 문서.pdf vault/attachments/ doc

출력:
    attachments/<prefix>_p{페이지번호}_{순번}.png

필터:
    너비 < 200px 또는 높이 < 80px 인 이미지 자동 제외 (아이콘/배너)

의존 패키지:
    pip install pdfplumber Pillow
"""

import sys
import os
import warnings

warnings.filterwarnings("ignore")

try:
    import pdfplumber
    from PIL import Image
except ImportError as e:
    print(f"ERROR: 필요한 패키지가 없습니다: {e}")
    print("  pip install pdfplumber Pillow")
    sys.exit(1)

# ── 설정 ─────────────────────────────────────────────────────────────────────
MIN_WIDTH  = 200   # 최소 너비 (px) — 더 작으면 아이콘으로 간주
MIN_HEIGHT = 80    # 최소 높이 (px) — 더 작으면 배너로 간주


def extract_images(pdf_path: str, output_dir: str, prefix: str = "img") -> int:
    """PDF에서 이미지를 추출하여 output_dir에 저장"""
    os.makedirs(output_dir, exist_ok=True)
    seen: set[str] = set()
    count = 0

    with pdfplumber.open(pdf_path) as pdf:
        for page_num, page in enumerate(pdf.pages, start=1):
            for img in page.images:
                name = img.get("name", f"unknown_{page_num}_{count}")
                w, h = img.get("srcsize", (0, 0))

                # 중복 및 소형 이미지 제외
                if name in seen:
                    continue
                if w < MIN_WIDTH or h < MIN_HEIGHT:
                    print(f"  건너뜀 (소형 {w}×{h}): {name}")
                    continue
                seen.add(name)

                try:
                    data = img["stream"].get_data()
                    out_name = f"{prefix}_p{page_num:03d}_{count:03d}.png"
                    out_path = os.path.join(output_dir, out_name)
                    Image.frombytes("RGB", (w, h), data).save(out_path)
                    print(f"  추출: {out_path}  ({w}×{h})")
                    count += 1
                except Exception as e:
                    print(f"  오류 ({name}): {e}")

    print(f"\n총 {count}개 이미지 추출 완료 → {output_dir}")
    return count


# ── 진입점 ───────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)

    _pdf    = sys.argv[1]
    _out    = sys.argv[2]
    _prefix = sys.argv[3] if len(sys.argv) > 3 else "img"

    if not os.path.isfile(_pdf):
        print(f"ERROR: 파일을 찾을 수 없습니다: {_pdf}")
        sys.exit(1)

    extract_images(_pdf, _out, _prefix)
