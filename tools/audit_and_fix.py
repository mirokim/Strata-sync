#!/usr/bin/env python3
"""
audit_and_fix.py — §13.2 Vault 자동 교정

자동 수정 항목:
  F1. 중첩 wikilink   [[[stem]] (3열림+2닫힘), [[[[stem]]]] (4중+) → [[stem]]
  F2. HTML 잔재 제거  <br>, <b>, <strong>, <em>, <span>, <div> 등
  F3. 연속 빈줄 축소  3줄+ → 2줄 (frontmatter 외부)
  F4. 빈 tags 보완    tags: [] → 파일명+type 기반 자동 추론
  F5. 깨진 링크 수정  [[X]] 중 prefix 매칭으로 실존 stem 교체

감사 보고 항목 (수정하지 않고 목록 출력):
  R1. 300자 미만 본문 (내용 빈약 파일)
  R2. 반복 wikilink  (같은 stem 3회+ 등장)
  R3. 파일 크기 분포

사용법:
  python audit_and_fix.py <active_dir> [--dry-run] [--verbose]
"""

import re
import sys
import argparse
from pathlib import Path
from collections import Counter


# ── §13.3 MANUAL_MAP — 자동 해결 불가 broken link 수동 등록 ──────
# 형식: 'broken_stem': 'real_stem'
# 예:  'TLS': 'TLS(TimeLineSkill)시스템_588781620',
#      '2026.01.07 피드백_ID': '[2026.01.07] 피드백_ID',
MANUAL_MAP: dict[str, str] = {
    # ── 여기에 수동 등록 ──
    # 'broken_stem': 'real_stem',
}


# ── 태그 자동 추론 ───────────────────────────────────────────────
def infer_tags(stem: str, doc_type: str) -> list[str]:
    tags = [doc_type]
    s = stem.lower()
    kw_map = {
        'gameplay': ['레시피', 'recipe', '크래프팅', 'craft', 'object', '오브젝트',
                     '아이템', '스킬', '전투', '퀘스트', '던전', '몬스터', '드롭'],
        'art':      ['art', '원화', '외주', 'virtuos', 'humidor', 'mingjiang',
                     '콘셉', '일러스트', '애니메이션', 'anim', '리깅'],
        'tech':     ['엔진', 'engine', 'tech', '서버', 'server', 'db', '데이터베이스',
                     '코드', 'code', 'bug', '버그', '성능', 'performance'],
        'reference': ['리서치', 'research', '분석', '레퍼런스', 'reference',
                      '벤치마크', '비교', '사례'],
        'guide':    ['가이드', 'guide', '매뉴얼', 'manual', '설명서', '튜토리얼'],
        'character': ['캐릭터', 'character', '도감', '스킬트리', '스탯'],
        'world':    ['세계', '맵', 'map', '지역', '지형', '설정', '세계관'],
    }
    for tag, kws in kw_map.items():
        if tag != doc_type and any(k in s for k in kws):
            tags.append(tag)
    return list(dict.fromkeys(tags))


# ── F1: 중첩 wikilink 수정 ───────────────────────────────────────
def fix_nested_wikilinks(content: str) -> tuple[str, int]:
    """[[[stem]] (3열림+2닫힘), [[[[stem]]]] (4중+) → [[stem]] 정규화."""
    count = 0
    # 4중 이상 브래킷 (양쪽 모두 3+)
    new, n = re.subn(r'\[{3,}([^\[\]]+)\]{3,}', r'[[\1]]', content)
    count += n
    # 3열림+2닫힘 패턴: [[[stem]] — 마크다운 표 셀 내 자주 발생
    new, n = re.subn(r'\[\[\[([^\[\]]+)\]\](?!\])', r'[[\1]]', new)
    count += n
    return new, count


# ── F2: HTML 잔재 제거 ───────────────────────────────────────────
HTML_TAGS = re.compile(
    r'<(br|hr)\s*/?>|'                              # 빈 태그
    r'</(b|strong|em|i|span|div|p|ul|li|a)>|'       # 닫는 태그
    r'<(b|strong|em|i|span|div|p|ul|li|a)(\s[^>]*)?>',  # 여는 태그
    re.IGNORECASE
)
HTML_COMMENT = re.compile(r'<!--.*?-->', re.DOTALL)
HTML_ENTITY  = re.compile(r'&(amp|lt|gt|nbsp|quot);')
ENTITY_MAP   = {'amp': '&', 'lt': '<', 'gt': '>', 'nbsp': ' ', 'quot': '"'}


def fix_html_remnants(content: str) -> tuple[str, int]:
    count = 0
    # 주석 제거
    new, n = HTML_COMMENT.subn('', content); count += n
    # 태그 제거
    new, n = HTML_TAGS.subn('', new); count += n
    # HTML 엔티티 복원
    new2 = HTML_ENTITY.sub(lambda m: ENTITY_MAP.get(m.group(1), m.group(0)), new)
    if new2 != new:
        count += 1
    return new2, count


# ── F3: 연속 빈줄 축소 (frontmatter 외부만) ──────────────────────
def fix_blank_lines(content: str) -> tuple[str, int]:
    """3줄 이상 연속 빈줄 → 2줄."""
    fm_end = -1
    if content.startswith('---'):
        fm_end = content.find('\n---\n', 4)
    if fm_end != -1:
        fm   = content[:fm_end + 5]
        body = content[fm_end + 5:]
    else:
        fm, body = '', content

    new_body, n = re.subn(r'\n{4,}', '\n\n\n', body)
    return fm + new_body, n


# ── F4: 빈 tags 보완 ─────────────────────────────────────────────
def fix_empty_tags(content: str, stem: str) -> tuple[str, bool]:
    m = re.search(r'tags:\s*\[([^\]]*)\]', content)
    if not m or m.group(1).strip():
        return content, False
    tm = re.search(r'type:\s*(\S+)', content)
    doc_type = tm.group(1) if tm else 'spec'
    tags = infer_tags(stem, doc_type)
    new = content[:m.start()] + f'tags: [{", ".join(tags)}]' + content[m.end():]
    return new, True


# ── F5: 깨진 링크 수정 (MANUAL_MAP → slash_map → prefix 매칭) ────
def fix_broken_links(content: str, all_stems: set, prefix_map: dict) -> tuple[str, int]:
    """§13.3 기준: MANUAL_MAP → prefix 매칭 순서로 broken link 수정."""
    fixed = 0
    media_exts = {'.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp',
                  '.tiff', '.tif', '.wmf', '.emf', '.mp4', '.mov', '.avi',
                  '.pdf', '.psd', '.ai'}

    def repl(m):
        nonlocal fixed
        inner = m.group(1)
        stem  = inner.split('|')[0].strip()
        if stem.startswith('[') or stem in all_stems:
            return m.group(0)
        ext = Path(stem).suffix.lower()
        if ext in media_exts:
            return m.group(0)

        display = inner.split('|')[1].strip() if '|' in inner else stem

        # 1순위: MANUAL_MAP
        if stem in MANUAL_MAP:
            fixed += 1
            return f'[[{MANUAL_MAP[stem]}|{display}]]'

        # 2순위: prefix 매칭 (§13.2.1 괄호 절단 버그 자동 복구)
        real = prefix_map.get(stem)
        if real:
            fixed += 1
            return f'[[{real}|{display}]]'

        return m.group(0)

    new = re.sub(r'(?<!!)\[\[([^\]]+)\]\]', repl, content)
    return new, fixed


def build_prefix_map(all_stems: set) -> dict:
    prefix_map = {}
    for stem in all_stems:
        clean = re.sub(r'^\d+_', '', stem)
        if clean and clean != stem and clean not in prefix_map:
            prefix_map[clean] = stem
    return prefix_map


# ── R1: 300자 미만 본문 감사 ─────────────────────────────────────
def has_image_content(content: str) -> bool:
    """§3.1.1: 이미지 링크(![[...]]) 또는 테이블이 있으면 실질 콘텐츠로 인정."""
    return bool(re.search(r'!\[\[[^\]]+\]\]', content)) or \
           bool(re.search(r'^\|.+\|', content, re.MULTILINE))


def audit_thin_docs(content: str) -> int:
    """본문 텍스트 길이 반환. 이미지/테이블 파일은 -1 반환 (제외 대상)."""
    if has_image_content(content):
        return -1   # 이미지·테이블 포함 파일 → 300자 미만 경고 제외
    fm_end = content.find('\n---\n', 4) if content.startswith('---') else -1
    body   = content[fm_end + 5:] if fm_end != -1 else content
    text   = re.sub(r'\[\[([^\]]+)\]\]', lambda m: (m.group(1).split('|')[-1]), body)
    text   = re.sub(r'[#>\-\*`\|]', ' ', text)
    return len(text.strip())


# ── R2: 반복 wikilink ────────────────────────────────────────────
def audit_repeated_links(content: str, threshold: int = 3) -> list[str]:
    links  = re.findall(r'(?<!!)\[\[([^\]]+)\]\]', content)
    stems  = [l.split('|')[0].strip() for l in links]
    counts = Counter(stems)
    return [s for s, c in counts.items() if c >= threshold]


# ── 메인 ─────────────────────────────────────────────────────────
def run(active_dir: Path, dry_run: bool = False, verbose: bool = False) -> dict:
    all_stems  = {md.stem for md in active_dir.glob('*.md')}
    prefix_map = build_prefix_map(all_stems)

    stats = {
        'nested_fixed':   0,
        'html_fixed':     0,
        'blank_fixed':    0,
        'tags_fixed':     0,
        'links_fixed':    0,
        'files_changed':  0,
        'thin_docs':      [],
        'repeated_links': {},
        'size_dist':      Counter(),
    }

    for md in sorted(active_dir.glob('*.md')):
        try:
            content = md.read_text(encoding='utf-8', errors='replace')
        except Exception:
            continue

        original = content
        changed  = False

        # F1
        content, n = fix_nested_wikilinks(content)
        stats['nested_fixed'] += n; changed = changed or bool(n)

        # F2
        content, n = fix_html_remnants(content)
        stats['html_fixed'] += n; changed = changed or bool(n)

        # F3
        content, n = fix_blank_lines(content)
        stats['blank_fixed'] += n; changed = changed or bool(n)

        # F4
        content, ok = fix_empty_tags(content, md.stem)
        stats['tags_fixed'] += ok; changed = changed or ok

        # F5
        content, n = fix_broken_links(content, all_stems, prefix_map)
        stats['links_fixed'] += n; changed = changed or bool(n)

        if changed:
            stats['files_changed'] += 1
            if not dry_run:
                md.write_text(content, encoding='utf-8')
            if verbose:
                print(f"  수정: {md.name[:60]}")

        # 감사 (수정과 별개)
        body_len = audit_thin_docs(content)
        if body_len != -1 and body_len < 300:   # -1이면 이미지/테이블 파일 → 제외
            stats['thin_docs'].append(md.name)

        repeated = audit_repeated_links(content)
        if repeated:
            stats['repeated_links'][md.name] = repeated

        # 파일 크기 분포
        sz = md.stat().st_size
        if sz < 2000:    stats['size_dist']['<2KB'] += 1
        elif sz < 10000: stats['size_dist']['2–10KB'] += 1
        elif sz < 50000: stats['size_dist']['10–50KB'] += 1
        else:            stats['size_dist']['>50KB'] += 1

    return stats


def print_report(stats: dict, dry_run: bool):
    print(f"\n{'='*55}")
    print(f"§13.2 audit_and_fix 완료{'  [DRY-RUN]' if dry_run else ''}")
    print(f"{'='*55}")
    print(f"  F1 중첩 wikilink 수정: {stats['nested_fixed']}건")
    print(f"  F2 HTML 잔재 제거:     {stats['html_fixed']}건")
    print(f"  F3 연속 빈줄 축소:     {stats['blank_fixed']}건")
    print(f"  F4 빈 tags 보완:       {stats['tags_fixed']}개 파일")
    print(f"  F5 깨진 링크 수정:     {stats['links_fixed']}건")
    print(f"  총 변경 파일:          {stats['files_changed']}개")

    print(f"\n── 감사 보고 ───────────────────────────────────")
    thin = stats['thin_docs']
    print(f"  R1 본문 300자 미만:    {len(thin)}개")
    if thin:
        for f in thin[:10]:
            print(f"     · {f[:60]}")
        if len(thin) > 10:
            print(f"     ... 외 {len(thin)-10}개")

    rep = stats['repeated_links']
    print(f"  R2 반복 wikilink(3+): {len(rep)}개 파일")
    for fname, stems in list(rep.items())[:5]:
        print(f"     · {fname[:50]}: {stems[:3]}")

    print(f"\n── 파일 크기 분포 ──────────────────────────────")
    for label, cnt in sorted(stats['size_dist'].items()):
        print(f"  {label:>8}: {cnt:4}개")


def main():
    parser = argparse.ArgumentParser(description='§13.2 Vault 자동 교정')
    parser.add_argument('active_dir', help='active/ 폴더 경로')
    parser.add_argument('--dry-run', action='store_true', help='파일 수정 없이 미리보기')
    parser.add_argument('--verbose', '-v', action='store_true')
    args = parser.parse_args()

    active_dir = Path(args.active_dir)
    if not active_dir.is_dir():
        print(f"오류: {active_dir} 없음")
        sys.exit(1)

    print(f"§13.2 audit_and_fix 시작 ({'DRY-RUN' if args.dry_run else '실제 수정'})...")
    stats = run(active_dir, dry_run=args.dry_run, verbose=args.verbose)
    print_report(stats, args.dry_run)


if __name__ == '__main__':
    main()
