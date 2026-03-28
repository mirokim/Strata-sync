# RAG 누락 원인 진단 보고서

> 작성일: 2026-03-13
> 대상: refined_vault (1186개 문서)
> 현상: "캐릭터C 최신 자료" 쿼리에서 2024년 문서 반환, 2026년 문서 누락

---

## 1. 결론 (요약)

**Confluence 배치 동기화 때 `version.when`이 동기화 실행 날짜로 일괄 덮어씌워짐.**
→ 2021년 문서도 `date: 2026-03-11`로 찍힘
→ `gen_year_hubs.py`가 이 오염된 날짜 기준으로 허브 생성
→ `회의록_2026.md` "최신 5개" 섹션에 2021년 문서들이 올라감
→ BFS가 2021년 문서를 최신으로 탐색 → 매우 오래된 내용 반환

---

## 2. 오염 규모

| 오염 날짜 | 파일 수 | 의미 |
|----------|--------|------|
| `2026-03-11` | **329개** | 최근 Confluence 배치 동기화 날짜 |
| `2024-02-28` | **69개** | 이전 Confluence 배치 동기화 날짜 |
| `2022-05-17` | **14개** | 그 이전 배치 동기화 날짜 |
| **합계** | **412개** | 전체 1186개 중 **34.7%** 오염 |

---

## 3. 오염 증거 (구체적 예시)

### 오염 패턴 A: 2021년 문서가 2026-03-11로 찍힘

| 파일명 | 실제 날짜 (파일명 기준) | frontmatter date | 오염 여부 |
|--------|----------------------|-----------------|----------|
| `210129_프로젝트A_정례보고_M8플레이시나리오_v2.md` | 2021-01-29 | 2026-03-11 | ❌ 오염 |
| `210216_프로젝트 A_정례보고.md` | 2021-02-16 | 2026-03-11 | ❌ 오염 |
| `프로젝트 A_시나리오보고_20201106.md` | 2020-11-06 | 2026-03-11 | ❌ 오염 |
| `프로젝트A_정례_에녹1막_4_6_20220523.md` | 2022-05-23 | 2026-03-11 | ❌ 오염 |
| `프로젝트A_정례_캐릭터C_5단계_보고_20231130_v3.md` | 2023-11-30 | 2026-03-11 | ❌ 오염 |
| `Project A_영웅서사_2차_캐릭터C_20250604_v2.md` | 2025-06-04 | 2026-03-11 | ❌ 오염 |
| `ProjectA_캐릭터C 연출 강화_250714.md` | 2025-07-14 | 2026-03-11 | ❌ 오염 |

### 오염 패턴 B: 2021년 문서가 2024-02-28로 찍힘

| title (frontmatter) | 실제 날짜 | frontmatter date | 오염 여부 |
|--------------------|----------|-----------------|----------|
| `[2021.08.20] 프로젝트A 기획 리뷰 보고 피드백` | 2021-08-20 | 2024-02-28 | ❌ 오염 |
| `[2021.09.06] 프로젝트A 시나리오 보고 피드백` | 2021-09-06 | 2024-02-28 | ❌ 오염 |

---

## 4. 파급 효과: 허브 문서 오염

### `회의록_2026.md` "최근 추가 (최신 5개)" 섹션

```
- [[20250930_캐릭터 논의 회의록]] (2026-03-11)   ← 실제: 2025-09-30
- [[20251107_캐릭터 논의 회의록]] (2026-03-11)   ← 실제: 2025-11-07
- [[210129_프로젝트A_정례보고_M8...]] (2026-03-11) ← 실제: 2021-01-29 ⚠️
- [[210216_프로젝트 A_정례보고]] (2026-03-11)     ← 실제: 2021-02-16 ⚠️
```

진짜 2026 문서들은 목록 맨 아래에:
```
- [[676884042_[2026_02_26] 프로젝트A 이사장님 피드백]] (2026-02-27)
- [[652885523_캐릭터C(Wolyoung)]] (2026-02-10)  ← 캐릭터C 관련 실제 최신 문서
- [[666332716_[2026_01_28] 프로젝트A 이사장님 피드백]] (2026-01-30)
```

### 결과

1. BFS가 `회의록_2026.md` 탐색 시 "최신 5개" 섹션에서 2021년 문서 탐색 시작
2. `currentSituation.md`도 동일 문제 — "최근 30일" 섹션에 2021년 문서 다수 포함
3. 키워드 매칭으로 오염된 날짜(2026-03-11)를 가진 문서가 recency boost 최대값 획득
4. 실제 최신 문서(2026-01~03)가 오래된 문서들에 묻힘

---

## 5. 수정 방향

### 5-1. date 필드 수정 우선순위

**A등급 (파일명에서 자동 추출 가능, 201개)**

파일명 패턴 → 추출 가능한 날짜:

| 파일명 패턴 | 예시 | 추출 날짜 |
|-----------|------|---------|
| `YYYYMMDD_*` | `20250714_캐릭터B.md` | 2025-07-14 |
| `*_YYYYMMDD*` | `ProjectA_캐릭터C연출_250714.md` | 2025-07-14 |
| `*_YYMMDD*` | `ProjectA_캐릭터C연출_250714.md` | 2025-07-14 |
| `[YYYY_MM_DD]*` | `[2022_02_07] 피드백.md` | 2022-02-07 |
| `*_YYYYMMDD_*` | `ProjectA_정례_20240215_캐릭터C.md` | 2024-02-15 |

**B등급 (title/내용에서 추출 필요, 약 128개)**

Confluence ID 형식(`숫자_문서명`) 파일 중 title에 날짜 없는 경우:
- Confluence 원본 페이지의 생성일을 직접 확인 필요
- 또는 파일 내용의 첫 번째 날짜 언급 기반으로 유추

**C등급 (Confluence ID, 날짜 불명, 수동 확인)**

`162848747_정례보고 자료_2022.md` 같은 파일 — 파일명에 연도만 있는 경우:
- `date: 2022-01-01` 처럼 연도만 맞춰서 대략 입력

---

### 5-2. 자동 수정 스크립트 (Python)

```python
#!/usr/bin/env python3
"""
fix_dates.py — 파일명에서 날짜 추출하여 오염된 date 필드 수정

대상: date가 배치 동기화 날짜(2026-03-11, 2024-02-28 등)인 파일
"""
import re
import os
from pathlib import Path

VAULT_PATH = "refined_vault/active"

# 배치 동기화로 의심되는 날짜들 (중복 10개 이상인 날짜)
BATCH_DATES = {
    "2026-03-11",
    "2024-02-28",
    "2022-05-17",
}

def extract_date_from_filename(stem: str) -> str | None:
    """파일명(확장자 제외)에서 날짜 추출. 없으면 None."""
    # [YYYY_MM_DD] 패턴
    m = re.search(r'\[(\d{4})_(\d{2})_(\d{2})\]', stem)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"

    # YYYYMMDD 패턴 (8자리)
    m = re.search(r'(?<!\d)(20\d{2})(0[1-9]|1[0-2])([0-2][0-9]|3[01])(?!\d)', stem)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"

    # YYMMDD 패턴 (6자리, 20YY로 해석)
    m = re.search(r'(?<!\d)(2[0-9])(0[1-9]|1[0-2])([0-2][0-9]|3[01])(?!\d)', stem)
    if m:
        yy = int(m.group(1))
        year = 2000 + yy
        if 2018 <= year <= 2030:  # 합리적 범위만
            return f"{year}-{m.group(2)}-{m.group(3)}"

    return None

def fix_vault_dates(vault_path: str, dry_run: bool = True):
    fixed = 0
    skipped = 0
    no_match = 0

    for md_file in Path(vault_path).glob("*.md"):
        content = md_file.read_text(encoding="utf-8")

        # 현재 date 추출
        m = re.search(r'^date:\s*(\S+)', content, re.MULTILINE)
        if not m:
            continue
        current_date = m.group(1).strip('"').strip("'")

        if current_date not in BATCH_DATES:
            skipped += 1
            continue

        # 파일명에서 날짜 추출
        new_date = extract_date_from_filename(md_file.stem)
        if not new_date:
            no_match += 1
            print(f"[수동 필요] {md_file.name}  (현재: {current_date})")
            continue

        # 수정
        new_content = re.sub(
            r'^(date:\s*)(\S+)',
            f'\\g<1>{new_date}',
            content,
            count=1,
            flags=re.MULTILINE,
        )

        if dry_run:
            print(f"[DRY] {md_file.name}: {current_date} → {new_date}")
        else:
            md_file.write_text(new_content, encoding="utf-8")
            print(f"[수정] {md_file.name}: {current_date} → {new_date}")
        fixed += 1

    print(f"\n결과: 수정 {fixed}개 / 건너뜀 {skipped}개 / 수동 필요 {no_match}개")

if __name__ == "__main__":
    import sys
    dry_run = "--apply" not in sys.argv
    if dry_run:
        print("=== DRY RUN (실제 수정 없음) — --apply 옵션으로 실제 수정 ===\n")
    fix_vault_dates(VAULT_PATH, dry_run=dry_run)
```

---

### 5-3. 수정 후 재생성해야 할 파일

date 필드를 수정한 후 **반드시 아래 순서로 재생성**:

```bash
# 1. date 수정 (위 스크립트 실행)
python fix_dates.py --apply

# 2. 인덱스 재생성
python scripts/gen_index.py refined_vault/active

# 3. 연도별 허브 재생성 (회의록_2026.md, 회의록_2025.md 등)
python scripts/gen_year_hubs.py refined_vault/active --top 5

# 4. currentSituation.md 재생성 (없으면 수동 작성)
# → "최근 30일" 섹션이 올바른 날짜 기반으로 채워져야 함
```

---

## 6. 캐릭터C 관련 실제 최신 문서 목록

현재 올바른 date를 가진 진짜 최신 캐릭터C 문서:

| 파일명 | date | 내용 추정 |
|--------|------|---------|
| `679664492_캐릭터C 모션 리뉴얼 2차 리스트.md` | 2026-03-11* | 모션 리뉴얼 |
| `652885523_캐릭터C(Wolyoung).md` | 2026-02-10 | 종합 캐릭터 문서 |
| `614481657_캐릭터C 리뉴얼 상세 기획서.md` | 2025-12-15 | 리뉴얼 기획 |
| `614481664_01_ 캐릭터 _ 캐릭터C _ FX 리스트.md` | 2025-12-26 | FX |
| `637538344_01_ 캐릭터 _ 캐릭터C _ 스킬 관련 기능 요청.md` | 2025-12-11 | 스킬 기능 |
| `637553534_01_ 캐릭터 _ 캐릭터C _ 사운드 리스트.md` | 2025-12-15 | 사운드 |
| `563212118_01_ 캐릭터 _ 캐릭터C _ 모션 리스트.md` | 2025-12-15 | 모션 |
| `614491017_01_ 캐릭터 _ 캐릭터C _ 기능 구현 확인 리스트.md` | 2025-12-02 | 기능 확인 |

*`679664492` 파일은 파일명에 날짜 없어서 `date: 2026-03-11`이 실제 날짜일 수도 있음 (Confluence 등록일 기준) — 직접 확인 필요.

---

## 7. 체크리스트

- [ ] `fix_dates.py` dry-run 실행하여 예상 수정 목록 확인
- [ ] `679664492_캐릭터C 모션 리뉴얼 2차 리스트.md` — 실제 작성일 Confluence에서 확인
- [ ] `--apply` 옵션으로 date 일괄 수정
- [ ] `gen_index.py` → `gen_year_hubs.py` 순서로 허브 재생성
- [ ] `currentSituation.md` "최근 30일" 섹션 올바른 날짜로 재작성
- [ ] Slack 재테스트: "캐릭터C 최신 자료 알려줘" → 2025-12 이후 문서 반환 확인
