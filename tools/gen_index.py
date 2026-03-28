#!/usr/bin/env python3
"""
gen_index.py — §14.2 _index.md + §14.1 currentSituation.md auto-generation

- _index.md: 전체 active 파일 날짜 역순, 월별 그룹핑
             상단에 "최근 30일" 섹션 (§18 [4단계])
- currentSituation.md: 프로젝트 현황 + 최근 30일 섹션 (§18 [1단계])

Usage:
  python gen_index.py <active_dir> [--days 30]
"""

import re
import sys
import argparse
from pathlib import Path
from datetime import datetime, date, timedelta
from collections import defaultdict


def parse_frontmatter(content: str) -> dict:
    m = re.match(r'^---\s*\n(.*?)\n---', content, re.DOTALL)
    if not m:
        return {}
    fields = {}
    for line in m.group(1).split('\n'):
        if ':' in line:
            k, _, v = line.partition(':')
            fields[k.strip()] = v.strip().strip('"\'')
    return fields


def collect_files_info(active_dir: Path) -> list[dict]:
    """active 파일 정보 수집 (날짜 역순 정렬)."""
    files_info = []
    for md in active_dir.glob('*.md'):
        # Exclude system files
        if md.stem in ('_index', 'currentSituation', 'chief persona') or \
           md.stem.startswith('회의록_'):
            continue
        try:
            content = md.read_text(encoding='utf-8', errors='replace')[:600]
        except:
            continue
        fields = parse_frontmatter(content)
        date_str = fields.get('date', '2000-01-01')
        title = fields.get('title', md.stem)
        doc_type = fields.get('type', 'spec')
        tags_raw = fields.get('tags', '[]')
        tags = [t.strip() for t in re.findall(r'[\w가-힣]+', tags_raw)]

        files_info.append({
            'stem': md.stem,
            'title': title,
            'date': date_str,
            'type': doc_type,
            'tags': tags,
            'is_chief': 'chief' in tags,
        })

    files_info.sort(key=lambda x: x['date'], reverse=True)
    return files_info


def gen_index_md(active_dir: Path, files_info: list[dict], days: int = 30) -> Path:
    """_index.md 생성."""
    today = date.today()
    cutoff = (today - timedelta(days=days)).strftime('%Y-%m-%d')
    today_str = today.strftime('%Y-%m-%d')

    # Classify files from last N days
    recent_chief = [f for f in files_info if f['is_chief'] and f['date'] >= cutoff]
    recent_spec  = [f for f in files_info if not f['is_chief'] and f['date'] >= cutoff
                    and f['type'] in ('spec', 'guide', 'decision')]
    recent_all   = [f for f in files_info if f['date'] >= cutoff]

    lines = [
        "---",
        "title: \"전체 문서 인덱스\"",
        f"date: {today_str}",
        "type: reference",
        "status: active",
        "tags: [index, hub]",
        "origin: generated",
        "---",
        "",
        "# 전체 문서 인덱스",
        "",
        f"## 최근 {days}일 ({cutoff} ~ {today_str}) ← 현재 기준",
        "",
        "> ⚠️ 최신 데이터가 필요하면 이 섹션을 먼저 볼 것.",
        "",
    ]

    if recent_chief:
        lines.append(f"### 이사장 피드백 / 정례보고 (최근 {len(recent_chief)}건)")
        lines.append("")
        for f in recent_chief[:10]:
            lines.append(f"- 📝 [[{f['stem']}]] ({f['date']}) ← **최신 피드백**")
        lines.append("")

    if recent_spec:
        lines.append(f"### 최근 스펙 / 의사결정 (최근 {len(recent_spec)}건)")
        lines.append("")
        for f in recent_spec[:10]:
            lines.append(f"- 📐 [[{f['stem']}]] ({f['date']})")
        lines.append("")

    lines += ["---", "", "## 전체 인덱스 (월별 그룹 · 날짜 역순)", ""]

    # Group by month
    by_month = defaultdict(list)
    for f in files_info:
        month = f['date'][:7]  # YYYY-MM
        by_month[month].append(f)

    for month in sorted(by_month.keys(), reverse=True):
        lines.append(f"### {month}")
        lines.append("")
        for f in by_month[month]:
            tag_str = f" `{', '.join(f['tags'][:2])}`" if f['tags'] else ''
            icon = '📝' if f['is_chief'] else ('📐' if f['type'] == 'spec' else '📄')
            lines.append(f"- {icon} [[{f['stem']}]] ({f['date']}){tag_str}")
        lines.append("")

    content = '\n'.join(lines) + '\n'
    out_path = active_dir / '_index.md'
    out_path.write_text(content, encoding='utf-8')
    return out_path


def gen_current_situation(active_dir: Path, files_info: list[dict], days: int = 30) -> Path:
    """currentSituation.md 생성."""
    today = date.today()
    today_str = today.strftime('%Y-%m-%d')
    cutoff = (today - timedelta(days=days)).strftime('%Y-%m-%d')

    recent_chief = [f for f in files_info if f['is_chief'] and f['date'] >= cutoff][:8]
    recent_spec  = [f for f in files_info if not f['is_chief'] and f['type'] in ('spec', 'decision')
                    and f['date'] >= cutoff][:8]

    # Statistics by type
    type_count = defaultdict(int)
    for f in files_info:
        type_count[f['type']] += 1

    lines = [
        "---",
        "title: \"현재 상황 (Current Situation)\"",
        f"date: {today_str}",
        "type: reference",
        "status: active",
        "tags: [context, hub, current]",
        "origin: generated",
        "---",
        "",
        "# 현재 상황 (Current Situation)",
        "",
        f"> ⚠️ **이 문서를 먼저 읽을 것. 최신 정보는 항상 아래 \"최근 {days}일\" 섹션에 있다.**",
        "",
        f"## 최근 {days}일 문서 ({cutoff} ~ {today_str}) ← 현재 기준",
        "",
    ]

    if recent_chief:
        lines.append(f"### 이사장 피드백 / 정례보고 (최신)")
        lines.append("")
        for f in recent_chief:
            lines.append(f"- 📝 [[{f['stem']}]] ({f['date']}) ← **최신 피드백**")
        lines.append("")

    if recent_spec:
        lines.append("### 최근 스펙 / 작업")
        lines.append("")
        for f in recent_spec:
            lines.append(f"- 📐 [[{f['stem']}]] ({f['date']})")
        lines.append("")

    lines += [
        "---",
        "",
        "## 프로젝트 개요",
        "",
        "> 프로젝트A (Project A) 게임 개발 지식 베이스.",
        "> Confluence 위키에서 추출한 문서 기반 Graph RAG 시스템.",
        "",
        "## 문서 현황",
        "",
        f"| 항목 | 수치 |",
        f"|------|------|",
        f"| 전체 active 문서 | {len(files_info)}개 |",
    ]
    for t, n in sorted(type_count.items(), key=lambda x: -x[1]):
        lines.append(f"| {t} | {n}개 |")

    lines += [
        "",
        "## 주요 허브 문서",
        "",
        "- [[chief persona]] — 이사장 피드백 최상위 허브",
        "- [[회의록_2026]] — 2026년 피드백 허브 (최신)",
        "- [[회의록_2025]] — 2025년 피드백 허브",
        "- [[_index]] — 전체 문서 인덱스",
        "",
        "## 관련 문서",
        "",
        "- [[_index]]",
        "- [[chief persona]]",
        "",
    ]

    content = '\n'.join(lines) + '\n'
    out_path = active_dir.parent / 'currentSituation.md'
    out_path.write_text(content, encoding='utf-8')
    # active 폴더에도 복사 (BFS 탐색용)
    (active_dir / 'currentSituation.md').write_text(content, encoding='utf-8')
    return out_path


def main():
    parser = argparse.ArgumentParser(description='_index.md + currentSituation.md 생성 (§14)')
    parser.add_argument('active_dir', help='active/ folder')
    parser.add_argument('--days', type=int, default=30, help='최근 N일 (기본: 30)')
    args = parser.parse_args()

    active_dir = Path(args.active_dir)

    print("Collecting file info...")
    files_info = collect_files_info(active_dir)
    print(f"  총 {len(files_info)} files")

    print("\n_index.md 생성 중...")
    idx_path = gen_index_md(active_dir, files_info, args.days)
    print(f"  ✓ {idx_path}")

    print("\ncurrentSituation.md 생성 중...")
    cs_path = gen_current_situation(active_dir, files_info, args.days)
    print(f"  ✓ {cs_path}")

    print(f"\n=== §14 보조 문서 생성 Complete ===")


if __name__ == '__main__':
    main()
