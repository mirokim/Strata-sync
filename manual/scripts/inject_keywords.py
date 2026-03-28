"""
키워드 자동 링크 주입 스크립트 (inject_keywords.py)  v3.0
────────────────────────────────────────────────────────
기능:
  본문에 등장하는 핵심 키워드의 첫 번째 언급을 [[허브_stem|키워드]] 형태로
  자동 교체한다.

v3 변경사항:
  _index.md 자동 분석 모드 추가.
  실행 시 _index.md의 wikilink stem들을 분석하여 키워드 맵을 자동 구성한다.
  KEYWORD_MAP_MANUAL에 수동 등록한 항목은 자동 항목보다 우선된다.
  gen_keyword_map.py를 별도로 실행할 필요 없음.

자동 키워드 선정 기준:
  ① _index.md에서 동일 키워드를 포함한 stem이 MIN_STEMS개 이상
  ② 볼트 전체 파일 중 평문으로 MIN_FREQ개 이상에 등장
  ③ 볼트 전체 파일의 MAX_RATE 이하 (범용어 제외)

사용법:
    python inject_keywords.py <vault_dir>

수동 오버라이드:
    KEYWORD_MAP_MANUAL 딕셔너리에 항목을 직접 추가하면
    자동 생성 항목보다 우선 적용된다.

⚠️  wikilink 오염 방지:
  기존 [[ ... ]] 범위 전체를 마스킹한 후 교체하여
  stem 안의 키워드가 이중으로 링크되는 버그를 방지한다.

의존 패키지:
    없음 (표준 라이브러리만 사용)
"""

import os
import re
import sys

# ── 수동 오버라이드 (자동 생성보다 우선) ────────────────────────────────────
# "키워드": ("허브_파일_stem", "표시 텍스트")
KEYWORD_MAP_MANUAL: dict[str, tuple[str, str]] = {
    # "이사장":   ("chief persona(0.1.0)",              "이사장"),
    # "TLS":      ("TLS(TimeLineSkill)시스템_588781620", "TLS"),
}

# ── 자동 모드 파라미터 ───────────────────────────────────────────────────────
AUTO_MIN_STEMS = 3      # 키워드가 등장해야 하는 최소 stem 수
AUTO_MIN_FREQ  = 3      # 볼트 내 평문 등장 최소 파일 수
AUTO_MAX_RATE  = 0.15   # 볼트 대비 최대 등장 비율 (범용어 방지)

# ── 자동 모드 불용어 ─────────────────────────────────────────────────────────
_STOPWORDS_RAW = {
    # 한국어 범용
    '캐릭터', '아트', '기획', '보고', '회의록', '회의', '작업', '정리',
    '리스트', '내용', '결과', '버전', '업데이트', '수정', '추가', '삭제',
    '가이드', '문서', '자료', '파일', '데이터', '정보', '참고',
    '1차', '2차', '3차', '최종', '초안', '검토', '완료', '진행',
    '모델링', '디자인', '원화', '애니메이션', '이펙트', '사운드',
    # 게임 개발 범용 (Project A)
    '개요', '설정', '연출', '관련', '컨셉', '게임', '제작', '플레이',
    '레벨', '전투', '배경', '사항', '방향성', '방향', '레퍼런스',
    '전사', '개발', '세계관', '논의', '요소', '변경', '퀘스트',
    '크래프팅', '시나리오', '구현', '시스템', '오브젝트', '영역',
    '직업', '궁극기', '정례', '구성', '확인', '구분', '테스트',
    '제안', '기능', '아이디어', '신규', '지역', '구조', '처리',
    '위치', '빌드', '개선', '종족', '스케치', '모션', '영웅',
    '국가', 'npc', '효과', '프로젝트', '관리', '항목', '신전',
    '표시', '레시피', '리소스', '퍼즐', '피격', '외형', '타워',
    '조작', '인원', '스폰', '분석', '이슈', '세팅', '인지', '매칭',
    '현황', '교체', '심화', '목록', '요청', '조사', '마법',
    '블록', '정례보고', '링크', '임시', '사망', '외주', '소개',
    '구역', '슬롯', '암석', '스크립트', '스킬', '약한', '상세',
    '규칙', '파괴', '내부', '프로토', '드랍', '플로우', '테이블',
    '입력', '폴리싱', '리서치', '마블', '원신', '3d', '2d',
    # 영어 범용
    'the', 'and', 'for', 'of', 'to', 'in', 'a', 'an', 'is', 'at',
    'list', 'data', 'info', 'doc', 'file', 'ver', 'v1', 'v2', 'v3',
    'backup', 'copy', 'final', 'draft', 'review', 'update',
    'overview', 'guide', 'report', 'project', 'system',
}
STOPWORDS = frozenset(s.lower() for s in _STOPWORDS_RAW)

# ── 정규식 ───────────────────────────────────────────────────────────────────
_WIKILINK_PAT = re.compile(r'\[\[([^\[\]]+?)\]\]')
_LINK_PAT     = re.compile(r'\[\[.*?\]\]', re.DOTALL)
_NUM_ONLY     = re.compile(r'^\d+$')


# ════════════════════════════════════════════════════════════════════════════
#  자동 키워드 맵 빌드
# ════════════════════════════════════════════════════════════════════════════

def _tokenize_stem(stem: str) -> list[str]:
    """stem → 의미 있는 토큰 목록 (ID·숫자·불용어 제거)"""
    parts = re.split(r'[\s_\(\)\[\]\.\-/\\|,]+', stem)
    tokens = []
    for p in parts:
        p = p.strip()
        if not p or len(p) < 2:
            continue
        if _NUM_ONLY.match(p):
            continue
        if p.lower() in STOPWORDS:
            continue
        tokens.append(p)
    return tokens


def _best_hub(keyword: str, stems: list[str]) -> str:
    """키워드의 대표 허브 stem 선택.
    키워드가 마지막 의미 토큰인 stem 우선 (가장 일반적 허브),
    동점이면 토큰 수 적은 것.
    """
    candidates = []
    for stem in stems:
        tokens = _tokenize_stem(stem)
        is_last = bool(tokens) and tokens[-1].lower() == keyword.lower()
        candidates.append((stem, is_last, len(tokens)))
    candidates.sort(key=lambda x: (not x[1], x[2]))
    return candidates[0][0] if candidates else stems[0]


def build_auto_keyword_map(
    active_dir: str,
    file_cache: dict[str, str],
) -> dict[str, tuple[str, str]]:
    """_index.md 분석 → 자동 키워드 맵 구성."""
    index_path = os.path.join(active_dir, '_index.md')
    if not os.path.exists(index_path):
        return {}

    with open(index_path, encoding='utf-8') as f:
        index_text = f.read()

    # _index.md에서 [[stem]] 수집
    index_stems = [m.group(1).split('|')[0].strip()
                   for m in _WIKILINK_PAT.finditer(index_text)]
    if not index_stems:
        return {}

    index_stem_set = set(index_stems)

    # 키워드 → stem 목록 매핑
    kw_to_stems: dict[str, list[str]] = {}
    for stem in index_stems:
        for tok in _tokenize_stem(stem):
            kw_to_stems.setdefault(tok, []).append(stem)

    # MIN_STEMS 필터
    candidates = {kw: stems for kw, stems in kw_to_stems.items()
                  if len(stems) >= AUTO_MIN_STEMS}

    total = len(file_cache)
    if total == 0:
        return {}

    # 평문 빈도 측정 (파일 캐시 재활용 — O(keywords × files) 하지만 파일 I/O 없음)
    result: dict[str, tuple[str, str]] = {}
    for kw, stems in candidates.items():
        kw_pat = re.compile(r'(?<!\[)(?<!\|)\b' + re.escape(kw) + r'\b(?!\|)(?!\])',
                            re.MULTILINE)
        count = 0
        for fname, text in file_cache.items():
            if fname[:-3] in index_stem_set:
                continue
            masked = _WIKILINK_PAT.sub('', text)
            if kw_pat.search(masked):
                count += 1

        rate = count / total
        if count < AUTO_MIN_FREQ or rate > AUTO_MAX_RATE:
            continue

        hub = _best_hub(kw, stems)
        result[kw] = (hub, kw)

    return result


# ════════════════════════════════════════════════════════════════════════════
#  링크 주입
# ════════════════════════════════════════════════════════════════════════════

def _mask_links(text: str) -> tuple[str, list[str]]:
    saved: list[str] = []
    def replacer(m: re.Match) -> str:
        idx = len(saved)
        saved.append(m.group(0))
        return f"\x00WLINK{idx}\x00"
    return _LINK_PAT.sub(replacer, text), saved


def _restore_links(masked: str, saved: list[str]) -> str:
    return re.sub(r'\x00WLINK(\d+)\x00',
                  lambda m: saved[int(m.group(1))], masked)


def _code_ranges(text: str) -> list[tuple[int, int]]:
    return [(m.start(), m.end()) for m in re.finditer(r'```[\s\S]*?```', text)]


def inject(text: str, keyword_map: dict[str, tuple[str, str]]) -> str:
    """Frontmatter 이후 본문에 키워드 첫 등장 링크 주입."""
    fm_end = 0
    if text.startswith('---'):
        end = text.find('\n---', 3)
        if end != -1:
            fm_end = end + 4
    frontmatter = text[:fm_end]
    body = text[fm_end:]

    masked, saved = _mask_links(body)
    code_blocks = _code_ranges(masked)

    for keyword, (hub_stem, display) in keyword_map.items():
        pat = re.compile(re.escape(keyword))
        offset = 0
        new_masked = masked

        for m in pat.finditer(masked):
            pos = m.start()
            if any(s <= pos < e for s, e in code_blocks):
                continue
            link_text = f'[[{hub_stem}|{display}]]'
            new_masked = (masked[:pos + offset]
                          + link_text
                          + masked[m.end() + offset:])
            offset += len(link_text) - len(keyword)
            masked = new_masked
            break  # 파일 내 첫 1회만

    return frontmatter + _restore_links(masked, saved)


# ════════════════════════════════════════════════════════════════════════════
#  메인
# ════════════════════════════════════════════════════════════════════════════

def resolve_active_dir(vault_dir: str) -> str:
    active = os.path.join(vault_dir, 'active')
    return active if os.path.isdir(active) else vault_dir


def run(vault_dir: str) -> None:
    active_dir = resolve_active_dir(vault_dir)
    md_files = sorted(f for f in os.listdir(active_dir) if f.endswith('.md'))

    # 1. 파일 전체를 한 번만 읽어 캐시
    file_cache: dict[str, str] = {}
    for fname in md_files:
        try:
            with open(os.path.join(active_dir, fname), encoding='utf-8') as f:
                file_cache[fname] = f.read()
        except Exception:
            pass

    # 2. 자동 키워드 맵 빌드
    auto_map = build_auto_keyword_map(active_dir, file_cache)

    # 3. 수동 오버라이드 병합 (수동이 자동보다 우선)
    keyword_map = {**auto_map, **KEYWORD_MAP_MANUAL}

    print(f'키워드 맵: 자동 {len(auto_map)}개 + 수동 {len(KEYWORD_MAP_MANUAL)}개 = {len(keyword_map)}개')

    # 4. 링크 주입
    updated = 0
    keyword_hit: dict[str, int] = {k: 0 for k in keyword_map}

    for fname, original in sorted(file_cache.items()):
        new_text = inject(original, keyword_map)
        if new_text == original:
            continue

        for kw, (hub_stem, display) in keyword_map.items():
            link = f'[[{hub_stem}|{display}]]'
            if original.count(link) < new_text.count(link):
                keyword_hit[kw] += 1

        with open(os.path.join(active_dir, fname), 'w', encoding='utf-8') as f:
            f.write(new_text)
        updated += 1

    print(f'완료: {updated}개 파일 업데이트')
    hit_items = [(kw, cnt) for kw, cnt in keyword_hit.items() if cnt > 0]
    if hit_items:
        print()
        print(f"{'키워드':<25} {'파일 수':>8}")
        print('-' * 36)
        for kw, cnt in sorted(hit_items, key=lambda x: -x[1]):
            print(f'{kw:<25} {cnt:>8}개 파일')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    run(sys.argv[1])
