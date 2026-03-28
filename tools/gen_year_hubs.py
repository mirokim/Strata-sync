#!/usr/bin/env python3
"""
gen_year_hubs.py — §11.3.2 연도별 허브 파일 자동 생성 (v3.7 --top N 옵션 포함)

기능:
  1. chief 태그 파일에서 날짜 추출 → 연도별 그룹핑
  2. 연도별 허브 파일(회의록_YYYY.md) 생성 / 갱신
     - 최신 연도 허브: ## 최근 추가 (최신 N개) 섹션 상단 배치
  3. chief persona.md 생성 / 갱신 (최상위 허브)
  4. 각 chief 파일 하단에 역방향 링크 주입

사용법:
  python gen_year_hubs.py <active_dir> [--top 5]
"""

import re
import sys
import argparse
from pathlib import Path
from collections import defaultdict
from datetime import datetime, date


def read_fm(content: str) -> dict:
    m = re.match(r'^---\s*\n(.*?)\n---', content, re.DOTALL)
    if not m:
        return {}
    fields = {}
    for line in m.group(1).split('\n'):
        if ':' in line:
            k, _, v = line.partition(':')
            fields[k.strip()] = v.strip()
    return fields


def get_stem(filename: str) -> str:
    """파일명에서 확장자 제거."""
    return Path(filename).stem


def collect_chief_files(active_dir: Path) -> list[tuple[str, str, Path]]:
    """
    chief 태그를 가진 파일 수집.
    반환: [(date_str, stem, path), ...]  날짜순 정렬
    """
    chief_files = []
    chief_keywords = ['이사장', '피드백', '정례보고', '정례 보고', '회장님']

    for md in sorted(active_dir.glob('*.md')):
        try:
            content = md.read_text(encoding='utf-8', errors='replace')
        except:
            continue
        # chief 태그 확인
        has_chief = ('chief' in content[:600]) or any(kw in md.name for kw in chief_keywords)
        if not has_chief:
            continue
        # date 추출
        m = re.search(r'date:\s*(\d{4}-\d{2}-\d{2})', content[:400])
        date_str = m.group(1) if m else '2000-01-01'
        chief_files.append((date_str, md.stem, md))

    chief_files.sort(key=lambda x: x[0])
    return chief_files


def inject_backlink(md_path: Path, year: str):
    """
    개별 chief 파일 하단에 역방향 링크 주입.
    이미 있으면 스킵.
    """
    hub_stem = f"회의록_{year}"
    persona_stem = "chief persona"

    content = md_path.read_text(encoding='utf-8', errors='replace')
    backlink_marker = f"[[{hub_stem}]]"

    if backlink_marker in content:
        return  # 이미 있음

    backlink = f"\n\n> 상위 허브: [[{hub_stem}]] · [[{persona_stem}]]\n"

    # ## 관련 문서 섹션 이후에 추가, 없으면 파일 끝에 추가
    if '## 관련 문서' in content:
        # 기존 섹션 뒤에 추가
        content = content.rstrip() + backlink
    else:
        content = content.rstrip() + '\n\n## 관련 문서\n' + backlink

    md_path.write_text(content, encoding='utf-8')


def generate_year_hub(active_dir: Path, year: str, files: list[tuple],
                      top_n: int = 5, is_latest: bool = False) -> Path:
    """
    연도 허브 파일 생성/갱신.
    files: [(date_str, stem, path), ...] — 날짜순 정렬 (오래된 것 먼저)
    """
    hub_stem = f"회의록_{year}"
    hub_path = active_dir / f"{hub_stem}.md"

    # 최신순 정렬 (최근 것이 위)
    sorted_files = sorted(files, key=lambda x: x[0], reverse=True)
    total = len(sorted_files)

    lines = [
        f"---",
        f"title: \"{year}년 이사장 피드백 허브\"",
        f"date: {sorted_files[0][0] if sorted_files else year+'-01-01'}",
        f"type: meeting",
        f"status: active",
        f"tags: [chief, meeting, hub]",
        f"origin: generated",
        f"---",
        f"",
        f"# {year}년 이사장 피드백 / 정례보고",
        f"",
        f"> 이 문서는 {year}년 이사장 피드백 및 정례보고 허브입니다.",
        f"> 상위 허브: [[chief persona]]",
        f"",
    ]

    # 최신 연도는 상단에 "최근 추가" 섹션 배치 (§18.2 [2단계])
    if is_latest and top_n > 0:
        recent = sorted_files[:top_n]
        lines += [
            f"## 최근 추가 (최신 {min(top_n, len(recent))}개) ← BFS 우선 탐색",
            f"",
            f"> ⚠️ 최신 피드백이 필요하면 이 섹션을 먼저 볼 것.",
            f"",
        ]
        for d, stem, _ in recent:
            lines.append(f"- [[{stem}]] ({d})")
        lines += ["", "---", ""]

    lines += [
        f"## 전체 목록 ({total}개 · 최신순)",
        f"",
    ]
    for d, stem, _ in sorted_files:
        lines.append(f"- [[{stem}]] ({d})")

    content = '\n'.join(lines) + '\n'
    hub_path.write_text(content, encoding='utf-8')
    return hub_path


def generate_chief_persona(active_dir: Path, year_hubs: list[str],
                           latest_year: str, latest_files: list[tuple],
                           top_n: int = 3):
    """chief persona.md 생성/갱신 (최상위 허브)."""
    persona_path = active_dir / "chief persona.md"

    sorted_years = sorted(year_hubs, reverse=True)  # 최신 연도 먼저

    # 최신 피드백 파일
    recent = sorted(latest_files, key=lambda x: x[0], reverse=True)[:top_n]

    lines = [
        "---",
        "title: \"이사장 페르소나 (최상위 허브)\"",
        f"date: {datetime.now().strftime('%Y-%m-%d')}",
        "type: reference",
        "status: active",
        "tags: [chief, hub, persona]",
        "origin: generated",
        "---",
        "",
        "# 이사장 페르소나",
        "",
        "> 이사장님의 피드백 및 정례보고 전체를 관리하는 최상위 허브 문서.",
        "",
        "## 최근 피드백 (현재 기준 — 우선 참조)",
        "",
        "> ⚠️ 가장 최근 이사장 피드백은 아래 링크를 먼저 확인할 것.",
        "",
    ]
    for d, stem, _ in recent:
        lines.append(f"- [[{stem}]] ({d})")

    if latest_year:
        lines.append(f"- [[회의록_{latest_year}]] — **현재 연도 (최신 {min(top_n, len(latest_files))}개 문서)**")

    lines += [
        "",
        "## 연도별 피드백 아카이브",
        "",
        "> 이전 연도 데이터는 참고용. 현재 기준 정보는 위 섹션 우선.",
        "",
    ]
    for yr in sorted_years:
        lines.append(f"- [[회의록_{yr}]] — {yr}년 전체")

    lines += ["", "## 관련 문서", "", "- [[currentSituation]]", "- [[_index]]", ""]

    content = '\n'.join(lines) + '\n'
    persona_path.write_text(content, encoding='utf-8')
    return persona_path


def main():
    parser = argparse.ArgumentParser(description='연도별 허브 파일 자동 생성 (§11.3.2)')
    parser.add_argument('active_dir', help='active/ 폴더')
    parser.add_argument('--top', type=int, default=5, help='최신 연도 허브 상단 노출 수 (기본: 5)')
    args = parser.parse_args()

    active_dir = Path(args.active_dir)

    print("chief 파일 수집 중...")
    chief_files = collect_chief_files(active_dir)
    print(f"  chief 파일: {len(chief_files)}개")

    if not chief_files:
        print("chief 파일이 없습니다.")
        return

    # 연도별 그룹핑
    by_year = defaultdict(list)
    for date_str, stem, path in chief_files:
        year = date_str[:4]
        by_year[year].append((date_str, stem, path))

    years = sorted(by_year.keys())
    latest_year = years[-1] if years else ''
    print(f"  연도: {', '.join(years)}")

    # 연도별 허브 생성
    print("\n연도별 허브 생성 중...")
    year_hub_paths = []
    for year in years:
        is_latest = (year == latest_year)
        hub_path = generate_year_hub(
            active_dir, year, by_year[year],
            top_n=args.top if is_latest else 0,
            is_latest=is_latest
        )
        year_hub_paths.append(hub_path.stem)
        print(f"  ✓ {hub_path.name} ({len(by_year[year])}개 파일)")

    # 역방향 링크 주입
    print("\n역방향 링크 주입 중...")
    injected = 0
    for year in years:
        for date_str, stem, path in by_year[year]:
            inject_backlink(path, year)
            injected += 1
    print(f"  ✓ {injected}개 파일에 역링크 추가")

    # chief persona 생성
    print("\nchief persona.md 생성 중...")
    persona_path = generate_chief_persona(
        active_dir, year_hub_paths, latest_year,
        by_year.get(latest_year, []),
        top_n=args.top
    )
    print(f"  ✓ {persona_path.name}")

    print(f"\n=== §11 연도별 허브 생성 완료 ===")
    print(f"  연도 허브: {len(year_hub_paths)}개")
    print(f"  역방향 링크: {injected}개")
    print(f"  chief persona: {persona_path}")


if __name__ == '__main__':
    main()
