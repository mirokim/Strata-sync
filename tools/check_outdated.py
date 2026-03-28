#!/usr/bin/env python3
"""
check_outdated.py — §18.3 Graph RAG 최신성 버그 점검 도구

점검 항목 (§18.3):
  ① status: outdated 인데 superseded_by 없는 파일
     → --fix 옵션 시 .archive/ 자동 이동
  ② 최근 N일 이내 신규 문서 중 역링크 0개인 고립 파일 탐지
     → gen_year_hubs.py 재실행 또는 수동 링크 추가 필요
  ③ currentSituation.md / _index.md 의 date 필드가 N일 초과 시 경고
     → 수동 갱신 필요
  ④ chief persona.md 연도 허브 순서 점검
     → 최신 연도가 맨 위가 아니면 경고

사용법:
  python check_outdated.py <active_dir> [--days 30] [--fix] [--archive <dir>]
"""

import re
import sys
import shutil
import argparse
from pathlib import Path
from datetime import datetime, timedelta


def parse_frontmatter(content: str) -> dict:
    """frontmatter 주요 필드를 dict 로 반환."""
    if not content.startswith('---'):
        return {}
    end = content.find('\n---\n', 4)
    if end == -1:
        return {}
    fm = content[4:end]
    result: dict = {}
    for line in fm.splitlines():
        m = re.match(r'^(\w+):\s*(.+)$', line.strip())
        if m:
            result[m.group(1)] = m.group(2).strip().strip('"\'')
    return result


def get_body(content: str) -> str:
    if not content.startswith('---'):
        return content
    end = content.find('\n---\n', 4)
    return content[end + 5:] if end != -1 else content


def build_inbound_map(active_dir: Path) -> dict[str, int]:
    """각 stem 에 대한 인바운드 링크 수를 계산."""
    inbound: dict[str, int] = {}
    for md in active_dir.glob('*.md'):
        try:
            body = get_body(md.read_text(encoding='utf-8', errors='replace'))
        except Exception:
            continue
        for target in re.findall(r'(?<!!)\[\[([^\]|]+)', body):
            stem = target.strip()
            inbound[stem] = inbound.get(stem, 0) + 1
    return inbound


def check_outdated(
    active_dir: Path,
    days: int = 30,
    fix: bool = False,
    archive_dir: Path | None = None,
) -> None:
    today = datetime.now()
    cutoff_new = today - timedelta(days=days)   # 최근 N일 기준
    cutoff_hub = today - timedelta(days=days)   # 허브 갱신 기준

    # ── 인바운드 링크 맵 구축 (② 에서 사용) ──────────────────────────
    inbound = build_inbound_map(active_dir)

    outdated_no_supersede: list[Path] = []
    orphan_new_docs: list[tuple[str, str]] = []   # (stem, date)
    hub_stale: list[tuple[str, str]] = []         # (filename, date)
    chief_persona_order_warn: list[str] = []

    for md in sorted(active_dir.glob('*.md')):
        try:
            content = md.read_text(encoding='utf-8', errors='replace')
        except Exception:
            continue

        fm = parse_frontmatter(content)
        status = fm.get('status', '')
        superseded_by = fm.get('superseded_by', '')
        date_str = fm.get('date', '')

        # ① status: outdated 인데 superseded_by 없는 파일
        if status == 'outdated' and not superseded_by:
            outdated_no_supersede.append(md)

        # ② 최근 N일 신규 문서 중 역링크 0개
        if date_str:
            try:
                doc_date = datetime.strptime(date_str[:10], '%Y-%m-%d')
                if doc_date >= cutoff_new:
                    if inbound.get(md.stem, 0) == 0:
                        orphan_new_docs.append((md.stem, date_str[:10]))
            except ValueError:
                pass

        # ③ currentSituation.md / _index.md 갱신 여부
        if md.name.lower() in ('currentsituation.md', '_index.md'):
            if date_str:
                try:
                    doc_date = datetime.strptime(date_str[:10], '%Y-%m-%d')
                    age = (today - doc_date).days
                    if age > days:
                        hub_stale.append((md.name, date_str[:10]))
                except ValueError:
                    hub_stale.append((md.name, f'날짜 파싱 불가: {date_str}'))
            else:
                hub_stale.append((md.name, '(date 필드 없음)'))

        # ④ chief persona.md 연도 허브 순서 점검
        if md.stem.lower() == 'chief persona' or md.name.lower() == 'chief persona.md':
            body = get_body(content)
            years = re.findall(r'회의록_(\d{4})', body)
            years_int = [int(y) for y in years]
            if years_int:
                for i in range(len(years_int) - 1):
                    if years_int[i] < years_int[i + 1]:
                        chief_persona_order_warn.append(
                            f"연도 허브 순서 오류: {years_int} "
                            f"(최신 연도가 맨 위여야 함)"
                        )
                        break

    # ── 출력 ──────────────────────────────────────────────────────────
    print("=" * 60)
    print(f"§18.3 Graph RAG 최신성 점검 (기준: {days}일)")
    print("=" * 60)

    # ①
    print(f"\n① outdated + superseded_by 없음: {len(outdated_no_supersede)}개")
    for p in outdated_no_supersede[:15]:
        print(f"   {p.stem[:60]}")
    if len(outdated_no_supersede) > 15:
        print(f"   ... 외 {len(outdated_no_supersede) - 15}개")

    if fix and outdated_no_supersede:
        if archive_dir is None:
            archive_dir = active_dir.parent / '.archive'
        archive_dir.mkdir(parents=True, exist_ok=True)
        moved = 0
        for p in outdated_no_supersede:
            dest = archive_dir / p.name
            if not dest.exists():
                shutil.move(str(p), str(dest))
                moved += 1
                print(f"   → .archive/ 이동: {p.name[:55]}")
        print(f"   --fix: {moved}개 파일 이동 완료")

    # ②
    print(f"\n② 최근 {days}일 신규 문서 중 역링크 0개 (고립): {len(orphan_new_docs)}개")
    for stem, date in sorted(orphan_new_docs, key=lambda x: x[1], reverse=True)[:15]:
        print(f"   {date}  {stem[:55]}")
    if len(orphan_new_docs) > 15:
        print(f"   ... 외 {len(orphan_new_docs) - 15}개")
    if orphan_new_docs:
        print("   → gen_year_hubs.py 재실행 또는 수동 역링크 추가 필요")

    # ③
    print(f"\n③ 허브 문서 갱신 필요 ({days}일 초과): {len(hub_stale)}개")
    for fname, date in hub_stale:
        print(f"   {fname}  (마지막 날짜: {date})")
    if hub_stale:
        print("   → currentSituation.md / _index.md 수동 갱신 필요")

    # ④
    print(f"\n④ chief persona.md 연도 허브 순서: ", end='')
    if chief_persona_order_warn:
        print(f"⚠️  {len(chief_persona_order_warn)}건 오류")
        for w in chief_persona_order_warn:
            print(f"   {w}")
        print("   → chief persona.md 에서 최신 연도를 맨 위로 이동 필요")
    else:
        print("✅ 정상 (또는 chief persona.md 없음)")

    print()


def main():
    parser = argparse.ArgumentParser(description='§18.3 Graph RAG 최신성 점검')
    parser.add_argument('active_dir', help='active/ 폴더 경로')
    parser.add_argument('--days', type=int, default=30,
                        help='점검 기준 일수 (①② 신규 판정, ③ 허브 갱신 기준, 기본: 30)')
    parser.add_argument('--fix', action='store_true',
                        help='① outdated 파일을 .archive/ 로 자동 이동')
    parser.add_argument('--archive', default=None,
                        help='--fix 시 이동할 archive 폴더 (기본: active_dir/../.archive)')
    args = parser.parse_args()

    active_dir = Path(args.active_dir)
    if not active_dir.is_dir():
        print(f"오류: {active_dir} 폴더를 찾을 수 없습니다.")
        sys.exit(1)

    archive_dir = Path(args.archive) if args.archive else None
    check_outdated(active_dir, days=args.days, fix=args.fix, archive_dir=archive_dir)


if __name__ == '__main__':
    main()
