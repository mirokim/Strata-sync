#!/usr/bin/env python3
"""
txt_to_md.py — §4.6 TXT → Markdown 변환

처리 방침:
  - 내용 그대로 보존, frontmatter만 자동 생성
  - 파일명에서 날짜 패턴(YYYY-MM-DD, YYYYMMDD) 감지 시 date 필드 자동 설정
  - 이미지 없음
  - 변환 후 본문 50자 미만이면 스텁 경고 출력 (§3.1.1)

사용법:
  python txt_to_md.py <input_dir> <output_dir> [--dry-run] [--verbose]
  python txt_to_md.py <single.txt> <output_dir> [--dry-run] [--verbose]
"""

import re
import sys
import argparse
from pathlib import Path
from datetime import datetime


# ── 날짜 패턴 감지 ────────────────────────────────────────────────
DATE_PATTERNS = [
    (re.compile(r'(\d{4})-(\d{2})-(\d{2})'), '{}-{}-{}'),
    (re.compile(r'(\d{4})(\d{2})(\d{2})'),   '{}-{}-{}'),
    (re.compile(r'(\d{4})\.(\d{2})\.(\d{2})'), '{}-{}-{}'),
]

STUB_CHAR_LIMIT = 50  # §3.1.1 스텁 기준


def detect_date_from_stem(stem: str) -> str:
    """파일명에서 날짜 추출. 없으면 오늘 날짜."""
    for pat, fmt in DATE_PATTERNS:
        m = pat.search(stem)
        if m:
            y, mo, d = m.group(1), m.group(2), m.group(3)
            try:
                dt = datetime(int(y), int(mo), int(d))
                return dt.strftime('%Y-%m-%d')
            except ValueError:
                continue
    return datetime.today().strftime('%Y-%m-%d')


def infer_type_from_stem(stem: str) -> str:
    """파일명 키워드로 type 추론."""
    s = stem.lower()
    if any(k in s for k in ['회의', 'meeting', '미팅', '피드백', 'feedback']):
        return 'meeting'
    if any(k in s for k in ['가이드', 'guide', '매뉴얼', 'manual']):
        return 'guide'
    if any(k in s for k in ['레퍼런스', 'reference', '리서치', 'research']):
        return 'reference'
    if any(k in s for k in ['결정', 'decision', 'adr']):
        return 'decision'
    return 'spec'


def infer_tags_from_stem(stem: str, doc_type: str) -> list[str]:
    """파일명 키워드로 태그 추론."""
    tags = [doc_type]
    s = stem.lower()
    kw_map = {
        'gameplay': ['레시피', 'recipe', '크래프팅', 'craft', '아이템', '스킬', '전투', '퀘스트', '던전', '몬스터'],
        'art':      ['art', '원화', '외주', '콘셉', '일러스트', '애니메이션', 'anim'],
        'tech':     ['엔진', 'engine', 'tech', '서버', 'server', '코드', 'code', 'bug', '버그'],
        'reference': ['리서치', 'research', '분석', '레퍼런스', 'reference'],
        'character': ['캐릭터', 'character', '도감', '스킬트리'],
        'world':    ['세계', '맵', 'map', '지역', '지형', '설정', '세계관'],
    }
    for tag, kws in kw_map.items():
        if tag != doc_type and any(k in s for k in kws):
            tags.append(tag)
    return list(dict.fromkeys(tags))


def body_char_count(text: str) -> int:
    """실질 본문 글자 수 (공백/기호 제거)."""
    t = re.sub(r'[#\-\*>`\|=_~\s]', '', text)
    return len(t)


def build_frontmatter(stem: str) -> str:
    """파일명에서 frontmatter 자동 생성."""
    date     = detect_date_from_stem(stem)
    doc_type = infer_type_from_stem(stem)
    tags     = infer_tags_from_stem(stem, doc_type)
    title    = stem.replace('_', ' ')
    return (
        f"---\n"
        f"title: \"{title}\"\n"
        f"date: {date}\n"
        f"type: {doc_type}\n"
        f"status: active\n"
        f"tags: [{', '.join(tags)}]\n"
        f"origin: txt\n"
        f"---\n\n"
    )


def convert_txt_to_md(txt_path: Path, out_dir: Path,
                      dry_run: bool = False, verbose: bool = False) -> dict:
    """TXT 1개 → MD 변환."""
    result = {'stub': False, 'skipped': False, 'output': None}

    try:
        raw = txt_path.read_text(encoding='utf-8', errors='replace')
    except Exception as e:
        print(f"  오류: {txt_path.name} — {e}")
        result['skipped'] = True
        return result

    # 이미 frontmatter가 있는 경우
    if raw.startswith('---'):
        result['skipped'] = True
        if verbose:
            print(f"  건너뜀 (frontmatter 있음): {txt_path.name}")
        return result

    fm      = build_frontmatter(txt_path.stem)
    content = fm + raw

    out_path = out_dir / (txt_path.stem + '.md')
    result['output'] = out_path

    char_cnt = body_char_count(raw)
    if char_cnt < STUB_CHAR_LIMIT:
        result['stub'] = True

    if not dry_run:
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path.write_text(content, encoding='utf-8')

    if verbose:
        stub_tag = '  ⚠️ 스텁(50자 미만)' if result['stub'] else ''
        print(f"  {'[DRY]' if dry_run else '변환'}: {txt_path.name} → {out_path.name}{stub_tag}")

    return result


def main():
    parser = argparse.ArgumentParser(description='§4.6 TXT → Markdown 변환')
    parser.add_argument('input',      help='TXT 파일 또는 TXT 파일이 있는 폴더')
    parser.add_argument('output_dir', help='출력 폴더 (active/ 등)')
    parser.add_argument('--dry-run',  action='store_true', help='파일 생성 없이 미리보기')
    parser.add_argument('--verbose', '-v', action='store_true')
    args = parser.parse_args()

    input_path = Path(args.input)
    out_dir    = Path(args.output_dir)

    # 단일 파일 vs 디렉터리
    if input_path.is_file():
        txt_files = [input_path]
    elif input_path.is_dir():
        txt_files = sorted(input_path.glob('*.txt'))
    else:
        print(f"오류: {input_path} 없음"); sys.exit(1)

    total = converted = stubs = skipped = 0
    for txt in txt_files:
        total += 1
        r = convert_txt_to_md(txt, out_dir, args.dry_run, args.verbose)
        if r['skipped']:
            skipped += 1
        else:
            converted += 1
            if r['stub']:
                stubs += 1

    print(f"\n{'='*50}")
    print(f"§4.6 txt_to_md 완료{'  [DRY-RUN]' if args.dry_run else ''}")
    print(f"{'='*50}")
    print(f"  대상 TXT:  {total}개")
    print(f"  건너뜀:    {skipped}개 (frontmatter 이미 있음)")
    print(f"  변환 완료: {converted}개")
    if stubs:
        print(f"  ⚠️ 스텁(50자 미만): {stubs}개 → scan_cleanup.py --fix 대상")


if __name__ == '__main__':
    main()
