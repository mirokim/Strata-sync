#!/usr/bin/env python3
"""
crosslink_jira.py — Jira ↔ Active 볼트 교차 링크 주입

Jira 파일(Epic, Release, attachments_md)과 Active 볼트 간의 wikilink를 생성하여
BFS 도달성을 확보한다.

사용법:
  python crosslink_jira.py [vault_path] --dry-run   # 미리보기
  python crosslink_jira.py [vault_path] --apply      # 실제 반영
"""

import io
import re
import sys
import argparse
from pathlib import Path
from collections import defaultdict

# Windows 콘솔 UTF-8 출력 강제
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# ── 스킵 키워드 (너무 일반적인 용어) ────────────────────────────────────
SKIP_TERMS = frozenset({
    '프로젝트', '작업', '이슈', '기획', '개발', '아트', '테스트', '구현',
    '수정', '추가', '관련', '정리', '목록', '문서', '확인', '내용', '결과',
    '진행', '완료', '검토', '요청', '반영', '변경', '적용', '정리',
    '필요', '처리', '예정', '참고', '기타', '기능', '상태', '현황',
})

# Confluence ID 패턴: 숫자_로 시작하는 접두사
CONFLUENCE_ID_RE = re.compile(r'^\d{6,}_')

# 프론트매터 분리
def split_frontmatter(content: str) -> tuple:
    """(frontmatter_str, body_str) 반환. frontmatter 없으면 ('', content)."""
    if content.startswith('---'):
        end = content.find('\n---\n', 4)
        if end != -1:
            return content[:end + 5], content[end + 5:]
        # 파일 끝에 --- 만 있는 경우
        if content.rstrip().endswith('---') and content.count('---') >= 2:
            end2 = content.find('---', 4)
            return content[:end2 + 3] + '\n', content[end2 + 3:]
    return '', content


def parse_related(fm: str) -> list:
    """frontmatter에서 related: [] 값 파싱."""
    m = re.search(r'related:\s*\[([^\]]*)\]', fm)
    if not m:
        return []
    raw = m.group(1).strip()
    if not raw:
        return []
    return [t.strip().strip('"').strip("'") for t in raw.split(',') if t.strip()]


def update_related_fm(fm: str, new_stems: list) -> str:
    """frontmatter의 related 배열에 새 항목 추가."""
    if not new_stems:
        return fm
    existing = parse_related(fm)
    existing_set = set(existing)
    to_add = [s for s in new_stems if s not in existing_set]
    if not to_add:
        return fm
    merged = existing + to_add
    new_val = ', '.join(merged)
    if re.search(r'related:\s*\[', fm):
        return re.sub(r'related:\s*\[[^\]]*\]', f'related: [{new_val}]', fm)
    # related 필드가 없으면 tags 뒤에 삽입
    if 'tags:' in fm:
        return re.sub(r'(tags:\s*\[[^\]]*\]\n)', rf'\1related: [{new_val}]\n', fm)
    # 최후 수단: --- 직전
    return fm.rstrip().rstrip('-').rstrip() + f'\nrelated: [{new_val}]\n---\n'


# ── 키워드 추출 ────────────────────────────────────────────────────────

def extract_tokens_from_stem(stem: str) -> list:
    """파일 stem에서 의미 있는 토큰 추출.
    Confluence ID 접두사 제거 후, 언더스코어/공백/특수문자 기준 분리."""
    # Confluence ID 제거
    clean = CONFLUENCE_ID_RE.sub('', stem)
    # 날짜 패턴 제거 (2024_03_11, 20240311 등)
    clean = re.sub(r'\b20\d{2}[_\-.]?\d{2}[_\-.]?\d{2}\b', '', clean)
    clean = re.sub(r'\b20\d{2}년?\b', '', clean)
    # 대괄호 내용 보존하면서 괄호 제거
    clean = clean.replace('[', ' ').replace(']', ' ')
    clean = clean.replace('(', ' ').replace(')', ' ')
    # 구분자 기준 분리
    parts = re.split(r'[_\s\-./·,]+', clean)
    tokens = []
    for p in parts:
        p = p.strip()
        if len(p) >= 2 and p not in SKIP_TERMS:
            # 숫자만인 토큰 스킵
            if re.match(r'^\d+$', p):
                continue
            tokens.append(p)
    return tokens


def build_active_index(active_dir: Path) -> tuple:
    """active 볼트에서 (stem→tokens, token→stems) 인덱스 구축.

    Returns:
        stem_tokens: dict[str, list[str]] — 각 stem의 토큰 목록
        token_stems: dict[str, set[str]] — 각 토큰이 등장하는 stem 집합
        stem_title:  dict[str, str]      — stem → title
    """
    stem_tokens = {}
    token_stems = defaultdict(set)
    stem_title = {}

    for md in active_dir.glob('*.md'):
        if md.name.startswith('_'):
            continue
        stem = md.stem
        tokens = extract_tokens_from_stem(stem)
        if not tokens:
            continue
        stem_tokens[stem] = tokens
        for t in tokens:
            token_stems[t].add(stem)
        # title 추출
        try:
            head = md.read_text(encoding='utf-8', errors='replace')[:500]
            m = re.search(r'title:\s*"?([^"\n]+)"?', head)
            stem_title[stem] = m.group(1).strip("'\"") if m else stem
        except Exception:
            stem_title[stem] = stem

    return stem_tokens, token_stems, stem_title


# ── Jira 파일 매칭 ─────────────────────────────────────────────────────

def score_matches(jira_content: str, jira_title: str,
                  stem_tokens: dict, token_stems: dict) -> list:
    """Jira 파일 본문과 active 파일 간 매칭 점수 계산.

    Returns: [(stem, score), ...] 내림차순 정렬
    """
    scores = defaultdict(float)

    # 본문 텍스트 (개요, 설명, 전체)
    body_lower = jira_content.lower()
    title_lower = jira_title.lower()

    # 모든 active 토큰에 대해 검색
    checked_tokens = set()
    for token in token_stems:
        if token in checked_tokens:
            continue
        if len(token) < 2:
            continue
        checked_tokens.add(token)

        t_lower = token.lower()
        # 본문 매칭
        body_count = body_lower.count(t_lower)
        if body_count == 0:
            continue

        # 타이틀 매칭 보너스
        title_bonus = 3.0 if t_lower in title_lower else 0.0

        for stem in token_stems[token]:
            # 기본: 본문 출현 (cap at 5)
            scores[stem] += min(body_count, 5) * 1.0 + title_bonus

    # stem 전체 이름 매칭 보너스 (Confluence ID 제거 후)
    for stem in stem_tokens:
        clean_stem = CONFLUENCE_ID_RE.sub('', stem).strip('_ ')
        if len(clean_stem) >= 4 and clean_stem.lower() in body_lower:
            scores[stem] += 10.0

    # 최소 2개 토큰 매칭 필터
    # 토큰 매칭 수 계산
    token_match_count = defaultdict(int)
    for token in token_stems:
        t_lower = token.lower()
        if t_lower in body_lower:
            for stem in token_stems[token]:
                token_match_count[stem] += 1

    # 2개 미만 토큰 매칭은 제거 (stem 전체 매칭은 예외)
    filtered = {}
    for stem, score in scores.items():
        clean_stem = CONFLUENCE_ID_RE.sub('', stem).strip('_ ')
        has_full_match = len(clean_stem) >= 4 and clean_stem.lower() in body_lower
        if token_match_count[stem] >= 2 or has_full_match:
            filtered[stem] = score

    ranked = sorted(filtered.items(), key=lambda x: -x[1])
    return ranked


# ── 섹션 주입 ──────────────────────────────────────────────────────────

def has_section(content: str, heading: str) -> bool:
    """특정 ## 섹션이 이미 존재하는지 확인."""
    return f'\n{heading}\n' in content or content.startswith(f'{heading}\n')


def append_section(content: str, heading: str, links: list) -> str:
    """파일 끝에 섹션 추가. 이미 있으면 기존 섹션에 링크 추가."""
    link_lines = '\n'.join(f'- [[{link}]]' for link in links)
    block = f'\n\n{heading}\n\n{link_lines}\n'

    if has_section(content, heading):
        # 기존 섹션 끝에 추가 (중복 방지)
        existing_links = set(re.findall(r'\[\[([^\]]+)\]\]', content))
        new_links = [l for l in links if l not in existing_links]
        if not new_links:
            return content
        add_lines = '\n'.join(f'- [[{l}]]' for l in new_links)
        # 섹션 위치 찾기
        idx = content.find(f'\n{heading}\n')
        if idx == -1:
            idx = content.find(f'{heading}\n')
        # 다음 ## 또는 파일 끝 찾기
        after = idx + len(heading) + 2
        next_section = content.find('\n## ', after)
        if next_section == -1:
            # 파일 끝에 추가
            return content.rstrip() + '\n' + add_lines + '\n'
        else:
            return content[:next_section] + '\n' + add_lines + content[next_section:]
    else:
        return content.rstrip() + block


# ── 메인 로직 ──────────────────────────────────────────────────────────

def collect_jira_files(jira_dir: Path) -> list:
    """Jira 디렉토리에서 모든 MD 파일 수집 (Epic, Release, attachments_md)."""
    files = []
    # Epic + Release (루트 레벨)
    for md in jira_dir.glob('*.md'):
        if md.name == 'jira_index.md':
            continue
        files.append(md)
    # attachments_md
    att_dir = jira_dir / 'attachments_md'
    if att_dir.exists():
        for md in att_dir.glob('*.md'):
            files.append(md)
    return sorted(files)


def run(vault_path: Path, dry_run: bool = True):
    active_dir = vault_path / 'active'
    jira_dir = vault_path / 'jira'

    if not active_dir.exists():
        print(f"ERROR: active 디렉토리 없음: {active_dir}")
        sys.exit(1)
    if not jira_dir.exists():
        print(f"ERROR: jira 디렉토리 없음: {jira_dir}")
        sys.exit(1)

    mode = "DRY-RUN" if dry_run else "APPLY"
    print(f"=== crosslink_jira.py [{mode}] ===")
    print(f"Active: {active_dir}")
    print(f"Jira:   {jira_dir}")
    print()

    # 1) Active 인덱스 구축
    print("Active 볼트 인덱스 구축 중...")
    stem_tokens, token_stems, stem_title = build_active_index(active_dir)
    print(f"  → {len(stem_tokens)} 파일, {len(token_stems)} 고유 토큰")
    print()

    # 2) Jira 파일 스캔 & 매칭
    jira_files = collect_jira_files(jira_dir)
    print(f"Jira 파일 스캔: {len(jira_files)}개")

    # 결과 누적
    jira_to_active = {}   # jira_path → [active_stems]
    active_to_jira = defaultdict(list)  # active_stem → [jira_stems]

    stats = {
        'jira_scanned': len(jira_files),
        'jira_linked': 0,
        'links_jira_to_active': 0,
        'links_active_to_jira': 0,
        'active_files_modified': 0,
    }

    for jira_md in jira_files:
        try:
            content = jira_md.read_text(encoding='utf-8', errors='replace')
        except Exception:
            continue

        fm, body = split_frontmatter(content)
        # title 추출
        m_title = re.search(r'title:\s*"?([^"\n]+)"?', fm)
        title = m_title.group(1).strip("'\"") if m_title else jira_md.stem

        ranked = score_matches(content, title, stem_tokens, token_stems)
        if not ranked:
            continue

        # 상위 10개
        top = ranked[:10]
        top_stems = [s for s, _ in top]

        jira_to_active[jira_md] = top_stems
        stats['jira_linked'] += 1
        stats['links_jira_to_active'] += len(top_stems)

        # 역방향 매핑 (active → jira, max 5는 나중에 적용)
        jira_stem = jira_md.stem
        # jira 파일이 attachments_md 안에 있으면 경로 포함
        if jira_md.parent.name == 'attachments_md':
            jira_link = f"jira/attachments_md/{jira_stem}"
        else:
            jira_link = f"jira/{jira_stem}"

        for active_stem in top_stems:
            active_to_jira[active_stem].append((jira_link, jira_stem))

    print(f"  → 매칭된 Jira 파일: {stats['jira_linked']}개")
    print(f"  → Jira→Active 링크: {stats['links_jira_to_active']}개")
    print()

    # 3) Jira 파일에 ## 관련 문서 주입 + related frontmatter 업데이트
    print("Jira 파일에 링크 주입 중...")
    for jira_md, active_stems in jira_to_active.items():
        try:
            content = jira_md.read_text(encoding='utf-8', errors='replace')
        except Exception:
            continue

        fm, body = split_frontmatter(content)

        # frontmatter related 업데이트
        new_fm = update_related_fm(fm, active_stems)

        # ## 관련 문서 섹션 추가
        new_body = append_section(body, '## 관련 문서', active_stems)

        new_content = new_fm + new_body

        if new_content != content:
            if dry_run:
                changed_links = len(active_stems)
                print(f"  [DRY] {jira_md.name}: +{changed_links} links")
            else:
                jira_md.write_text(new_content, encoding='utf-8')
                print(f"  [OK]  {jira_md.name}: +{len(active_stems)} links")

    # 4) Active 파일에 ## Jira 관련 역방향 링크 주입
    print()
    print("Active 파일에 역방향 Jira 링크 주입 중...")
    for active_stem, jira_links in active_to_jira.items():
        active_md = active_dir / f"{active_stem}.md"
        if not active_md.exists():
            continue

        # max 5 jira links per active file
        jira_links_unique = []
        seen = set()
        for link, stem in jira_links:
            if link not in seen:
                seen.add(link)
                jira_links_unique.append(link)
            if len(jira_links_unique) >= 5:
                break

        try:
            content = active_md.read_text(encoding='utf-8', errors='replace')
        except Exception:
            continue

        # 이미 있는 링크 확인
        existing_links = set(re.findall(r'\[\[([^\]]+)\]\]', content))
        new_jira = [l for l in jira_links_unique if l not in existing_links]
        if not new_jira:
            continue

        new_content = append_section(content, '## Jira 관련', new_jira)

        if new_content != content:
            stats['active_files_modified'] += 1
            stats['links_active_to_jira'] += len(new_jira)
            if dry_run:
                print(f"  [DRY] {active_md.name}: +{len(new_jira)} Jira links")
            else:
                active_md.write_text(new_content, encoding='utf-8')
                print(f"  [OK]  {active_md.name}: +{len(new_jira)} Jira links")

    # 5) _index.md 업데이트
    print()
    index_md = active_dir / '_index.md'
    index_updated = False
    if index_md.exists():
        try:
            idx_content = index_md.read_text(encoding='utf-8', errors='replace')
        except Exception:
            idx_content = ''

        if '[[jira/jira_index]]' not in idx_content and '[[jira_index]]' not in idx_content:
            jira_section = (
                '\n\n## Jira\n\n'
                '- [[jira/jira_index]] — Jira Epic·Release 전체 인덱스\n'
            )
            new_idx = idx_content.rstrip() + jira_section
            if dry_run:
                print(f"  [DRY] _index.md: Jira 섹션 추가")
            else:
                index_md.write_text(new_idx, encoding='utf-8')
                print(f"  [OK]  _index.md: Jira 섹션 추가")
            index_updated = True
        else:
            print("  _index.md: Jira 링크 이미 존재, 스킵")
    else:
        print(f"  WARNING: _index.md 없음 ({index_md})")

    # 6) 요약 출력
    print()
    print("=" * 50)
    print(f"총 Jira 파일 스캔:        {stats['jira_scanned']}")
    print(f"링크 추가된 Jira 파일:     {stats['jira_linked']}")
    print(f"Jira→Active 링크 수:      {stats['links_jira_to_active']}")
    print(f"Active→Jira 링크 수:      {stats['links_active_to_jira']}")
    print(f"수정된 Active 파일:        {stats['active_files_modified']}")
    print(f"_index.md 업데이트:        {'예' if index_updated else '아니오'}")
    print(f"총 주입 링크:              {stats['links_jira_to_active'] + stats['links_active_to_jira']}")
    print("=" * 50)

    if dry_run:
        print("\n⚠ DRY-RUN 모드: 실제 파일 변경 없음. --apply 로 실행하세요.")


def main():
    parser = argparse.ArgumentParser(
        description='Jira ↔ Active 볼트 교차 wikilink 주입'
    )
    parser.add_argument(
        'vault_path', nargs='?', default='c:/dev2/refined_vault',
        help='refined_vault 루트 경로 (기본: c:/dev2/refined_vault)'
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--dry-run', action='store_true', help='미리보기 (파일 변경 없음)')
    group.add_argument('--apply', action='store_true', help='실제 반영')

    args = parser.parse_args()
    vault = Path(args.vault_path)

    if not vault.exists():
        print(f"ERROR: 볼트 경로 없음: {vault}")
        sys.exit(1)

    run(vault, dry_run=not args.apply)


if __name__ == '__main__':
    main()
