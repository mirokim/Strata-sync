#!/usr/bin/env python3
"""
check_outdated.py — §18.3 Graph RAG freshness check tool

Inspection items (§18.3):
  ① Files with status: outdated but no superseded_by
     → Auto-move to .archive/ with --fix option
  ② Detect isolated files with 0 backlinks among new documents within last N days
     → Re-run gen_year_hubs.py or manually add links
  ③ Warn if date field in currentSituation.md / _index.md exceeds N days
     → Manual update needed
  ④ Check year hub order in chief persona.md
     → Warn if latest year is not at the top

Usage:
  python check_outdated.py <active_dir> [--days 30] [--fix] [--archive <dir>]
"""

import re
import sys
import shutil
import argparse
from pathlib import Path
from datetime import datetime, timedelta


def parse_frontmatter(content: str) -> dict:
    """Return main frontmatter fields as dict."""
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
    cutoff_new = today - timedelta(days=days)   # Last N days threshold
    cutoff_hub = today - timedelta(days=days)   # Hub update threshold

    # ── Build inbound link map (used in ②) ──────────────────────────
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

        # ① status: outdated but no superseded_by
        if status == 'outdated' and not superseded_by:
            outdated_no_supersede.append(md)

        # ② New documents in last N days with 0 backlinks
        if date_str:
            try:
                doc_date = datetime.strptime(date_str[:10], '%Y-%m-%d')
                if doc_date >= cutoff_new:
                    if inbound.get(md.stem, 0) == 0:
                        orphan_new_docs.append((md.stem, date_str[:10]))
            except ValueError:
                pass

        # ③ Whether currentSituation.md / _index.md needs update
        if md.name.lower() in ('currentsituation.md', '_index.md'):
            if date_str:
                try:
                    doc_date = datetime.strptime(date_str[:10], '%Y-%m-%d')
                    age = (today - doc_date).days
                    if age > days:
                        hub_stale.append((md.name, date_str[:10]))
                except ValueError:
                    hub_stale.append((md.name, f'Unable to parse date: {date_str}'))
            else:
                hub_stale.append((md.name, '(no date field)'))

        # ④ Check year hub order in chief persona.md
        if md.stem.lower() == 'chief persona' or md.name.lower() == 'chief persona.md':
            body = get_body(content)
            years = re.findall(r'회의록_(\d{4})', body)
            years_int = [int(y) for y in years]
            if years_int:
                for i in range(len(years_int) - 1):
                    if years_int[i] < years_int[i + 1]:
                        chief_persona_order_warn.append(
                            f"연도 허브 순서 Error: {years_int} "
                            f"(최신 연도가 맨 위여야 함)"
                        )
                        break

    # ── Output ──────────────────────────────────────────────────────────
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
        print(f"   --fix: {moved} files 이동 Complete")

    # ②
    print(f"\n② 최근 {days}일 신규 문서 중 역링크 0개 (고립): {len(orphan_new_docs)}개")
    for stem, date in sorted(orphan_new_docs, key=lambda x: x[1], reverse=True)[:15]:
        print(f"   {date}  {stem[:55]}")
    if len(orphan_new_docs) > 15:
        print(f"   ... 외 {len(orphan_new_docs) - 15}개")
    if orphan_new_docs:
        print("   → Re-run gen_year_hubs.py or manually add backlinks")

    # ③
    print(f"\n③ 허브 문서 갱신 필요 ({days}일 초과): {len(hub_stale)}개")
    for fname, date in hub_stale:
        print(f"   {fname}  (마지막 날짜: {date})")
    if hub_stale:
        print("   → Manual update of currentSituation.md / _index.md needed")

    # ④
    print(f"\n④ chief persona.md 연도 허브 순서: ", end='')
    if chief_persona_order_warn:
        print(f"⚠️  {len(chief_persona_order_warn)}건 오류")
        for w in chief_persona_order_warn:
            print(f"   {w}")
        print("   → Move latest year to top in chief persona.md")
    else:
        print("✅ Normal (or chief persona.md not found)")

    print()


def main():
    parser = argparse.ArgumentParser(description='§18.3 Graph RAG 최신성 점검')
    parser.add_argument('active_dir', help='active/ folder path')
    parser.add_argument('--days', type=int, default=30,
                        help='점검 기준 일수 (①② 신규 판정, ③ 허브 갱신 기준, 기본: 30)')
    parser.add_argument('--fix', action='store_true',
                        help='① outdated 파일을 .archive/ 로 자동 이동')
    parser.add_argument('--archive', default=None,
                        help='--fix 시 이동할 archive 폴더 (기본: active_dir/../.archive)')
    args = parser.parse_args()

    active_dir = Path(args.active_dir)
    if not active_dir.is_dir():
        print(f"Error: {active_dir} folder not found.")
        sys.exit(1)

    archive_dir = Path(args.archive) if args.archive else None
    check_outdated(active_dir, days=args.days, fix=args.fix, archive_dir=archive_dir)


if __name__ == '__main__':
    main()
