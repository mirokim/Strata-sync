"""
품질 체크 스크립트 (check_quality.py)  v2.0
────────────────────────────────────────────────────────
기능:
  active/ 폴더의 모든 마크다운 파일에 대해 품질 지표를 측정하고
  콘솔에 보고서를 출력한다.

사용법:
    python check_quality.py <vault_active_dir> [--vault <vault_root>]

측정 항목:
  ① 링크 없는 파일 비율
  ② Frontmatter 누락 파일
  ③ Frontmatter 필수 필드 누락 (date/type/status/tags)
  ④ 헤딩(##) 보유 비율
  ⑤ 300자 미만 초소형 파일
  ⑥ 중첩 wikilink (stem 안에 [[) — inject_keywords 버그 산물
  ⑦ 삼중 이상 대괄호 [[[  (날짜형 제외)
  ⑧ 존재하지 않는 파일 링크 (broken wikilink)
  ⑨ 동일 링크 과다 반복 (5회+)
  ⑩ 문서 크기 분포

의존 패키지:
    pip install PyYAML
"""

import os
import re
import sys
import yaml
from collections import Counter, defaultdict


# ── 유틸 ──────────────────────────────────────────────────────────────────────

def split_fm(text: str) -> tuple[dict, str]:
    """(frontmatter_dict, body) 반환"""
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            try:
                fm = yaml.safe_load(text[3:end]) or {}
            except Exception:
                fm = {}
            return fm, text[end + 4:]
    return {}, text


WIKILINK    = re.compile(r'\[\[(.*?)\]\]', re.DOTALL)
TRIPLE_PAT  = re.compile(r'\[{4,}')   # 4중 이상만 (3중은 [[+[범주]stem 유효 패턴)
NESTED_PAT  = re.compile(r'\[\[[^\[\]]*\[\[[^\[\]]*\]\][^\[\]]*\]\]')


# ── 메인 ──────────────────────────────────────────────────────────────────────

def run(active_dir: str, vault_root: str | None = None) -> None:
    md_files = [f for f in os.listdir(active_dir) if f.endswith(".md")]
    total = len(md_files)

    # 전체 vault의 유효 stem 집합 (broken link 검사용)
    all_stems: set[str] = set()
    search_root = vault_root or active_dir
    for root, dirs, files in os.walk(search_root):
        dirs[:] = [d for d in dirs if not d.startswith('.')]
        for f in files:
            if f.endswith(".md"):
                all_stems.add(f[:-3])

    print(f"\n{'='*60}")
    print(f" Graph RAG 품질 보고서  v2.0")
    print(f" 대상: {active_dir}")
    print(f" 파일 수: {total}개  |  vault stem 수: {len(all_stems)}개")
    print(f"{'='*60}\n")

    no_link:       list[str] = []
    no_fm:         list[str] = []
    fm_missing_f:  list[tuple[str,str]] = []
    no_heading:    list[str] = []
    tiny:          list[str] = []
    nested_links:  list[tuple[str,str]] = []
    triple_brack:  list[tuple[str,int]] = []
    broken_wl:     list[tuple[str,list]] = []
    excess_links:  list[tuple[str,str]] = []
    size_map = Counter()

    for fname in md_files:
        path = os.path.join(active_dir, fname)
        try:
            with open(path, encoding="utf-8") as f:
                text = f.read()
        except Exception:
            continue
        stem = fname[:-3]
        fm, body = split_fm(text)

        # ① 링크 없음
        if not WIKILINK.search(body):
            no_link.append(stem)

        # ② Frontmatter 없음
        if not text.startswith("---"):
            no_fm.append(stem)
        else:
            # ③ 필수 필드
            for field in ("date", "type", "status", "tags"):
                if field not in fm:
                    fm_missing_f.append((stem, field))

        # ④ 헤딩
        if not re.search(r"^##\s", text, re.MULTILINE):
            no_heading.append(stem)

        # ⑤ 초소형
        if len(body) < 300:
            tiny.append(stem)

        # ⑥ 중첩 wikilink
        for m in NESTED_PAT.finditer(body):
            nested_links.append((stem, m.group()[:80]))

        # ⑦ 삼중 대괄호 (날짜형 제외)
        cnt = len(TRIPLE_PAT.findall(text))
        if cnt:
            triple_brack.append((stem, cnt))

        # ⑧ broken wikilink
        broken = []
        for m in WIKILINK.finditer(body):
            content = m.group(1)
            if "[[" in content:
                continue
            s = content.split("|")[0].strip()
            if s and s not in all_stems:
                # 이미지 확장자 제외
                if not re.search(r'\.(png|jpg|gif|webp|jpeg|svg)$', s, re.I):
                    broken.append(s)
        if broken:
            broken_wl.append((stem, list(dict.fromkeys(broken))[:3]))

        # ⑨ 동일 링크 과다 반복
        link_counter: dict[str, int] = defaultdict(int)
        for m in WIKILINK.finditer(body):
            s = m.group(1).split("|")[0].strip()
            link_counter[s] += 1
        for s, cnt in link_counter.items():
            if cnt >= 5:
                excess_links.append((stem, f"[[{s[:45]}]] × {cnt}회"))

        # ⑩ 크기
        size_map[len(body) // 500] += 1

    def pct(n: int) -> str:
        return f"{n}/{total} ({n/total*100:.1f}%)"

    def show(label: str, items: list, key_fmt=None, warn_if_any=True) -> None:
        status = "WARN" if (items and warn_if_any) else "PASS"
        print(f"[{status}] {label}: {pct(len(items))}")
        for item in items[:5]:
            if key_fmt:
                print(f"       - {key_fmt(item)}")
            else:
                print(f"       - {item}")
        if len(items) > 5:
            print(f"       ... 외 {len(items)-5}개")
        print()

    show("① 링크 없는 파일", no_link)
    show("② Frontmatter 완전 누락", no_fm)
    show("③ Frontmatter 필수 필드 누락", fm_missing_f,
         key_fmt=lambda x: f"{x[0][:50]}  ← '{x[1]}' 없음")
    print(f"[{'PASS' if len(no_heading)/total < 0.01 else 'WARN'}] "
          f"④ 헤딩(##) 없는 파일: {pct(len(no_heading))}\n")
    show("⑤ 300자 미만 초소형 파일", tiny, warn_if_any=False)
    show("⑥ 중첩 wikilink (inject 버그 산물)", nested_links,
         key_fmt=lambda x: f"{x[0][:40]}: {x[1]}")
    show("⑦ 삼중 이상 대괄호 (비날짜형)", triple_brack,
         key_fmt=lambda x: f"{x[0][:55]}: {x[1]}개")
    show("⑧ 존재하지 않는 파일 링크", broken_wl,
         key_fmt=lambda x: f"{x[0][:40]}: {', '.join(x[1])}")
    show("⑨ 동일 링크 과다 반복 (5회+)", excess_links,
         key_fmt=lambda x: f"{x[0][:40]}: {x[1]}", warn_if_any=False)

    print("[INFO] ⑩ 문서 크기 분포:")
    for k in sorted(size_map.keys()):
        bar = "█" * min(size_map[k], 50)
        print(f"       {k*500:>6}~{(k+1)*500}자: {bar} {size_map[k]}개")

    print(f"\n{'='*60}")
    total_issues = (len(no_link) + len(no_fm) + len(fm_missing_f)
                    + len(nested_links) + len(broken_wl))
    print(f" 수정 권장 이슈: {total_issues}건  "
          f"(audit_and_fix.py 로 자동 수정 가능)")
    print(f"{'='*60}\n")


def resolve_active_dir(vault_dir: str) -> str:
    """vault root 또는 active/ 서브폴더 중 실제 md 파일이 있는 쪽 반환."""
    active = os.path.join(vault_dir, 'active')
    if os.path.isdir(active):
        return active
    return vault_dir


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    vault = sys.argv[3] if len(sys.argv) >= 4 and sys.argv[2] == "--vault" else None
    active_dir = resolve_active_dir(sys.argv[1])
    run(active_dir, vault or sys.argv[1])
