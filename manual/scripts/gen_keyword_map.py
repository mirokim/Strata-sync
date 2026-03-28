"""
KEYWORD_MAP 자동 생성 스크립트 (gen_keyword_map.py)  v1.0
────────────────────────────────────────────────────────
기능:
  _index.md의 wikilink stem들을 분석하여 inject_keywords.py의
  KEYWORD_MAP을 자동으로 생성·갱신한다.

알고리즘:
  1. _index.md에서 [[stem]] 링크를 전부 추출
  2. 각 stem을 토큰화하여 후보 키워드 추출
  3. 같은 키워드가 포함된 stem이 MIN_STEM_COUNT개 이상이면 유효 키워드로 판정
  4. 각 키워드에 대해 "대표 허브 stem" 선택
     (키워드가 마지막 의미 토큰인 stem = 가장 일반적 허브)
  5. 볼트 전체에서 해당 키워드의 평문 등장 빈도 계산
     → MIN_FREQ 미만이거나 MAX_RATE 초과이면 제외 (범용어 방지)
  6. 결과를 inject_keywords.py의 KEYWORD_MAP 블록에 기록

사용법:
    # 후보 미리보기 (파일 수정 없음)
    python gen_keyword_map.py <vault_dir>

    # inject_keywords.py에 실제 반영
    python gen_keyword_map.py <vault_dir> --apply

옵션:
    --apply            inject_keywords.py KEYWORD_MAP 자동 갱신
    --min-stems N      키워드가 등장해야 하는 최소 stem 수 (기본 3)
    --min-freq N       볼트 전체 평문 등장 최소 파일 수 (기본 3)
    --max-rate F       볼트 대비 최대 등장 비율 0~1 (기본 0.15 = 15%)

의존 패키지:
    없음 (표준 라이브러리만 사용)
"""

import os
import re
import sys

# ── 불용어 (이 토큰은 키워드 후보에서 제외) ───────────────────────────────────
STOPWORDS: set[str] = {
    # ── 한국어 일반 동사/명사 ────────────────────────────────────────────────────
    '캐릭터', '아트', '기획', '보고', '회의록', '회의', '작업', '정리',
    '리스트', '내용', '결과', '버전', '업데이트', '수정', '추가', '삭제',
    '가이드', '문서', '자료', '파일', '데이터', '정보', '참고',
    '1차', '2차', '3차', '최종', '초안', '검토', '완료', '진행',
    '모델링', '디자인', '원화', '애니메이션', '이펙트', '사운드',
    # ── 게임 개발 범용어 (Project A) ──────────────────────────────────────────
    '개요', '설정', '연출', '관련', '컨셉', '게임', '제작', '플레이',
    '레벨', '전투', '배경', '사항', '방향성', '방향', '레퍼런스',
    '전사', '개발', '세계관', '논의', '요소', '변경', '퀘스트',
    '크래프팅', '시나리오', '구현', '시스템', '오브젝트', '영역',
    '직업', '궁극기', '정례', '구성', '확인', '구분', '테스트',
    '제안', '기능', '아이디어', '신규', '지역', '구조', '처리',
    '위치', '빌드', '개선', '종족', '스케치', '모션', '영웅',
    '국가', 'NPC', '효과', '프로젝트', '관리', '항목', '신전',
    '표시', '레시피', '리소스', '퍼즐', '피격', '외형', '타워',
    '조작', '인원', '스폰', '분석', '이슈', '세팅', '인지', '매칭',
    '현황', '교체', '심화', '목록', '요청', '조사', '마법',
    '블록', '정례보고', '링크', '임시', '사망', '외주', '소개',
    '구역', '슬롯', '암석', '스크립트',
    '스킬', '약한', '상세', '규칙', '파괴', '내부',
    '프로토', '드랍', '플로우', '테이블', '입력', '폴리싱', '리서치',
    '마블', '원신', '3D', '2D',
    # ── 영어 일반 ───────────────────────────────────────────────────────────────
    'the', 'and', 'for', 'of', 'to', 'in', 'a', 'an', 'is', 'at',
    'list', 'data', 'info', 'doc', 'file', 'ver', 'v1', 'v2', 'v3',
    'backup', 'copy', 'final', 'draft', 'review', 'update',
    'overview', 'guide', 'report', 'project', 'system',
}

WIKILINK_PAT = re.compile(r'\[\[([^\[\]]+?)\]\]')
NUM_ONLY     = re.compile(r'^\d+$')
SHORT_ID     = re.compile(r'^[A-Za-z0-9]{1,3}$')   # 2~3자 영숫자 ID (단, 의미있는 약어는 예외)


def resolve_active_dir(vault_dir: str) -> str:
    active = os.path.join(vault_dir, 'active')
    if os.path.isdir(active):
        return active
    return vault_dir


def tokenize_stem(stem: str) -> list[str]:
    """stem → 의미 있는 토큰 목록 (ID·숫자·불용어 제거)"""
    # 구분자: _, 공백, (, ), [, ], ., -, /, \, |
    parts = re.split(r'[\s_\(\)\[\]\.\-/\\|,]+', stem)
    tokens = []
    for p in parts:
        p = p.strip()
        if not p:
            continue
        if NUM_ONLY.match(p):       # 순수 숫자 (Confluence ID 등)
            continue
        if len(p) < 2:              # 1글자
            continue
        if p.lower() in {s.lower() for s in STOPWORDS}:
            continue
        tokens.append(p)
    return tokens


def best_hub_for_keyword(keyword: str, stems: list[str]) -> str:
    """키워드에 대한 대표 허브 stem 선택.
    우선순위:
      1) 키워드가 마지막 의미 토큰인 stem (가장 일반적 허브)
      2) 의미 토큰 수가 적을수록 우선 (더 단순한 제목 = 더 일반적)
    """
    candidates = []
    for stem in stems:
        tokens = tokenize_stem(stem)
        if not tokens:
            continue
        is_last = tokens[-1] == keyword
        candidates.append((stem, is_last, len(tokens)))

    # is_last=True 우선, 그 다음 토큰 수 적은 것
    candidates.sort(key=lambda x: (not x[1], x[2]))
    return candidates[0][0] if candidates else stems[0]


def count_plain_occurrences(keyword: str, md_files: list[str], active_dir: str,
                             exclude_stems: set[str]) -> int:
    """keyword가 평문(wikilink 바깥)으로 등장하는 파일 수"""
    kw_pat = re.compile(r'(?<!\[\[)(?<!\|)\b' + re.escape(keyword) + r'\b(?!\|)(?!\]\])',
                         re.MULTILINE)
    count = 0
    for fname in md_files:
        stem = fname[:-3]
        if stem in exclude_stems:
            continue
        path = os.path.join(active_dir, fname)
        try:
            with open(path, encoding='utf-8') as f:
                text = f.read()
        except Exception:
            continue
        # wikilink 마스킹 후 평문 검색
        masked = WIKILINK_PAT.sub('', text)
        if kw_pat.search(masked):
            count += 1
    return count


def load_index_stems(active_dir: str) -> list[str]:
    """_index.md에서 [[stem]] 목록 추출"""
    index_path = os.path.join(active_dir, '_index.md')
    if not os.path.exists(index_path):
        print('⚠ _index.md 파일이 없습니다.', file=sys.stderr)
        return []
    with open(index_path, encoding='utf-8') as f:
        text = f.read()
    stems = [m.group(1).split('|')[0].strip() for m in WIKILINK_PAT.finditer(text)]
    return stems


def run(vault_dir: str, apply: bool = False,
        min_stems: int = 3, min_freq: int = 3, max_rate: float = 0.15) -> None:
    active_dir = resolve_active_dir(vault_dir)

    # 1. _index.md에서 stem 목록 수집
    index_stems = load_index_stems(active_dir)
    if not index_stems:
        return
    print(f'_index.md 링크: {len(index_stems)}개 stem')

    # 2. 키워드 → stem 목록 매핑
    keyword_to_stems: dict[str, list[str]] = {}
    for stem in index_stems:
        for token in tokenize_stem(stem):
            keyword_to_stems.setdefault(token, []).append(stem)

    # 3. MIN_STEM_COUNT 이상인 키워드만 유지
    candidates = {kw: stems for kw, stems in keyword_to_stems.items()
                  if len(stems) >= min_stems}
    print(f'stem {min_stems}개 이상 등장 키워드: {len(candidates)}개')

    # 4. 볼트 파일 목록
    md_files = sorted(f for f in os.listdir(active_dir) if f.endswith('.md'))
    total = len(md_files)
    hub_stems_set = set(index_stems)

    # 5. 평문 빈도 필터링 + 대표 허브 선택
    print(f'\n평문 빈도 분석 중 ({len(candidates)}개 키워드 × {total}개 파일)...\n')

    results: list[tuple[str, str, int, float]] = []  # (keyword, hub_stem, freq, rate)
    for kw, stems in sorted(candidates.items(), key=lambda x: -len(x[1])):
        freq = count_plain_occurrences(kw, md_files, active_dir, hub_stems_set)
        rate = freq / total if total else 0
        if freq < min_freq:
            continue
        if rate > max_rate:
            continue
        hub = best_hub_for_keyword(kw, stems)
        results.append((kw, hub, freq, rate))

    results.sort(key=lambda x: -x[2])  # 빈도 높은 순

    # 6. 결과 출력
    print(f"{'키워드':<20} {'등장 파일':>8}  {'비율':>6}  허브 stem")
    print('-' * 80)
    for kw, hub, freq, rate in results:
        print(f'{kw:<20} {freq:>8}개  {rate*100:>5.1f}%  {hub[:45]}')

    print(f'\n→ KEYWORD_MAP 후보: {len(results)}개')

    if not apply:
        print('\n(--apply 옵션으로 inject_keywords.py에 자동 반영)')
        return

    # 7. inject_keywords.py KEYWORD_MAP 갱신
    script_dir = os.path.dirname(os.path.abspath(__file__))
    inject_path = os.path.join(script_dir, 'inject_keywords.py')
    if not os.path.exists(inject_path):
        print(f'⚠ {inject_path} 을 찾을 수 없습니다.', file=sys.stderr)
        return

    with open(inject_path, encoding='utf-8') as f:
        src = f.read()

    # 기존 KEYWORD_MAP 블록 내 주석(수동 항목) 보존
    map_pat = re.compile(
        r'(KEYWORD_MAP: dict\[str, tuple\[str, str\]\] = \{)(.*?)(\})',
        re.DOTALL
    )
    m = map_pat.search(src)
    if not m:
        print('⚠ inject_keywords.py에서 KEYWORD_MAP 블록을 찾을 수 없습니다.', file=sys.stderr)
        return

    existing_block = m.group(2)
    # 주석 행 보존 (수동 엔트리)
    manual_lines = [ln for ln in existing_block.splitlines()
                    if ln.strip().startswith('#')]

    # 자동 생성 항목 구성 (카테고리별 그룹핑은 단순하게 알파벳순)
    auto_lines = []
    auto_lines.append('    # ── 자동 생성 (gen_keyword_map.py) ──────────────────────────────────────')
    for kw, hub, freq, rate in results:
        # hub stem에 따옴표 이스케이프
        hub_escaped = hub.replace('\\', '\\\\').replace('"', '\\"')
        auto_lines.append(f'    "{kw}": ("{hub_escaped}", "{kw}"),  # {freq}개 파일 ({rate*100:.0f}%)')

    new_block = '\n'.join(manual_lines + [''] + auto_lines + [''])
    new_src = src[:m.start(2)] + '\n' + new_block + src[m.end(2):]

    with open(inject_path, 'w', encoding='utf-8') as f:
        f.write(new_src)

    print(f'\n✅ inject_keywords.py KEYWORD_MAP 갱신 완료 ({len(results)}개 항목)')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    apply    = '--apply'     in sys.argv
    min_stems = 3
    min_freq  = 3
    max_rate  = 0.15

    i = 1
    while i < len(sys.argv):
        arg = sys.argv[i]
        if arg == '--min-stems' and i + 1 < len(sys.argv):
            try: min_stems = int(sys.argv[i + 1])
            except ValueError: pass
            i += 2
        elif arg == '--min-freq' and i + 1 < len(sys.argv):
            try: min_freq = int(sys.argv[i + 1])
            except ValueError: pass
            i += 2
        elif arg == '--max-rate' and i + 1 < len(sys.argv):
            try: max_rate = float(sys.argv[i + 1])
            except ValueError: pass
            i += 2
        else:
            i += 1

    run(sys.argv[1], apply=apply, min_stems=min_stems,
        min_freq=min_freq, max_rate=max_rate)
