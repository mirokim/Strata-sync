#!/usr/bin/env python3
"""
pipeline.py — Graph RAG 데이터 정제 매뉴얼 v3.8 통합 파이프라인
단계 2: 원본 파일 → MD 변환 (§4.0 공통 원칙 준수)

실행 순서:
  1. HTML → MD  (refine_html_to_md.py §4.1)
  2. PPTX → MD  (pptx_to_md.py §4.3)  — _files 폴더 첨부파일
  3. DOCX → MD  (docx_to_md.py §4.5)  — _files 폴더 첨부파일

사용법:
  python pipeline.py \
      --html-dirs <dir1> [<dir2> ...] \
      --vault <refined_vault_path> \
      [--workers N] \
      [--step html|pptx|docx|all]
"""

import sys
import argparse
import subprocess
from pathlib import Path
import time


SCRIPT_DIR = Path(__file__).parent


def run_step(label: str, cmd: list, cwd: Path = None) -> bool:
    """서브프로세스 실행. 성공 여부 반환."""
    print(f"\n{'='*60}")
    print(f"[{label}] {' '.join(str(c) for c in cmd)}")
    print('='*60)
    t0 = time.time()
    result = subprocess.run(cmd, cwd=cwd)
    elapsed = time.time() - t0
    ok = result.returncode == 0
    status = "완료" if ok else f"오류(코드 {result.returncode})"
    print(f"\n→ {label} {status} ({elapsed:.1f}초)")
    return ok


def collect_pptx_docx_dirs(html_dirs: list[Path]) -> tuple[list[Path], list[Path]]:
    """
    html_dirs 아래의 _files 폴더에서 PPTX/DOCX 파일 경로를 수집.
    반환: (pptx_paths, docx_paths)
    """
    pptx_paths = []
    docx_paths = []
    for html_dir in html_dirs:
        if not html_dir.exists():
            continue
        for files_dir in html_dir.glob('*_files'):
            if not files_dir.is_dir():
                continue
            pptx_paths.extend(sorted(files_dir.glob('*.pptx')))
            docx_paths.extend(sorted(files_dir.glob('*.docx')))
    return pptx_paths, docx_paths


def write_file_list(paths: list[Path], out_path: Path):
    """파일 경로 목록을 텍스트 파일로 저장."""
    with open(out_path, 'w', encoding='utf-8') as f:
        for p in paths:
            f.write(str(p) + '\n')


def main():
    parser = argparse.ArgumentParser(description='Graph RAG 데이터 정제 통합 파이프라인 (§4)')
    parser.add_argument('--html-dirs', nargs='+', required=True,
                        help='HTML 파일이 있는 폴더(들). 예: downloaded_pages downloaded_pages2')
    parser.add_argument('--vault', default='refined_vault',
                        help='출력 vault 루트 폴더 (기본: refined_vault)')
    parser.add_argument('--workers', type=int, default=None,
                        help='HTML 변환 병렬 워커 수 (기본: CPU 수)')
    parser.add_argument('--step', choices=['html', 'pptx', 'docx', 'all'], default='all',
                        help='실행할 단계 (기본: all)')
    args = parser.parse_args()

    vault = Path(args.vault).resolve()
    active_dir = vault / 'active'
    attachments_dir = vault / 'attachments'
    archive_dir = vault / '.archive'

    for d in [active_dir, attachments_dir, archive_dir]:
        d.mkdir(parents=True, exist_ok=True)

    html_dirs = [Path(d).resolve() for d in args.html_dirs]

    print(f"\nGraph RAG 데이터 정제 파이프라인 v3.8")
    print(f"  HTML 소스: {[str(d) for d in html_dirs]}")
    print(f"  출력 vault: {vault}")
    print(f"  실행 단계: {args.step}")

    t_total = time.time()
    success = True

    # ── 단계 1: HTML → MD ─────────────────────────────────────────────────
    if args.step in ('html', 'all'):
        cmd = [
            sys.executable,
            str(SCRIPT_DIR / 'refine_html_to_md.py'),
        ] + [str(d) for d in html_dirs] + [
            '--active', str(active_dir),
            '--attachments', str(attachments_dir),
        ]
        if args.workers:
            cmd += ['--workers', str(args.workers)]

        ok = run_step('HTML → MD', cmd)
        success = success and ok

    # ── 단계 2: PPTX → MD (_files 폴더 첨부파일) ─────────────────────────
    if args.step in ('pptx', 'all'):
        pptx_paths, _ = collect_pptx_docx_dirs(html_dirs)
        if pptx_paths:
            print(f"\n[PPTX] _files 폴더에서 {len(pptx_paths)}개 PPTX 발견")
            # 경로 목록 임시 파일로 저장
            list_file = vault / '.pptx_list.txt'
            write_file_list(pptx_paths, list_file)

            cmd = [
                sys.executable,
                str(SCRIPT_DIR / 'pptx_to_md.py'),
            ] + [str(p) for p in pptx_paths] + [
                '--active', str(active_dir),
                '--attachments', str(attachments_dir),
            ]
            ok = run_step('PPTX → MD', cmd)
            success = success and ok
        else:
            print("\n[PPTX] _files 폴더에 PPTX 없음 — 건너뜀")

    # ── 단계 3: DOCX → MD (_files 폴더 첨부파일) ─────────────────────────
    if args.step in ('docx', 'all'):
        _, docx_paths = collect_pptx_docx_dirs(html_dirs)
        if docx_paths:
            print(f"\n[DOCX] _files 폴더에서 {len(docx_paths)}개 DOCX 발견")
            cmd = [
                sys.executable,
                str(SCRIPT_DIR / 'docx_to_md.py'),
            ] + [str(p) for p in docx_paths] + [
                '--active', str(active_dir),
                '--attachments', str(attachments_dir),
            ]
            ok = run_step('DOCX → MD', cmd)
            success = success and ok
        else:
            print("\n[DOCX] _files 폴더에 DOCX 없음 — 건너뜀")

    # ── 최종 집계 ─────────────────────────────────────────────────────────
    elapsed = time.time() - t_total
    active_count = len(list(active_dir.glob('*.md')))
    archive_count = len(list(archive_dir.glob('*.md')))
    att_count = len(list(attachments_dir.iterdir())) if attachments_dir.exists() else 0

    print(f"\n{'='*60}")
    print(f"파이프라인 {'완료' if success else '완료(일부 오류)'} ({elapsed:.1f}초)")
    print(f"  active/    : {active_count}개 MD 파일")
    print(f"  .archive/  : {archive_count}개 MD 파일 (스텁)")
    print(f"  attachments: {att_count}개 첨부파일")
    print(f"  vault 경로 : {vault}")
    print('='*60)

    if not success:
        sys.exit(1)


if __name__ == '__main__':
    main()
