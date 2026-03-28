"""
연도별 허브 파일 생성 스크립트 (gen_year_hubs.py)  v1.0
────────────────────────────────────────────────────────
기능:
  tags에 'chief'가 포함된 피드백 파일을 연도별로 그룹핑하여
  허브 파일(회의록_YYYY.md)을 자동 생성·갱신한다.
  최신 연도 허브 상단에 "최근 추가 (최신 N개)" 섹션을 생성한다.
  chief persona.md의 연도 허브 목록도 최신순으로 갱신한다.

사용법:
    python gen_year_hubs.py <vault_dir> [--top N]

옵션:
    --top N   최신 연도 허브에 표시할 최근 추가 문서 수 (기본값: 5)
    --vault   사용 안 함 (audit_and_fix.py와 인터페이스 호환)

의존 패키지:
    pip install PyYAML
"""

import os
import re
import sys
import yaml
from collections import defaultdict
from datetime import datetime

# 연도 허브 파일명 패턴
HUB_NAME_PAT = re.compile(r'^회의록_(\d{4})\.md$')
# 파일명에서 날짜 추출 ([YYYY.MM.DD] 또는 [YYYY_MM_DD] 패턴)
FNAME_DATE_PAT = re.compile(r'\[(\d{4})[._](\d{2})[._](\d{2})\]')
# chief persona 파일명 후보
CHIEF_PERSONA_PATS = ['chief persona.md', 'chief persona(0.1.0).md']


def load_frontmatter(text: str) -> tuple[dict, int]:
    if not text.startswith('---'):
        return {}, -1
    close = text.find('\n---', 3)
    if close == -1:
        return {}, -1
    try:
        fm = yaml.safe_load(text[3:close]) or {}
    except Exception:
        fm = {}
    return fm, close + 4


def get_date(fm: dict, fname: str) -> datetime | None:
    """frontmatter date 우선, 없으면 파일명 [YYYY.MM.DD] 추출."""
    date_val = fm.get('date')
    if date_val:
        try:
            return datetime.strptime(str(date_val).strip(), '%Y-%m-%d')
        except Exception:
            pass
    m = FNAME_DATE_PAT.search(fname)
    if m:
        try:
            return datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except Exception:
            pass
    return None


def has_chief_tag(fm: dict) -> bool:
    tags = fm.get('tags', [])
    if isinstance(tags, str):
        tags = [tags]
    return any(str(t).lower() == 'chief' for t in (tags or []))


def make_hub_content(year: int, entries: list[tuple[datetime, str, str]], top_n: int, is_latest: bool) -> str:
    """연도 허브 파일 내용 생성.
    entries: [(date, stem, title), ...] — 날짜 최신순 정렬 완료 상태로 전달
    """
    today = datetime.now().strftime('%Y-%m-%d')
    lines = [
        '---',
        f'title: 회의록_{year}',
        f'date: {today}',
        'type: meeting',
        'status: active',
        'tags: [chief]',
        'speaker: chief_director',
        f'related: [chief persona]',
        'origin: generated',
        '---',
        '',
        f'# 회의록_{year}',
        '',
    ]

    if is_latest and top_n > 0 and entries:
        recent = entries[:top_n]
        lines += [
            f'## 최근 추가 (최신 {len(recent)}개)',
            '',
            '> 최신 피드백이 필요하면 이 섹션을 먼저 볼 것.',
            '',
        ]
        for dt, stem, title in recent:
            date_str = dt.strftime('%Y.%m.%d')
            lines.append(f'- [[{stem}]] ({date_str})')
        lines.append('')

    lines += [
        f'## 전체 목록 ({len(entries)}개 · 최신순)',
        '',
    ]
    for dt, stem, title in entries:
        date_str = dt.strftime('%Y.%m.%d')
        lines.append(f'- [[{stem}]] ({date_str})')

    lines.append('')
    return '\n'.join(lines)


def update_chief_persona(vault_dir: str, years_desc: list[int], top_n: int, year_counts: dict[int, int]) -> bool:
    """chief persona.md의 연도 허브 섹션을 갱신. 파일 없으면 False 반환."""
    # 파일 탐색
    chief_path = None
    for candidate in CHIEF_PERSONA_PATS:
        p = os.path.join(vault_dir, candidate)
        if os.path.exists(p):
            chief_path = p
            break
    if not chief_path:
        # 파일명에 'chief persona' 포함된 파일 검색
        for fname in os.listdir(vault_dir):
            if 'chief persona' in fname.lower() and fname.endswith('.md'):
                chief_path = os.path.join(vault_dir, fname)
                break

    if not chief_path:
        print('⚠ chief persona.md 파일을 찾을 수 없습니다. 연도 허브 섹션 갱신 스킵.')
        return False

    with open(chief_path, encoding='utf-8') as f:
        original = f.read()

    latest_year = years_desc[0] if years_desc else None

    # 새 섹션 내용 구성
    recent_section_lines = ['## 최근 피드백 (현재 기준 — 우선 참조)', '']
    if latest_year:
        count = year_counts.get(latest_year, 0)
        recent_section_lines.append(f'> ⚠️ 가장 최근 이사장 피드백은 아래 링크를 먼저 확인할 것.')
        recent_section_lines.append('')
        recent_section_lines.append(f'- [[회의록_{latest_year}]] — **현재 연도 (최신 {min(top_n, count)}개 문서)**')
        recent_section_lines.append('')

    archive_lines = ['## 연도별 피드백 아카이브', '']
    if len(years_desc) > 1:
        archive_lines.append('> 이전 연도 데이터는 참고용. 현재 기준 정보는 위 섹션 우선.')
        archive_lines.append('')
        for y in years_desc[1:]:
            archive_lines.append(f'- [[회의록_{y}]] — {y}년 전체')
        archive_lines.append('')

    new_section = '\n'.join(recent_section_lines) + '\n' + '\n'.join(archive_lines)

    # 기존 섹션 교체 또는 끝에 추가
    recent_pat = re.compile(
        r'## 최근 피드백 \(현재 기준.*?\n(?:.*\n)*?(?=^## |\Z)',
        re.MULTILINE
    )
    archive_pat = re.compile(
        r'## 연도별 피드백 아카이브\n(?:.*\n)*?(?=^## |\Z)',
        re.MULTILINE
    )

    if recent_pat.search(original):
        # 두 섹션이 이미 있으면 통째로 교체
        combined_pat = re.compile(
            r'## 최근 피드백 \(현재 기준.*?\n(?:.*\n)*?(?=^## (?!연도별)|\Z)',
            re.MULTILINE
        )
        new_text = combined_pat.sub(new_section + '\n', original)
        # archive 섹션도 교체
        new_text = archive_pat.sub('', new_text)
    else:
        # 없으면 frontmatter 다음에 추가
        _, fm_end = load_frontmatter(original)
        if fm_end != -1:
            new_text = original[:fm_end] + '\n' + new_section + '\n' + original[fm_end:].lstrip('\n')
        else:
            new_text = new_section + '\n\n' + original

    if new_text == original:
        print(f'  chief persona.md 변경 없음')
        return True

    with open(chief_path, 'w', encoding='utf-8') as f:
        f.write(new_text)
    print(f'  chief persona.md 연도 허브 섹션 갱신 완료')
    return True


def resolve_active_dir(vault_dir: str) -> str:
    """vault root 또는 active/ 서브폴더 중 실제 md 파일이 있는 쪽 반환."""
    active = os.path.join(vault_dir, 'active')
    if os.path.isdir(active):
        return active
    return vault_dir


def run(vault_dir: str, top_n: int = 5) -> None:
    active_dir = resolve_active_dir(vault_dir)

    # 1. chief 태그 파일 수집
    chief_entries: list[tuple[datetime, str, str]] = []  # (date, stem, title)
    hub_files: set[str] = set()

    for fname in sorted(os.listdir(active_dir)):
        if not fname.endswith('.md'):
            continue
        stem = os.path.splitext(fname)[0]

        # 연도 허브 파일 자체는 스킵
        if HUB_NAME_PAT.match(fname):
            hub_files.add(fname)
            continue

        path = os.path.join(active_dir, fname)
        try:
            with open(path, encoding='utf-8') as f:
                text = f.read()
        except Exception:
            continue

        fm, _ = load_frontmatter(text)
        if not has_chief_tag(fm):
            continue

        dt = get_date(fm, fname)
        if dt is None:
            continue

        title = fm.get('title', stem)
        chief_entries.append((dt, stem, str(title)))

    if not chief_entries:
        print('chief 태그 파일을 찾을 수 없습니다.')
        return

    # 2. 연도별 그룹핑 (최신순 정렬)
    by_year: dict[int, list[tuple[datetime, str, str]]] = defaultdict(list)
    for entry in chief_entries:
        by_year[entry[0].year].append(entry)

    for year in by_year:
        by_year[year].sort(key=lambda x: x[0], reverse=True)

    years_desc = sorted(by_year.keys(), reverse=True)
    latest_year = years_desc[0]

    print(f'chief 태그 파일 {len(chief_entries)}개 → {len(years_desc)}개 연도 그룹')

    # 3. 연도별 허브 파일 생성·갱신
    year_counts: dict[int, int] = {}
    for year in years_desc:
        entries = by_year[year]
        year_counts[year] = len(entries)
        is_latest = (year == latest_year)
        content = make_hub_content(year, entries, top_n, is_latest)
        hub_path = os.path.join(active_dir, f'회의록_{year}.md')
        existing = ''
        if os.path.exists(hub_path):
            with open(hub_path, encoding='utf-8') as f:
                existing = f.read()
        if content != existing:
            with open(hub_path, 'w', encoding='utf-8') as f:
                f.write(content)
            action = '갱신' if existing else '생성'
            print(f'  회의록_{year}.md {action} ({len(entries)}개 문서{", 최근 추가 섹션 포함" if is_latest else ""})')
        else:
            print(f'  회의록_{year}.md 변경 없음')

    # 4. chief persona.md 갱신
    update_chief_persona(active_dir, years_desc, top_n, year_counts)

    print(f'\n완료: {len(years_desc)}개 연도 허브 처리')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: python gen_year_hubs.py <vault_dir> [--top N]', file=sys.stderr)
        sys.exit(1)

    vault_dir = None
    top_n = 5
    i = 1
    while i < len(sys.argv):
        arg = sys.argv[i]
        if arg == '--top' and i + 1 < len(sys.argv):
            try:
                top_n = int(sys.argv[i + 1])
            except ValueError:
                pass
            i += 2
        elif arg == '--vault' and i + 1 < len(sys.argv):
            i += 2  # --vault 는 무시 (audit_and_fix.py 호환)
        elif not arg.startswith('--'):
            vault_dir = arg
            i += 1
        else:
            i += 1

    if not vault_dir:
        print('오류: vault_dir 인수가 필요합니다.', file=sys.stderr)
        sys.exit(1)

    run(vault_dir, top_n)
