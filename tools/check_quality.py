#!/usr/bin/env python3
"""
check_quality.py — §13.1 Vault 품질 감사 도구 (12개 항목)

검사 항목:
  ① 고립 노드      — wikilink([[...]]) 가 하나도 없는 파일
  ② Frontmatter    — --- ... --- 블록이 없는 파일
  ③ 빈 tags        — tags: [] 인 파일
  ④ ## 헤딩 없음   — 본문에 ## 이 없는 파일
  ⑤ 300자 미만     — 본문 실질 글자 수 300자 미만 (정보 밀도 부족)
  ⑥ 중첩 wikilink  — inject_keywords v1 버그 산물 ([[[stem]] 패턴 포함)
  ⑦ 4중+ 대괄호    — [[[[stem]]]] 패턴
  ⑧ 깨진 문서 링크 — [[stem]] 이 존재하지 않는 파일을 가리키는 링크
  ⑨ 동일 링크 5회+ — 같은 stem 5회 이상 반복
  ⑩ 문서 크기 분포 — <2KB / 2–10KB / 10–50KB / >50KB
  ⑪ speaker 누락   — frontmatter에 speaker 필드가 없는 파일
  ⑫ chief 미연결   — tags에 chief가 있으나 related 필드가 없는 파일

사용법:
  python check_quality.py <active_dir> [--attachments <dir>] [--verbose]
"""

import re
import sys
import argparse
from pathlib import Path
from collections import defaultdict, Counter


MEDIA_EXTS = {'.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp',
              '.tiff', '.tif', '.wmf', '.emf', '.mp4', '.mov', '.avi',
              '.pdf', '.psd', '.ai'}


# ── 실질 본문 글자 수 계산 (§3.1.1) ─────────────────────────────
def body_char_count(content: str) -> int:
    text = content
    if text.startswith('---'):
        end = text.find('\n---\n', 4)
        text = text[end + 5:] if end != -1 else text
    text = re.sub(r'^#\s+.+', '', text, flags=re.MULTILINE)
    text = re.sub(r'^>\s*원본\s*:.*', '', text, flags=re.MULTILINE)
    text = re.sub(r'!\[\[[^\]]*\]\]', '', text)
    text = re.sub(r'\[\[([^\]|]+)\|?[^\]]*\]\]', r'\1', text)
    text = re.sub(r'[#\-\*>`\|=_~]', '', text)
    text = re.sub(r'\s+', '', text)
    return len(text.strip())


def has_image_content(content: str) -> bool:
    """§3.1.1 주의: 이미지 링크(![[...]]) 또는 테이블이 있으면 실질 콘텐츠로 인정.
    이미지 전용 파일은 본문 글자 수와 관계없이 스텁/소형 파일로 분류하지 않는다."""
    has_img   = bool(re.search(r'!\[\[[^\]]+\]\]', content))
    has_table = bool(re.search(r'^\|.+\|', content, re.MULTILINE))
    return has_img or has_table


def run_audit(active_dir: Path, attachments_dir: Path | None = None,
              verbose: bool = False):
    all_stems = {md.stem for md in active_dir.glob('*.md')}
    all_attachments: set = set()
    if attachments_dir and attachments_dir.exists():
        all_attachments = {f.name for f in attachments_dir.iterdir()}

    # 결과 저장
    isolated      = []   # ①
    no_fm         = []   # ②
    empty_tags    = []   # ③
    no_heading    = []   # ④
    thin_docs     = []   # ⑤
    nested_links  = []   # ⑥
    quad_bracket  = []   # ⑦
    broken_doc    = set() # ⑧
    repeated_link = {}   # ⑨
    size_dist     = Counter()  # ⑩
    no_speaker    = []   # ⑪
    no_related_chief = []  # ⑫  chief 태그이지만 related 없음
    gw_dist       = Counter()  # graph_weight 분포

    link_counts  = []
    type_count: dict = defaultdict(int)

    for md in sorted(active_dir.glob('*.md')):
        try:
            content = md.read_text(encoding='utf-8', errors='replace')
        except Exception:
            continue

        sz = md.stat().st_size
        if sz < 2000:       size_dist['<2KB']   += 1
        elif sz < 10000:    size_dist['2–10KB']  += 1
        elif sz < 50000:    size_dist['10–50KB'] += 1
        else:               size_dist['>50KB']   += 1

        fm_end = content.find('\n---\n', 4) if content.startswith('---') else -1
        body   = content[fm_end + 5:] if fm_end >= 0 else content

        # ① 고립 노드
        wlinks = re.findall(r'\[\[[^\]]+\]\]', content)
        link_counts.append(len(wlinks))
        if not wlinks:
            isolated.append(md.stem)

        # ② Frontmatter
        if not content.startswith('---'):
            no_fm.append(md.stem)

        # ③ 빈 tags
        if re.search(r'tags:\s*\[\s*\]', content[:500]):
            empty_tags.append(md.stem)

        # ④ ## 헤딩
        if not re.search(r'^## ', body, re.MULTILINE):
            no_heading.append(md.stem)

        # ⑤ 300자 미만 — 이미지·테이블 파일은 제외 (§3.1.1 주의)
        if body_char_count(content) < 300 and not has_image_content(content):
            thin_docs.append(md.stem)

        # ⑥ 중첩 wikilink — [[[stem]] 또는 [[[[stem]]]]
        if re.search(r'\[\[\[', content):
            nested_links.append(md.stem)

        # ⑦ 4중+ 대괄호
        if re.search(r'\[{4,}', content):
            quad_bracket.append(md.stem)

        # ⑧ 깨진 문서 링크
        for link in re.findall(r'(?<!!)\[\[([^\]]+)\]\]', content):
            stem = link.split('|')[0].strip()
            if stem.startswith('['):
                continue  # 3중 브래킷 패턴 제외
            ext = Path(stem).suffix.lower()
            if ext in MEDIA_EXTS:
                continue  # 미디어 파일 제외
            if stem and stem not in all_stems:
                broken_doc.add(stem)

        # ⑨ 동일 링크 5회+
        stems = [l.split('|')[0].strip()
                 for l in re.findall(r'(?<!!)\[\[([^\]]+)\]\]', content)]
        repeated = [s for s, c in Counter(stems).items() if c >= 5]
        if repeated:
            repeated_link[md.name] = repeated

        # ⑪ speaker 누락 — frontmatter에 speaker 필드 없음
        if fm_end >= 0:
            fm_block = content[:fm_end + 5]
            if not re.search(r'^speaker:', fm_block, re.MULTILINE):
                no_speaker.append(md.stem)

        # ⑫ chief 태그이지만 related 없음
        if fm_end >= 0:
            fm_block = content[:fm_end + 5]
            has_chief_tag = bool(re.search(r'tags:.*chief', fm_block))
            has_chief_name = any(kw in md.name for kw in ['이사장', '피드백', '정례보고', '정례 보고', '회장님'])
            if (has_chief_tag or has_chief_name) and 'related:' not in fm_block:
                no_related_chief.append(md.stem)

        # graph_weight 분포
        if fm_end >= 0:
            fm_block = content[:fm_end + 5]
            gw_m = re.search(r'graph_weight:\s*(\w+)', fm_block)
            gw_dist[gw_m.group(1) if gw_m else 'normal'] += 1

        # type 분포
        m = re.search(r'type:\s*(\w+)', content[:300])
        type_count[m.group(1) if m else 'unknown'] += 1

    total = len(list(active_dir.glob('*.md')))
    avg_links = sum(link_counts) / total if total > 0 else 0

    print("=" * 55)
    print("§13.1 Vault 품질 감사 리포트 (12개 항목)")
    print("=" * 55)
    print(f"총 파일: {total}개\n")

    def ok(n): return '✅' if n == 0 else '⚠️'

    print(f"① 고립 노드 (wikilink 없음): {len(isolated)}개 ({len(isolated)/total*100:.1f}%) {ok(len(isolated))}")
    if verbose and isolated:
        for s in isolated[:10]: print(f"     {s}")

    print(f"② Frontmatter 누락:          {len(no_fm)}개 {ok(len(no_fm))}")
    if verbose and no_fm:
        for s in no_fm[:10]: print(f"     {s}")

    print(f"③ 빈 tags:                   {len(empty_tags)}개 {ok(len(empty_tags))}")
    if verbose and empty_tags:
        for s in empty_tags[:10]: print(f"     {s}")

    print(f"④ ## 헤딩 없음:              {len(no_heading)}개 ({(total-len(no_heading))/total*100:.1f}% 달성) {ok(len(no_heading))}")

    print(f"⑤ 300자 미만 초소형:         {len(thin_docs)}개 {ok(len(thin_docs))}")
    if verbose and thin_docs:
        for s in thin_docs[:10]: print(f"     {s}")

    print(f"⑥ 중첩 wikilink ([[[):       {len(nested_links)}개 {ok(len(nested_links))}")
    if verbose and nested_links:
        for s in nested_links[:10]: print(f"     {s}")

    print(f"⑦ 4중+ 대괄호 ([[[[):        {len(quad_bracket)}개 {ok(len(quad_bracket))}")
    if verbose and quad_bracket:
        for s in quad_bracket[:10]: print(f"     {s}")

    print(f"⑧ 깨진 문서 wikilink:        {len(broken_doc)}개 {ok(len(broken_doc))}")
    if verbose and broken_doc:
        for s in list(broken_doc)[:10]: print(f"     '{s}'")

    print(f"⑨ 동일 링크 5회+ 파일:       {len(repeated_link)}개 {'✅' if not repeated_link else '⚠️'}")
    if verbose and repeated_link:
        for f, stems in list(repeated_link.items())[:5]:
            print(f"     {f[:50]}: {stems[:3]}")

    print(f"⑪ speaker 누락:              {len(no_speaker)}개 {ok(len(no_speaker))}")
    if verbose and no_speaker:
        for s in no_speaker[:10]: print(f"     {s}")

    print(f"⑫ chief 태그 & related 없음: {len(no_related_chief)}개 {ok(len(no_related_chief))}")
    if verbose and no_related_chief:
        for s in no_related_chief[:10]: print(f"     {s}")

    print(f"\n── 연결도 ─────────────────────────")
    print(f"  평균 wikilink: {avg_links:.1f}개/파일")
    print(f"  링크 없는 파일: {sum(1 for c in link_counts if c == 0)}개")

    print(f"\n── ⑩ 파일 크기 분포 ─────────────────")
    for label in ['<2KB', '2–10KB', '10–50KB', '>50KB']:
        n = size_dist.get(label, 0)
        bar = '█' * (n // 30)
        print(f"  {label:>8}: {n:4d}개  {bar}")

    print(f"\n── graph_weight 분포 ─────────────────")
    for gw, n in sorted(gw_dist.items(), key=lambda x: -x[1]):
        bar = '█' * (n // 30)
        print(f"  {gw:10s}: {n:4d}개  {bar}")

    print(f"\n── type 분포 ─────────────────────")
    for t, n in sorted(type_count.items(), key=lambda x: -x[1]):
        print(f"  {t:12s}: {n:4d}개")

    print(f"\n── 목표 달성 여부 ─────────────────")
    goal_isolated = len(isolated) / total < 0.02
    goal_heading  = (total - len(no_heading)) / total >= 0.99
    goal_tags     = (total - len(empty_tags))  / total >= 0.9
    all_pass = (goal_isolated and goal_heading and goal_tags
                and len(broken_doc) == 0 and not nested_links and not quad_bracket)

    print(f"  고립 노드: {len(isolated)/total*100:.1f}% (목표: <2%)  {'✅' if goal_isolated else '❌'}")
    print(f"  ## 헤딩:   {(total-len(no_heading))/total*100:.1f}% (목표: 99%+) {'✅' if goal_heading else '❌'}")
    print(f"  tags:      {(total-len(empty_tags))/total*100:.1f}% (목표: 90%+) {'✅' if goal_tags else '❌'}")
    print(f"  깨진 링크: {len(broken_doc)}개  (목표: 0개)   {'✅' if len(broken_doc)==0 else '❌'}")
    print(f"  중첩링크:  {len(nested_links)}개  (목표: 0개)   {'✅' if not nested_links else '❌'}")

    if all_pass:
        print("\n🎉 모든 품질 목표 달성!")


def main():
    parser = argparse.ArgumentParser(description='§13.1 Vault 품질 감사 (12개 항목)')
    parser.add_argument('active_dir', help='active/ 폴더 경로')
    parser.add_argument('--attachments', default=None, help='attachments/ 폴더 경로')
    parser.add_argument('--verbose', '-v', action='store_true', help='문제 파일 목록 출력')
    args = parser.parse_args()

    active_dir = Path(args.active_dir)
    attachments_dir = Path(args.attachments) if args.attachments else \
                      active_dir.parent / 'attachments'

    if not active_dir.is_dir():
        print(f"오류: {active_dir} 없음"); sys.exit(1)

    run_audit(active_dir, attachments_dir, verbose=args.verbose)


if __name__ == '__main__':
    main()
