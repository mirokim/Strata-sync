"""
Graph RAG 최신성 버그 점검 스크립트 (check_outdated.py)  v1.0
────────────────────────────────────────────────────────────
기능:
  Graph RAG 봇이 오래된 데이터를 응답하는 버그의 주요 원인을
  자동으로 점검하고 보고한다.

점검 항목:
  ① status: outdated 인데 superseded_by 없는 파일
     → --fix 옵션 시 .archive/ 자동 이동
  ② 최근 N일 이내 신규 문서 중 역링크 0개인 고립 파일
     → gen_year_hubs.py 재실행 또는 수동 링크 추가 필요
  ③ currentSituation.md / _index.md 의 date 필드가 N일 초과 시 경고
  ④ chief persona.md 연도 허브 순서 점검
     → 최신 연도가 맨 위가 아니면 경고

추가 옵션:
  --batch-check   동일 날짜를 가진 파일이 5개 이상인 날짜 목록 출력
                  (Confluence 배치 동기화 날짜 오염 진단용)

사용법:
    python check_outdated.py <vault_dir> [--vault <vault_root>]
                             [--days N] [--fix] [--batch-check]

의존 패키지:
    pip install PyYAML
"""

import os
import re
import sys
import shutil
import yaml
from collections import Counter, defaultdict
from datetime import datetime, timedelta


HUB_YEAR_PAT   = re.compile(r'회의록_(\d{4})')
WIKILINK_PAT   = re.compile(r'\[\[([^\[\]]+?)\]\]')
CHIEF_PERSONAS = ['chief persona.md', 'chief persona(0.1.0).md']


def resolve_active_dir(vault_dir: str) -> str:
    active = os.path.join(vault_dir, 'active')
    if os.path.isdir(active):
        return active
    return vault_dir


def split_fm(text: str) -> tuple[dict, str]:
    if text.startswith('---'):
        end = text.find('\n---', 3)
        if end != -1:
            try:
                fm = yaml.safe_load(text[3:end]) or {}
            except Exception:
                fm = {}
            return fm, text[end + 4:]
    return {}, text


def get_date(fm: dict) -> datetime | None:
    val = fm.get('date')
    if not val:
        return None
    try:
        return datetime.strptime(str(val).strip(), '%Y-%m-%d')
    except Exception:
        return None


def run(active_dir: str, vault_root: str | None = None,
        days: int = 30, fix: bool = False, batch_check: bool = False) -> None:
    vault_root = vault_root or active_dir
    today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    cutoff = today - timedelta(days=days)

    md_files = sorted(f for f in os.listdir(active_dir) if f.endswith('.md'))
    total = len(md_files)

    print(f"\n{'='*60}")
    print(f" Graph RAG 최신성 점검 보고서  v1.0")
    print(f" 대상: {active_dir}")
    print(f" 파일 수: {total}개  |  점검 기준일: {today.strftime('%Y-%m-%d')} (최근 {days}일)")
    print(f"{'='*60}\n")

    # 전체 stem 집합 및 역링크 카운터
    all_stems: set[str] = set()
    for root, dirs, files in os.walk(vault_root):
        dirs[:] = [d for d in dirs if not d.startswith('.')]
        for f in files:
            if f.endswith('.md'):
                all_stems.add(f[:-3])

    backlink_count: dict[str, int] = defaultdict(int)
    date_counter: Counter = Counter()
    records: list[tuple[str, dict, str]] = []  # (stem, fm, body)

    for fname in md_files:
        path = os.path.join(active_dir, fname)
        stem = fname[:-3]
        try:
            with open(path, encoding='utf-8') as f:
                text = f.read()
        except Exception:
            continue
        fm, body = split_fm(text)
        records.append((stem, fm, body))

        # 역링크 집계
        for m in WIKILINK_PAT.finditer(body):
            target = m.group(1).split('|')[0].strip()
            if target in all_stems:
                backlink_count[target] += 1

        # 날짜 집계 (batch-check용)
        if batch_check:
            dt = get_date(fm)
            if dt:
                date_counter[dt.strftime('%Y-%m-%d')] += 1

    # ── ① outdated 파일 (superseded_by 없음) ──────────────────────────────────
    outdated_no_sup: list[str] = []
    for stem, fm, _ in records:
        if str(fm.get('status', '')).lower() == 'outdated' and not fm.get('superseded_by'):
            outdated_no_sup.append(stem)

    status = 'WARN' if outdated_no_sup else 'PASS'
    print(f"[{status}] ① status:outdated + superseded_by 없음: {len(outdated_no_sup)}건")
    for s in outdated_no_sup[:5]:
        print(f"       - {s[:70]}")
    if len(outdated_no_sup) > 5:
        print(f"       ... 외 {len(outdated_no_sup)-5}건")
    print()

    if fix and outdated_no_sup:
        archive_dir = os.path.join(active_dir, '.archive')
        os.makedirs(archive_dir, exist_ok=True)
        moved = 0
        for stem in outdated_no_sup:
            src = os.path.join(active_dir, f'{stem}.md')
            dst = os.path.join(archive_dir, f'{stem}.md')
            if os.path.exists(src):
                shutil.move(src, dst)
                moved += 1
        print(f"  [FIX] {moved}개 파일 → .archive/ 이동\n")

    # ── ② 최근 N일 신규 문서 중 역링크 0개인 고립 파일 ───────────────────────
    isolated_new: list[tuple[str, str]] = []
    for stem, fm, _ in records:
        dt = get_date(fm)
        if dt and dt >= cutoff:
            bl = backlink_count.get(stem, 0)
            if bl == 0:
                isolated_new.append((stem, dt.strftime('%Y-%m-%d')))

    status = 'WARN' if isolated_new else 'PASS'
    print(f"[{status}] ② 최근 {days}일 신규 문서 중 역링크 0개 (고립): {len(isolated_new)}건")
    for s, d in isolated_new[:5]:
        print(f"       - {s[:55]} ({d})")
    if len(isolated_new) > 5:
        print(f"       ... 외 {len(isolated_new)-5}건")
    print()

    # ── ③ currentSituation.md / _index.md date 필드 최신성 ───────────────────
    hub_targets = ['currentSituation', '_index']
    stale_hubs: list[tuple[str, str]] = []
    for stem, fm, _ in records:
        if stem in hub_targets:
            dt = get_date(fm)
            if dt is None:
                stale_hubs.append((stem, 'date 필드 없음'))
            elif dt < cutoff:
                delta = (today - dt).days
                stale_hubs.append((stem, f'{delta}일 경과 (마지막: {dt.strftime("%Y-%m-%d")})'))

    status = 'WARN' if stale_hubs else 'PASS'
    print(f"[{status}] ③ 허브 문서 최신성 ({days}일 기준):")
    for name, msg in stale_hubs:
        print(f"       - {name}.md: {msg}")
    if not stale_hubs:
        print("       - 이상 없음")
    print()

    # ── ④ chief persona.md 연도 허브 순서 점검 ────────────────────────────────
    chief_path = None
    for candidate in CHIEF_PERSONAS:
        p = os.path.join(active_dir, candidate)
        if os.path.exists(p):
            chief_path = p
            break
    if not chief_path:
        for fname in os.listdir(active_dir):
            if 'chief persona' in fname.lower() and fname.endswith('.md'):
                chief_path = os.path.join(active_dir, fname)
                break

    if chief_path:
        with open(chief_path, encoding='utf-8') as f:
            chief_text = f.read()
        years_found = [int(m) for m in HUB_YEAR_PAT.findall(chief_text)]
        if years_found:
            sorted_years = sorted(set(years_found), reverse=True)
            first_occurrence = {y: years_found.index(y) for y in set(years_found)}
            # 가장 먼저 등장한 연도가 최신 연도여야 함
            first_year = years_found[0]
            expected_first = sorted_years[0]
            if first_year != expected_first:
                print(f"[WARN] ④ chief persona.md 연도 허브 순서 오류")
                print(f"       - 첫 등장 연도: {first_year}  |  최신 연도: {expected_first}")
                print(f"       - gen_year_hubs.py 재실행 필요\n")
            else:
                print(f"[PASS] ④ chief persona.md 연도 허브 순서: {sorted_years[0]} 최신 위치 정상\n")
        else:
            print(f"[WARN] ④ chief persona.md 에서 연도 허브 링크 미발견\n")
    else:
        print(f"[INFO] ④ chief persona.md 파일 없음 — 점검 스킵\n")

    # ── --batch-check: 배치 동기화 날짜 오염 진단 ─────────────────────────────
    if batch_check:
        print(f"[INFO] 배치 날짜 오염 진단 (5개 이상 집중된 날짜):")
        suspicious = [(date, cnt) for date, cnt in date_counter.most_common() if cnt >= 5]
        if suspicious:
            print(f"       {'날짜':<15} {'파일 수':>8}")
            print(f"       {'-'*25}")
            for date, cnt in suspicious[:15]:
                flag = ' ← 의심' if cnt >= 10 else ''
                print(f"       {date:<15} {cnt:>8}개{flag}")
            if len(suspicious) > 15:
                print(f"       ... 외 {len(suspicious)-15}개 날짜")
        else:
            print("       동일 날짜 5개 이상 집중 없음 (배치 오염 미탐지)")
        print()

    total_issues = len(outdated_no_sup) + len(isolated_new) + len(stale_hubs)
    print(f"{'='*60}")
    print(f" 수정 권장 이슈: {total_issues}건")
    if outdated_no_sup and not fix:
        print(f" (--fix 옵션으로 outdated 파일 {len(outdated_no_sup)}개 자동 .archive/ 이동 가능)")
    print(f"{'='*60}\n")


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    days = 30
    fix = False
    batch_check = False
    vault = None
    i = 1
    while i < len(sys.argv):
        arg = sys.argv[i]
        if arg == '--days' and i + 1 < len(sys.argv):
            try:
                days = int(sys.argv[i + 1])
            except ValueError:
                pass
            i += 2
        elif arg == '--vault' and i + 1 < len(sys.argv):
            vault = sys.argv[i + 1]
            i += 2
        elif arg == '--fix':
            fix = True
            i += 1
        elif arg == '--batch-check':
            batch_check = True
            i += 1
        else:
            i += 1

    active_dir = resolve_active_dir(sys.argv[1])
    run(active_dir, vault or sys.argv[1], days=days, fix=fix, batch_check=batch_check)
