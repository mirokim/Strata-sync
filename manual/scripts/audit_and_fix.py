"""
통합 감사·수정 스크립트 (audit_and_fix.py)  v1.0
────────────────────────────────────────────────────────
기능:
  active/ 폴더의 모든 마크다운 파일에 대해 품질 이슈를 탐지하고
  대부분을 자동으로 수정한다. check_quality.py + fix_all.py 를 하나로 통합.

  ▶ --audit-only 옵션: 수정 없이 보고서만 출력
  ▶ --fix-only  옵션: 보고서 없이 수정만 실행

감지·수정 항목:
  ① 중첩 wikilink  [[stem|[[inner|text]]...]]  → 내부 링크로 교체
  ② 삼중 이상 대괄호 [[[ (날짜형 [YYYY... 제외)  → [[ 로 축소
  ③ 깨진 wikilink (존재하지 않는 파일)            → MANUAL_MAP 또는 slash_map 으로 수정
  ④ 깨진 이미지 링크 ![[image.ext]]              → 삭제
  ⑤ Frontmatter 누락                            → 자동 생성
  ⑥ Frontmatter 필수 필드 누락 (date/type/status/tags)
  ⑦ HTML 잔재 태그 (<div>, <span> 등)            → 삭제
  ⑧ 연속된 빈 줄 3개 이상                        → 빈 줄 2개로 축소

사용법:
    python audit_and_fix.py <vault_active_dir> [--vault <vault_root>]
                             [--audit-only] [--fix-only] [--verbose]

    # 감사만 (기본)
    python audit_and_fix.py ./active/

    # 수정까지 실행
    python audit_and_fix.py ./active/ --vault . --fix

    # vault 루트를 지정해 전체 stem 집합으로 broken link 검사
    python audit_and_fix.py ./active/ --vault .

설정:
  아래 MANUAL_MAP 딕셔너리에 자동 해결 불가한 broken link → 실제 stem 을 등록한다.

의존 패키지:
    pip install PyYAML
"""

import os
import re
import sys
import yaml
import datetime
from collections import Counter, defaultdict

# ── 프로젝트별 수동 설정 ─────────────────────────────────────────────────────
# 자동으로 stem 을 찾지 못하는 broken link → 실제 파일 stem 매핑
# 예: "TLS": "TLS(TimeLineSkill)시스템_588781620"
MANUAL_MAP: dict[str, str] = {
    # "broken_stem": "real_stem",
    # ── Confluence ID 접미사 / 날짜 대괄호 형식 불일치 ──────────────────────
    # 날짜 대괄호 형식 불일치: "2026.01.07 ..." → "[2026.01.07] ..."
    '2026.01.07 프로젝트A 캐릭터팀 이사장님 피드백_652878547': '[2026.01.07] 프로젝트A 캐릭터팀 이사장님 피드백_652878547',
    # 파일명 특수문자 치환: 따옴표 포함 링크 → 언더스코어 치환 파일명
    '"안 배우고 바로 제작하는 TLS 스킬 만들기"': '_안 배우고 바로 제작하는 TLS 스킬 만들기__596273256',
    # ID 접미사 불일치 (short_to_stem 미감지 케이스)
    '정례보고 자료_2025': '정례보고 자료_2025_499298623',
    # 백슬래시 이스케이프 패턴: 마크다운 테이블 내 [[정례보고 자료\_2025]] 형태
    '정례보고 자료\\_2025': '정례보고 자료_2025_499298623',
}

# 날짜 추론 허용: 파일 이름에서 날짜 파싱 (YYYY-MM-DD 또는 [YYYY.MM.DD])
DATE_FROM_FNAME = re.compile(r'[\[\(]?(\d{4})[.\-](\d{2})[.\-](\d{2})[\]\)]?')

# ── 정규식 ────────────────────────────────────────────────────────────────────
WIKILINK      = re.compile(r'\[\[(.*?)\]\]', re.DOTALL)
IMG_LINK      = re.compile(r'!\[\[([^\]]*\.(png|jpg|jpeg|gif|webp|svg|bmp))\]\]', re.I)
TRIPLE_PAT    = re.compile(r'\[{4,}')  # 4중 이상만 체크 (3중은 [[+[범주]stem 유효 패턴)
NESTED_PAT    = re.compile(r'\[\[([^\[\]]*)\[\[([^\[\]]+?)(?:\|([^\[\]]+?))?\]\]([^\[\]]*)\]\]')
HTML_TAG      = re.compile(r'</?(?:div|span|p|br|hr|table|tr|td|th|ul|ol|li|'
                           r'strong|em|b|i|a|img|h[1-6])[^>]*>', re.I)
TRIPLE_BLANK  = re.compile(r'\n{4,}')
LINK_DISPLAY  = re.compile(r'!\[\[([^\]]*)\]\]')  # 깨진 이미지 포함 모든 ![[]]

# ── 유틸 ─────────────────────────────────────────────────────────────────────

def split_fm(text: str) -> tuple[dict, str, str]:
    """(frontmatter_dict, frontmatter_raw, body) 반환"""
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            fm_raw = text[:end + 4]
            try:
                fm = yaml.safe_load(text[3:end]) or {}
            except Exception:
                fm = {}
            return fm, fm_raw, text[end + 4:]
    return {}, "", text


def build_stem_maps(search_root: str) -> tuple[set[str], dict[str, str], dict[str, str]]:
    """
    all_stems      : 전체 vault stem 집합
    slash_map      : "하위경로/stem" → stem  (슬래시 포함 링크 해결용)
    short_to_stem  : "stem_ID_없음" → "전체_stem_with_ID"  (축약 링크 해결용)
    """
    all_stems: set[str] = set()
    slash_map: dict[str, str] = {}
    short_to_stem: dict[str, str] = {}

    for root, dirs, files in os.walk(search_root):
        dirs[:] = [d for d in dirs if not d.startswith('.')]
        for f in files:
            if f.endswith(".md"):
                stem = f[:-3]
                all_stems.add(stem)
                # 슬래시 포함 경로용
                rel = os.path.relpath(os.path.join(root, f), search_root)
                rel_stem = rel.replace("\\", "/")[:-3]
                slash_map[rel_stem] = stem
                # ID 접미사 제거 (trailing _숫자6자리)
                short = re.sub(r'_\d{6,}$', '', stem)
                if short != stem:
                    short_to_stem[short] = stem

    return all_stems, slash_map, short_to_stem


def infer_fm(fname: str) -> dict:
    """파일명에서 Frontmatter 초기값 추정"""
    fm: dict = {}
    # 날짜
    m = DATE_FROM_FNAME.search(fname)
    if m:
        fm["date"] = f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    else:
        fm["date"] = datetime.date.today().isoformat()
    # type
    stem = fname[:-3].lower()
    if any(w in stem for w in ["회의", "meeting", "피드백", "feedback"]):
        fm["type"] = "meeting"
    elif any(w in stem for w in ["spec", "기획", "설계", "design"]):
        fm["type"] = "spec"
    elif any(w in stem for w in ["index", "_index"]):
        fm["type"] = "index"
    else:
        fm["type"] = "reference"
    fm["status"] = "active"
    fm["tags"] = []
    return fm


# ── FIX 함수들 ────────────────────────────────────────────────────────────────

def fix_nested_wikilinks(text: str) -> tuple[str, int]:
    """중첩 wikilink [[outer|[[inner|disp]]rest]] → [[inner]] または [[inner|disp]] に修正"""
    count = 0
    def replacer(m: re.Match) -> str:
        nonlocal count
        # outer_left + [[inner|disp]] + outer_right
        inner_stem    = m.group(2)
        inner_display = m.group(3)
        replacement   = f"[[{inner_stem}|{inner_display}]]" if inner_display else f"[[{inner_stem}]]"
        count += 1
        return replacement

    new_text = NESTED_PAT.sub(replacer, text)
    # 잔여 중첩 패턴 재처리 (최대 3회)
    for _ in range(2):
        newer = NESTED_PAT.sub(replacer, new_text)
        if newer == new_text:
            break
        new_text = newer
    return new_text, count


def fix_triple_brackets(text: str) -> tuple[str, int]:
    """[[[ → [[ (날짜형 제외)"""
    count = [0]
    def replacer(m: re.Match) -> str:
        count[0] += 1
        return "[["
    new_text = TRIPLE_PAT.sub(replacer, text)
    return new_text, count[0]


def fix_broken_wikilinks(body: str,
                         all_stems: set[str],
                         slash_map: dict[str, str],
                         short_to_stem: dict[str, str]) -> tuple[str, int]:
    """깨진 wikilink를 MANUAL_MAP / slash_map / short_to_stem 으로 수정"""
    count = 0

    def replacer(m: re.Match) -> str:
        nonlocal count
        content = m.group(1)
        if "[[" in content:          # 중첩 → 건너뜀
            return m.group(0)
        pipe_idx = content.find("|")
        s    = (content[:pipe_idx] if pipe_idx != -1 else content).strip()
        disp = content[pipe_idx+1:].strip() if pipe_idx != -1 else None

        if not s or s in all_stems:
            return m.group(0)
        # 이미지 확장자는 건너뜀
        if re.search(r'\.(png|jpg|gif|webp|jpeg|svg|bmp)$', s, re.I):
            return m.group(0)

        # MANUAL_MAP
        if s in MANUAL_MAP:
            real = MANUAL_MAP[s]
            count += 1
            return f"[[{real}|{disp}]]" if disp else f"[[{real}]]"

        # slash_map (e.g. "active/파일명" → "파일명")
        for key, val in slash_map.items():
            if key.endswith("/" + s) or key == s:
                count += 1
                return f"[[{val}|{disp}]]" if disp else f"[[{val}]]"

        # short_to_stem (ID 없는 링크)
        if s in short_to_stem:
            real = short_to_stem[s]
            count += 1
            return f"[[{real}|{disp}]]" if disp else f"[[{real}]]"

        return m.group(0)  # 수정 불가

    return WIKILINK.sub(replacer, body), count


def fix_broken_images(text: str, all_stems: set[str], vault_root: str | None = None) -> tuple[str, int]:
    """존재하지 않는 이미지 링크 ![[...]] 삭제.
    vault_root 가 지정된 경우 실제 이미지 파일 존재 여부를 확인 후 삭제."""
    # 실제 이미지 파일명 집합 빌드 (vault 내 모든 이미지)
    actual_images: set[str] = set()
    if vault_root and os.path.isdir(vault_root):
        for root, dirs, files in os.walk(vault_root):
            dirs[:] = [d for d in dirs if not d.startswith('.')]
            for f in files:
                if re.search(r'\.(png|jpg|jpeg|gif|webp|svg|bmp|tiff?)$', f, re.I):
                    actual_images.add(f.lower())

    count = [0]
    def replacer(m: re.Match) -> str:
        s = m.group(1).split("|")[0].strip()
        fname = os.path.basename(s)
        # 파일이 vault에 실제로 존재하면 보존
        if fname.lower() in actual_images:
            return m.group(0)
        count[0] += 1
        return ""
    new_text = IMG_LINK.sub(replacer, text)
    return new_text, count[0]


def fix_html_tags(text: str) -> tuple[str, int]:
    """HTML 잔재 태그 제거"""
    count = [0]
    def replacer(m: re.Match) -> str:
        count[0] += 1
        return ""
    return HTML_TAG.sub(replacer, text), count[0]


def fix_triple_blank(text: str) -> tuple[str, int]:
    """4줄 이상 연속 빈줄 → 2줄로 축소"""
    count = [0]
    def replacer(m: re.Match) -> str:
        count[0] += 1
        return "\n\n"
    return TRIPLE_BLANK.sub(replacer, text), count[0]


def fix_frontmatter(text: str, fname: str) -> tuple[str, bool]:
    """Frontmatter 없으면 자동 생성"""
    if text.startswith("---"):
        return text, False
    fm = infer_fm(fname)
    fm_lines = ["---"]
    for k, v in fm.items():
        if isinstance(v, list):
            fm_lines.append(f"{k}: {v}")
        else:
            fm_lines.append(f"{k}: {v}")
    fm_lines.append("---")
    fm_lines.append("")
    return "\n".join(fm_lines) + text, True


# ── AUDIT 함수 ────────────────────────────────────────────────────────────────

def audit(active_dir: str, all_stems: set[str], verbose: bool = False) -> dict:
    """감사 결과를 dict 로 반환"""
    md_files = sorted(f for f in os.listdir(active_dir) if f.endswith(".md"))
    total = len(md_files)

    issues: dict[str, list] = {
        "nested":        [],   # (stem, snippet)
        "triple":        [],   # (stem, count)
        "broken_link":   [],   # (stem, [link, ...])
        "broken_img":    [],   # stem
        "no_fm":         [],   # stem
        "fm_missing_f":  [],   # (stem, field)
        "html_tags":     [],   # (stem, count)
        "triple_blank":  [],   # stem
        "no_link":       [],   # stem
        "tiny":          [],   # stem
    }

    for fname in md_files:
        path = os.path.join(active_dir, fname)
        with open(path, encoding="utf-8") as f:
            text = f.read()
        stem = fname[:-3]
        fm, _, body = split_fm(text)

        # ① 중첩 wikilink
        for m in NESTED_PAT.finditer(body):
            issues["nested"].append((stem, m.group()[:80]))

        # ② 삼중 대괄호
        cnt = len(TRIPLE_PAT.findall(text))
        if cnt:
            issues["triple"].append((stem, cnt))

        # ③ 깨진 wikilink
        broken = []
        for m in WIKILINK.finditer(body):
            s = m.group(1).split("|")[0].strip()
            if "[[" in s:
                continue
            if s and s not in all_stems:
                if not re.search(r'\.(png|jpg|gif|webp|jpeg|svg|bmp)$', s, re.I):
                    broken.append(s)
        if broken:
            issues["broken_link"].append((stem, list(dict.fromkeys(broken))[:5]))

        # ④ 깨진 이미지
        if IMG_LINK.search(text):
            issues["broken_img"].append(stem)

        # ⑤ Frontmatter 누락
        if not text.startswith("---"):
            issues["no_fm"].append(stem)
        else:
            # ⑥ 필수 필드
            for field in ("date", "type", "status", "tags"):
                if field not in fm:
                    issues["fm_missing_f"].append((stem, field))

        # ⑦ HTML 잔재
        cnt_html = len(HTML_TAG.findall(text))
        if cnt_html:
            issues["html_tags"].append((stem, cnt_html))

        # ⑧ 연속 빈줄
        if TRIPLE_BLANK.search(text):
            issues["triple_blank"].append(stem)

        # ⑨ 링크 없는 파일
        if not WIKILINK.search(body):
            issues["no_link"].append(stem)

        # ⑩ 초소형 파일
        if len(body) < 300:
            issues["tiny"].append(stem)

    return {"total": total, "issues": issues}


def print_report(result: dict, verbose: bool = False) -> None:
    total = result["total"]
    issues = result["issues"]

    def pct(n: int) -> str:
        return f"{n}/{total} ({n/total*100:.1f}%)" if total else "0/0"

    def show(label: str, items: list, key_fmt=None, warn_if_any: bool = True) -> None:
        status = "WARN" if (items and warn_if_any) else ("INFO" if items else "PASS")
        print(f"[{status}] {label}: {pct(len(items))}")
        if verbose:
            for item in items[:10]:
                if key_fmt:
                    print(f"       - {key_fmt(item)}")
                else:
                    print(f"       - {item}")
            if len(items) > 10:
                print(f"       ... 외 {len(items)-10}개")
        else:
            for item in items[:3]:
                if key_fmt:
                    print(f"       - {key_fmt(item)}")
                else:
                    print(f"       - {item}")
            if len(items) > 3:
                print(f"       ... 외 {len(items)-3}개")
        print()

    print(f"\n{'='*60}")
    print(f" 감사 보고서  (대상: {total}개 파일)")
    print(f"{'='*60}\n")

    show("① 중첩 wikilink (inject 버그 산물)",
         issues["nested"], key_fmt=lambda x: f"{x[0][:40]}: {x[1]}")
    show("② 삼중 이상 대괄호 (비날짜형)",
         issues["triple"], key_fmt=lambda x: f"{x[0][:55]}: {x[1]}개")
    show("③ 존재하지 않는 wikilink",
         issues["broken_link"],
         key_fmt=lambda x: f"{x[0][:40]}: {', '.join(x[1])}")
    show("④ 깨진 이미지 링크 (![[]])",
         issues["broken_img"], warn_if_any=True)
    show("⑤ Frontmatter 완전 누락",
         issues["no_fm"])
    show("⑥ Frontmatter 필수 필드 누락",
         issues["fm_missing_f"],
         key_fmt=lambda x: f"{x[0][:50]}  ← '{x[1]}' 없음")
    show("⑦ HTML 잔재 태그",
         issues["html_tags"],
         key_fmt=lambda x: f"{x[0][:55]}: {x[1]}개", warn_if_any=True)
    show("⑧ 과도한 연속 빈줄 (4줄+)",
         issues["triple_blank"], warn_if_any=False)
    show("⑨ 링크 없는 파일",
         issues["no_link"])
    show("⑩ 300자 미만 초소형 파일",
         issues["tiny"], warn_if_any=False)

    total_fix = sum(len(issues[k]) for k in
                    ["nested","triple","broken_link","broken_img","no_fm","html_tags","triple_blank"])
    print(f"{'='*60}")
    print(f" 자동 수정 가능 이슈: {total_fix}건")
    print(f" (--fix 옵션으로 실행하면 대부분 자동 수정됨)")
    print(f"{'='*60}\n")


# ── 메인 ──────────────────────────────────────────────────────────────────────

def run(active_dir: str,
        vault_root: str | None = None,
        do_fix: bool = False,
        audit_only: bool = False,
        verbose: bool = False) -> None:

    search_root = vault_root or active_dir
    all_stems, slash_map, short_to_stem = build_stem_maps(search_root)

    # 감사
    result = audit(active_dir, all_stems, verbose=verbose)

    if not audit_only:
        print_report(result, verbose=verbose)

    if not do_fix:
        return

    # 수정 실행
    md_files = sorted(f for f in os.listdir(active_dir) if f.endswith(".md"))
    fix_counts: dict[str, int] = Counter()
    updated_files = 0

    for fname in md_files:
        path = os.path.join(active_dir, fname)
        with open(path, encoding="utf-8") as f:
            original = f.read()

        text = original
        fm, fm_raw, body = split_fm(text)

        # FIX-1: 중첩 wikilink
        new_body, n = fix_nested_wikilinks(body)
        fix_counts["nested"] += n

        # FIX-2: 삼중 대괄호
        new_body, n = fix_triple_brackets(new_body)
        fix_counts["triple"] += n

        # FIX-3: 깨진 wikilink
        new_body, n = fix_broken_wikilinks(new_body, all_stems, slash_map, short_to_stem)
        fix_counts["broken_link"] += n

        # FIX-4: 깨진 이미지
        new_body, n = fix_broken_images(new_body, all_stems, vault_root=search_root)
        fix_counts["broken_img"] += n

        # FIX-5: HTML 태그
        new_body, n = fix_html_tags(new_body)
        fix_counts["html_tags"] += n

        # FIX-6: 연속 빈줄
        new_body, n = fix_triple_blank(new_body)
        fix_counts["triple_blank"] += n

        text = fm_raw + new_body

        # FIX-7: Frontmatter 생성
        text, created = fix_frontmatter(text, fname)
        if created:
            fix_counts["no_fm"] += 1

        if text != original:
            with open(path, "w", encoding="utf-8") as f:
                f.write(text)
            updated_files += 1
            if verbose:
                print(f"  [FIX] {fname[:60]}")

    print(f"\n{'='*60}")
    print(f" 수정 결과")
    print(f"{'='*60}")
    print(f" 업데이트된 파일: {updated_files}개")
    for key, cnt in sorted(fix_counts.items(), key=lambda x: -x[1]):
        label_map = {
            "nested":       "중첩 wikilink 수정",
            "triple":       "삼중 대괄호 수정",
            "broken_link":  "깨진 링크 수정",
            "broken_img":   "깨진 이미지 제거",
            "html_tags":    "HTML 태그 제거",
            "triple_blank": "연속 빈줄 축소",
            "no_fm":        "Frontmatter 생성",
        }
        if cnt:
            print(f"  - {label_map.get(key, key)}: {cnt}건")
    print(f"{'='*60}\n")

    # 수정 후 재감사
    print("[재감사] 수정 후 남은 이슈:")
    result2 = audit(active_dir, all_stems, verbose=verbose)
    print_report(result2, verbose=verbose)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(
        description="Obsidian vault 감사 및 자동 수정 도구"
    )
    parser.add_argument("active_dir", help="active/ 폴더 경로")
    parser.add_argument("--vault", default=None,
                        help="vault 루트 경로 (broken link 검사용 전체 stem 수집)")
    parser.add_argument("--fix", action="store_true",
                        help="이슈 자동 수정 실행")
    parser.add_argument("--audit-only", action="store_true",
                        help="보고서만 출력 (수정 안 함)")
    parser.add_argument("--verbose", action="store_true",
                        help="상세 출력 (파일당 이슈 최대 10개)")
    args = parser.parse_args()

    run(
        active_dir  = args.active_dir,
        vault_root  = args.vault,
        do_fix      = args.fix,
        audit_only  = args.audit_only,
        verbose     = args.verbose,
    )
