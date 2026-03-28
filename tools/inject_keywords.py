#!/usr/bin/env python3
"""
inject_keywords.py — §9 키워드 링크 주입

프로젝트A 고유 키워드(캐릭터명, 시스템명 등)가 본문에 텍스트로 등장할 때
첫 1회만 [[target_stem|keyword]] 형식의 wikilink로 변환.

특징:
- placeholder 방식으로 기존 링크 보호
- frontmatter 영역 제외
- 코드블록 제외
- 자기 자신 링크 금지
- 최소 본문 길이 조건 (200자 이상인 파일만 처리)

사용법:
  python inject_keywords.py <active_dir>
"""

import re
import sys
import argparse
from pathlib import Path


# ============================================================
# §9 키워드 맵 (keyword → target_stem)
# 키워드가 본문에 등장하면 [[target_stem|keyword]] 로 변환
# ============================================================

KEYWORD_MAP = {
    # ── 캐릭터 (인게임 영웅) ──────────────────────────────
    "월영":   "652885523_월영(Wolyoung)",
    "마투아":  "472337984_마투아 _ 거대화",      # 마투아 대표 파일 (스킬 중심)
    "마티니":  "20250704_마티니 3차 번역본",
    "다이잔":  "416014685_06_ 캐릭터 _ 다이잔",
    "보르후":  "634228037_13_ 캐릭터 _ 보르후",
    "스칼렛":  "432514018_07_ 캐릭터 _ 스칼렛",
    "알탄":   "567516519_알탄 _ 모션 리스트",
    "미하일":  "342982926_03_ 캐릭터 _ 미하일",
    "타미리스": "658869554_05_ 캐릭터 _ 타미리스 _ 리뉴얼",
    "바도스":  "584041454_14_ 캐릭터 _ 바도스 블레이드",
    "오룰론":  "517677837_오룰론 스킬 후보",
    "미니626": "435550254_09_ 캐릭터 _ 미니626",

    # ── 세계관 / 국가 ──────────────────────────────────────
    "노든":   "프로젝트A_노든_외부공유v1",
    "센트럴":  "프로젝트A_센트럴_외부공유v1",
    "니케 공화국": "프로젝트A_니케 공화국_외부공유",

    # ── 게임 모드 / 콘텐츠 ────────────────────────────────
    "점령전":  "679673373_점령전 이슈 정리 (20260327 보고 대응)",
    "난투전":  "626391685_[기획] 난투전 레벨 피드백 히스토리 정리 (작업중)",
    "레이드":  "프로젝트A_20230221_레이드우로보_상세_v4",
    "월드맵":  "프로젝트 A_월드맵_정례보고_220110",

    # ── 기술 / 도구 ────────────────────────────────────────
    "Maptool": "171712423_Maptool_ 가이드",
    "MTP":     "588778238_MTP(maptoolplus) 가이드",
    "TLS":     "588781620_TLS(TimeLineSkill)시스템",
    "SVN":     "_ProjectA_ SVN _ Unity Setting 매뉴얼",
    "Voxel":   "588786812_Voxel Tool",
}

# 너무 짧거나 흔한 단어는 제외 (길이 < 2 자동 필터됨)
MIN_KEYWORD_LEN = 2

# 최소 본문 길이 (frontmatter 제외)
MIN_BODY_LEN = 100


def split_frontmatter(content: str):
    """frontmatter와 body 분리."""
    if content.startswith('---'):
        end = content.find('\n---\n', 4)
        if end != -1:
            return content[:end + 5], content[end + 5:]
    return '', content


def inject_keywords(active_dir: Path) -> int:
    """키워드 wikilink 주입. 변경된 파일 수 반환."""
    all_stems = {md.stem for md in active_dir.glob('*.md')}

    # target stem 중 존재하지 않는 것 경고
    missing = {k: v for k, v in KEYWORD_MAP.items() if v not in all_stems}
    if missing:
        print(f"  ⚠️  대상 파일 없음 ({len(missing)}개):")
        for kw, stem in missing.items():
            print(f"       '{kw}' → '{stem}'")

    # 유효한 키워드만 사용
    valid_map = {k: v for k, v in KEYWORD_MAP.items()
                 if v in all_stems and len(k) >= MIN_KEYWORD_LEN}

    # 길이 내림차순 정렬 (긴 키워드 우선 매칭)
    sorted_keywords = sorted(valid_map.items(), key=lambda x: -len(x[0]))

    changed = 0

    for md in sorted(active_dir.glob('*.md')):
        current_stem = md.stem

        try:
            content = md.read_text(encoding='utf-8', errors='replace')
        except Exception:
            continue

        fm, body = split_frontmatter(content)

        # 본문이 너무 짧으면 스킵
        if len(body.strip()) < MIN_BODY_LEN:
            continue

        # ── Step 1: 기존 [[...]] 링크 placeholder 보호 ──────
        placeholders = {}
        ph_counter = [0]

        def replace_wlink(m):
            ph_counter[0] += 1
            key = f'\x00WLINK{ph_counter[0]}\x00'
            placeholders[key] = m.group(0)
            return key

        body_p = re.sub(r'\[\[[^\]]+\]\]', replace_wlink, body)

        # ── Step 2: 코드블록 보호 ────────────────────────────
        code_ph = {}
        code_counter = [0]

        def replace_code(m):
            code_counter[0] += 1
            key = f'\x00CODE{code_counter[0]}\x00'
            code_ph[key] = m.group(0)
            return key

        body_p = re.sub(r'```.*?```', replace_code, body_p, flags=re.DOTALL)
        body_p = re.sub(r'`[^`]+`', replace_code, body_p)

        # ── Step 3: 키워드 주입 ──────────────────────────────
        file_changed = False

        for keyword, target_stem in sorted_keywords:
            # 자기 자신 파일이 대상인 경우 스킵
            if target_stem == current_stem:
                continue

            # 키워드가 본문에 있는지 확인 (단어 경계 기준)
            # 한국어 단어 경계: 앞뒤에 한글/영문/숫자가 아닌 경우
            esc = re.escape(keyword)
            pattern = rf'(?<![가-힣\w]){esc}(?![가-힣\w])'

            if not re.search(pattern, body_p):
                continue

            # 첫 등장 1회만 교체
            new_link = f'[[{target_stem}|{keyword}]]'
            body_p, count = re.subn(pattern, new_link, body_p, count=1)

            if count > 0:
                file_changed = True

        if file_changed:
            # ── Step 4: placeholder 복원 ─────────────────────
            for key, orig in code_ph.items():
                body_p = body_p.replace(key, orig)
            for key, orig in placeholders.items():
                body_p = body_p.replace(key, orig)

            md.write_text(fm + body_p, encoding='utf-8')
            changed += 1

    return changed


def main():
    parser = argparse.ArgumentParser(description='§9 키워드 링크 주입')
    parser.add_argument('active_dir', help='active/ 폴더 경로')
    args = parser.parse_args()

    active_dir = Path(args.active_dir)
    if not active_dir.is_dir():
        print(f"오류: {active_dir} 폴더를 찾을 수 없습니다.")
        sys.exit(1)

    print(f"키워드 링크 주입 시작 (키워드 {len(KEYWORD_MAP)}개)...")
    n = inject_keywords(active_dir)
    print(f"\n=== §9 키워드 링크 주입 완료: {n}개 파일 변경 ===")


if __name__ == '__main__':
    main()
