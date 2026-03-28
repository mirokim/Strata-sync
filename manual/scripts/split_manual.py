#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
split_manual.py — 정제 매뉴얼을 섹션별 파일로 분할
출력: manual/sections/ 디렉터리
"""

import os
import re
from pathlib import Path

SRC = Path(__file__).parent.parent / "Graph RAG 데이터 정제 매뉴얼 v3.23.md"
OUT = Path(__file__).parent.parent / "sections"
OUT.mkdir(exist_ok=True)

# 섹션 경계: (시작 라인 0-indexed, 파일명, 제목)
# 라인 번호는 grep 결과 기준 (1-indexed) → 0-indexed로 변환
SECTIONS = [
    (0,    "s01_overview.md",      "§1-2 개요 · 파이프라인 전체 흐름"),
    (133,  "s02_triage.md",        "§3 데이터 분류 기준 (삭제·격리·수정·보강)"),
    (254,  "s03_conversion.md",    "§4 원본 파일 → Markdown 변환 (HTML·PDF·PPTX·XLSX·DOCX·TXT)"),
    (623,  "s04_structure.md",     "§5-6 대용량 분할 · 프론트매터 통일"),
    (769,  "s05_links.md",         "§7-9 Wiki 링크 강화 · 키워드 링크 주입"),
    (977,  "s06_optimization.md",  "§10-11 섹션 헤딩 · BFS · PageRank 최적화"),
    (1082, "s07_quality.md",       "§12-16 이미지·품질 감사·보조 문서·Obsidian·체크리스트"),
    (1356, "s08_operations.md",    "§17 운영 가이드 (신규 문서·정기 정제·스크립트·롤백)"),
    (1500, "s09_troubleshoot.md",  "§18-끝 버그 대응 · AI 컨텍스트 한계 · 매뉴얼 관리 · 변경이력"),
]

lines = SRC.read_text(encoding="utf-8").splitlines(keepends=True)
total = len(lines)

index_rows = []

for i, (start, fname, title) in enumerate(SECTIONS):
    end = SECTIONS[i + 1][0] if i + 1 < len(SECTIONS) else total
    chunk = lines[start:end]
    out_path = OUT / fname
    out_path.write_text("".join(chunk), encoding="utf-8")
    size_kb = out_path.stat().st_size // 1024
    line_count = end - start
    print(f"  {fname}: {line_count}줄 ({size_kb}KB)")
    index_rows.append((fname, title, line_count, size_kb))

# 라우팅 인덱스 생성
INDEX = OUT / "00_index.md"
rows_md = "\n".join(
    f"| [{r[0]}]({r[0]}) | {r[1]} | {r[2]}줄 / {r[3]}KB |"
    for r in index_rows
)
INDEX.write_text(f"""\
# 정제 매뉴얼 섹션 인덱스

> 전체 매뉴얼 대신 아래 섹션 파일만 읽어 토큰을 절약한다.

## 작업별 참조 파일

| 작업 | 읽을 파일 |
|------|-----------|
| Confluence → MD 변환 | **s03_conversion.md** |
| 문서 삭제·격리·보강 판단 | s02_triage.md |
| 대용량 분할·프론트매터 | s04_structure.md |
| 링크 주입·키워드 매핑 | s05_links.md |
| BFS·PageRank 최적화 | s06_optimization.md |
| 품질 감사·자동 수정 | s07_quality.md |
| 운영·스크립트·롤백 | s08_operations.md |
| 버그 대응·변경이력 | s09_troubleshoot.md |
| 전체 개요·파이프라인 흐름 | s01_overview.md |

## 섹션 파일 목록

| 파일 | 내용 | 크기 |
|------|------|------|
{rows_md}
""", encoding="utf-8")

print(f"\n인덱스: {INDEX}")
print("완료.")
