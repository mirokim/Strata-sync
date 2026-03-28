"""
patch_v322.py  —  Graph RAG 데이터 정제 매뉴얼 v3.21.docx → v3.22.docx
  1. 헤더 버전/날짜 갱신 (v3.21 → v3.22)
  2. §19.3 프롬프트 버전 번호 갱신
  3. para 469 (17.4 권장 폴더 구조) 직전에 §18.5 신규 섹션 삽입
  4. 변경이력 테이블 최상단에 v3.22 행 삽입
  5. v3.22.docx 저장
"""
import copy, re
from pathlib import Path
from docx import Document
from docx.oxml.ns import qn
from docx.oxml  import OxmlElement
from lxml import etree

SRC  = Path("c:/dev2/Strata_Sync/manual/Graph RAG 데이터 정제 매뉴얼 v3.21.docx")
DEST = Path("c:/dev2/Strata_Sync/manual/Graph RAG 데이터 정제 매뉴얼 v3.22.docx")

# ── 헬퍼 ────────────────────────────────────────────────────────────────────

def make_para(pstyle: str, text: str, bold: bool = False) -> OxmlElement:
    """단락 XML 요소 생성"""
    p = OxmlElement('w:p')
    pPr = OxmlElement('w:pPr')
    pStyle = OxmlElement('w:pStyle')
    pStyle.set(qn('w:val'), pstyle)
    pPr.append(pStyle)
    p.append(pPr)

    r = OxmlElement('w:r')
    if bold:
        rPr = OxmlElement('w:rPr')
        b = OxmlElement('w:b')
        rPr.append(b)
        r.append(rPr)
    t = OxmlElement('w:t')
    t.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
    t.text = text
    r.append(t)
    p.append(r)
    return p


def make_table(headers: list[str], rows: list[list[str]]) -> OxmlElement:
    """간단한 w:tbl 생성 — 헤더 행(bold) + 데이터 행"""
    NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

    tbl = OxmlElement('w:tbl')

    # 테이블 속성 (기존 테이블과 동일한 tblPr 복사 대신 최소 설정)
    tblPr = OxmlElement('w:tblPr')
    tblStyle = OxmlElement('w:tblStyle')
    tblStyle.set(qn('w:val'), 'TableGrid')
    tblPr.append(tblStyle)
    tblW = OxmlElement('w:tblW')
    tblW.set(qn('w:w'), '0')
    tblW.set(qn('w:type'), 'auto')
    tblPr.append(tblW)
    tbl.append(tblPr)

    def _cell(text: str, header: bool = False) -> OxmlElement:
        tc = OxmlElement('w:tc')
        p  = OxmlElement('w:p')
        r  = OxmlElement('w:r')
        if header:
            rPr = OxmlElement('w:rPr')
            b   = OxmlElement('w:b')
            rPr.append(b)
            r.append(rPr)
        t = OxmlElement('w:t')
        t.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
        t.text = text
        r.append(t)
        p.append(r)
        tc.append(p)
        return tc

    def _row(cells: list[str], header: bool = False) -> OxmlElement:
        tr = OxmlElement('w:tr')
        for c in cells:
            tr.append(_cell(c, header))
        return tr

    tbl.append(_row(headers, header=True))
    for row in rows:
        tbl.append(_row(row))
    return tbl


# ── §18.5 신규 콘텐츠 목록 ──────────────────────────────────────────────────

def build_section_185() -> list:
    """
    삽입할 XML 요소 목록 반환.
    각 항목: ('p', pstyle, text, bold) 또는 ('tbl', headers, rows)
    """
    B, N, C, FP = True, False, False, False  # bold aliases

    items = []

    # 18.5 제목
    items.append(('p', 'BodyText', '18.5 Confluence 배치 동기화 date 오염 대응', True))
    items.append(('p', 'BodyText',
        'Confluence 스페이스를 일괄 내보내거나 페이지를 대량 이동하면, Confluence의 '
        'version.when 필드가 실제 작성일이 아닌 동기화 실행 날짜로 일괄 덮어씌워진다. '
        'refine_html_to_md.py는 이 값을 그대로 date: 필드로 사용하므로 2021년 문서도 '
        'date: 2026-03-11 처럼 최근 날짜로 찍힐 수 있다.', False))

    # 18.5.1
    items.append(('p', 'BodyText', '18.5.1 오염 판별', True))
    items.append(('p', 'BodyText',
        '배치 날짜 오염의 특징: 특정 날짜를 가진 파일이 5개 이상 집중된다.', False))
    items.append(('p', 'BlockText', 'python check_outdated.py <active_dir> --batch-check', False))
    items.append(('p', 'FirstParagraph', '또는 수동 확인:', False))
    items.append(('p', 'BlockText',
        "grep -rh \"^date:\" active/ | sort | uniq -c | sort -rn | head -20", False))
    items.append(('p', 'BlockText',
        '→ 동일 날짜가 10개 이상이면 배치 동기화 날짜로 의심', False))
    items.append(('p', 'FirstParagraph', '실제 오염 사례 (refined_vault 2026-03-13 진단):', False))
    items.append(('tbl',
        ['오염 날짜', '수', '원인'],
        [
            ['2026-03-11', '329개', '최근 Confluence 배치 동기화. 2020~2025년 문서 포함.'],
            ['2024-02-28', '69개',  '이전 Confluence 배치 동기화. 2021년 문서 포함.'],
            ['2022-05-17', '14개',  '그 이전 배치 동기화.'],
        ]
    ))
    items.append(('p', 'BodyText',
        '파급 효과: gen_year_hubs.py가 오염된 date 기준으로 연도 허브를 생성하면, '
        '회의록_2026.md "최근 추가 5개" 섹션에 2021년 문서가 올라간다. '
        'BFS가 이 허브를 출발점으로 삼으면 첫 Hop부터 2021년 문서로 탐색 → 구버전 응답.', False))

    # 18.5.2
    items.append(('p', 'BodyText', '18.5.2 수정 절차', True))
    items.append(('p', 'BodyText',
        '파일명에서 날짜를 추출하여 오염된 date: 필드를 덮어쓴다.', False))

    items.append(('p', 'BodyText', '(1) 파일명 날짜 추출 패턴 (우선순위 순)', True))
    items.append(('tbl',
        ['파일명 패턴', '예시', '추출 날짜'],
        [
            ['[YYYY_MM_DD] 대괄호 형식',          '[2022_02_07] 이사장 피드백.md',    '2022-02-07'],
            ['YYYYMMDD 8자리',                    'ProjectA_정례_20240215_캐릭터C.md',   '2024-02-15'],
            ['_YYMMDD_ 또는 _YYMMDD. (6자리)',    'ProjectA_캐릭터C연출_250714.md',      '2025-07-14'],
            ['파일명 내 연도만 (_YYYY_)',          '정례보고 자료_2022.md',            '2022-01-01 (연도만)'],
        ]
    ))
    items.append(('p', 'FirstParagraph',
        '6자리 패턴(YYMMDD)은 20YY로 해석하되, 2018~2030 범위에서만 유효로 처리한다.', False))

    items.append(('p', 'BodyText', '(2) fix_dates.py 스크립트 실행', True))
    items.append(('p', 'BlockText', '# dry-run: 수정 예상 목록만 출력', False))
    items.append(('p', 'BlockText', 'python fix_dates.py <active_dir>', False))
    items.append(('p', 'BlockText', '# 실제 수정', False))
    items.append(('p', 'BlockText', 'python fix_dates.py <active_dir> --apply', False))
    items.append(('tbl',
        ['옵션', '설명'],
        [
            ['--batch-dates 2026-03-11,...', '오염으로 간주할 날짜 목록 (쉼표 구분). 기본값: 자동 감지 (5개+)'],
            ['--apply',                      '실제 파일 수정. 없으면 dry-run.'],
            ['--no-match-log out.txt',        '파일명에서 날짜 추출 실패한 파일 목록 저장 (수동 처리용)'],
        ]
    ))

    items.append(('p', 'BodyText', '(3) 추출 실패 파일 처리', True))
    items.append(('p', 'BodyText',
        '파일명에 날짜가 전혀 없는 경우(Confluence ID만 있는 파일 등):', False))
    items.append(('p', 'BlockText', '1.  title 필드에 [YYYY.MM.DD] 패턴이 있으면 그 값을 사용', False))
    items.append(('p', 'BlockText', '2.  없으면 파일 본문 첫 날짜 언급을 수동으로 확인', False))
    items.append(('p', 'BlockText', "3.  그것도 없으면 연도만 추출 가능한 경우 YYYY-01-01로 대략 입력", False))
    items.append(('p', 'BlockText', "4.  완전 불명인 경우 date: unknown 표시 후 수동 처리 대기", False))

    # 18.5.3
    items.append(('p', 'BodyText', '18.5.3 수정 후 재생성 순서', True))
    items.append(('p', 'BodyText',
        'date 필드 일괄 수정 후 반드시 아래 순서로 재생성한다.', False))
    items.append(('p', 'BlockText', '# 1. 키워드 주입 (링크 확인용)', False))
    items.append(('p', 'BlockText', 'python inject_keywords.py <active_dir>', False))
    items.append(('p', 'BlockText', '# 2. 전체 인덱스 재생성', False))
    items.append(('p', 'BlockText', 'python gen_index.py <active_dir>', False))
    items.append(('p', 'BlockText', '# 3. 연도별 허브 재생성 (오염된 날짜 기반으로 만들어진 허브 교체)', False))
    items.append(('p', 'BlockText', 'python gen_year_hubs.py <active_dir> --top 5', False))
    items.append(('p', 'BlockText', '# 4. currentSituation.md "최근 30일" 섹션 수동 갱신', False))
    items.append(('p', 'BlockText', '#    → 올바른 날짜 기반 최신 문서 5개로 직접 작성', False))
    items.append(('p', 'FirstParagraph',
        'gen_year_hubs.py가 올바른 날짜 기준으로 연도 허브를 재생성해야 회의록_2026.md '
        '"최근 추가 5개" 섹션에 실제 최신 문서가 올라간다.', False))

    # 18.5.4
    items.append(('p', 'BodyText', '18.5.4 재발 방지', True))
    items.append(('p', 'BlockText',
        '-   Confluence에서 페이지 이동·스페이스 재편 작업 후에는 반드시 '
        'check_outdated.py --batch-check 실행', False))
    items.append(('p', 'BlockText',
        '-   대량 동기화 직후에는 grep ... | uniq -c | sort -rn 으로 date 분포를 확인하고 '
        '동일 날짜 10개 이상이면 fix_dates.py 우선 실행', False))
    items.append(('p', 'BlockText',
        '-   Recency boost(§18)는 date: 필드(frontmatter)를 기준으로 작동하며, '
        '파일 시스템 mtime은 사용하지 않는다. Confluence 동기화 시 mtime이 오늘로 '
        '갱신되어도 date:만 올바르면 문제 없다.', False))

    return items


# ── 메인 ────────────────────────────────────────────────────────────────────

def run():
    doc = Document(str(SRC))
    body = doc.element.body

    # ── 1. 버전 헤더 갱신 ───────────────────────────────────────────────────
    para_idx = 0
    for child in body:
        if child.tag.endswith('}p'):
            text = ''.join(t.text or '' for t in child.iter(qn('w:t')))
            if 'v3.21' in text and '2026-03-12' in text:
                for t_el in child.iter(qn('w:t')):
                    if t_el.text:
                        t_el.text = t_el.text.replace('v3.21 | 2026-03-12', 'v3.22 | 2026-03-13')
                print(f"[OK] 헤더 버전 갱신 완료")
                break

    # ── 2. §19.3 프롬프트 버전 갱신 ────────────────────────────────────────
    for child in body:
        if child.tag.endswith('}p'):
            text = ''.join(t.text or '' for t in child.iter(qn('w:t')))
            if 'v3.21을 읽고' in text:
                for t_el in child.iter(qn('w:t')):
                    if t_el.text:
                        t_el.text = t_el.text.replace('v3.21을', 'v3.22을')
                print(f"[OK] §19.3 프롬프트 버전 갱신 완료")

    # ── 3. §18.5 삽입: para 469 직전 ───────────────────────────────────────
    # para 469 = "17.4 권장 폴더 구조" → 이 element 찾기
    target_el = None
    para_idx = 0
    for child in body:
        if child.tag.endswith('}p'):
            text = ''.join(t.text or '' for t in child.iter(qn('w:t'))).strip()
            if para_idx == 469:
                target_el = child
                break
            para_idx += 1

    if target_el is None:
        print("[ERROR] para 469 를 찾지 못했습니다.")
        return

    # §18.5 요소들을 target_el 직전에 삽입 (역순으로 insertBefore)
    section_items = build_section_185()
    # target_el 바로 앞 위치에 순서대로 삽입
    insert_after = target_el.getprevious()  # None이면 body 첫 번째

    new_elements = []
    for item in section_items:
        if item[0] == 'p':
            _, pstyle, text, bold = item
            el = make_para(pstyle, text, bold)
            new_elements.append(el)
        elif item[0] == 'tbl':
            _, headers, rows = item
            el = make_table(headers, rows)
            new_elements.append(el)

    # target_el 앞에 모두 삽입
    for el in new_elements:
        target_el.addprevious(el)

    print(f"[OK] §18.5 {len(new_elements)}개 요소 삽입 완료 (para 469 직전)")

    # ── 4. 변경이력 테이블 상단에 v3.22 행 삽입 ────────────────────────────
    # "변경 이력" 단락 다음 테이블을 찾아 첫 번째 행 앞에 삽입
    found_history = False
    for child in body:
        if found_history and child.tag.endswith('}tbl'):
            # 이 테이블의 첫 번째 <w:tr> 앞에 새 행 삽입
            first_tr = child.find(qn('w:tr'))
            if first_tr is None:
                print("[WARN] 변경이력 테이블에 tr 없음")
                break

            # 기존 헤더 행 복사 (스타일 유지) 후 텍스트 교체
            # 실제로는 두 번째 tr(첫 데이터 행)을 복사해서 내용 교체
            trs = child.findall(qn('w:tr'))
            if len(trs) < 2:
                print("[WARN] 변경이력 테이블 행 부족")
                break

            new_tr = copy.deepcopy(trs[1])  # 첫 데이터 행 복사
            tds = new_tr.findall('.//' + qn('w:tc'))
            new_row_texts = [
                'v3.22',
                '§18.5 Confluence 배치 동기화 date 오염 대응 신설 — '
                'refined_vault 진단(2026-03-13)에서 발견된 버그: Confluence 스페이스 일괄 내보내기 시 '
                'version.when이 동기화 실행일로 덮어씌워져 2021년 문서도 date:2026-03-11로 찍힘. '
                '결과적으로 gen_year_hubs.py가 2021년 문서를 "최신"으로 분류하고 BFS가 구버전 응답. '
                '오염 판별법(date 분포 집계), fix_dates.py 스크립트 사용법(파일명 패턴 4종·dry-run·--apply 옵션), '
                '수정 후 재생성 순서(gen_index → gen_year_hubs → currentSituation 수동 갱신), '
                '재발 방지(배치 동기화 후 즉시 점검) 추가. §19.3 이어받기 프롬프트 v3.22 갱신. 2026-03-13.',
            ]
            for i, tc in enumerate(tds):
                if i >= len(new_row_texts):
                    break
                for t_el in tc.iter(qn('w:t')):
                    t_el.text = new_row_texts[i]
                    break  # 첫 번째 w:t만

            # 두 번째 tr(첫 데이터 행) 앞에 삽입
            trs[1].addprevious(new_tr)
            print("[OK] 변경이력 테이블 v3.22 행 삽입 완료")
            break

        if child.tag.endswith('}p'):
            text = ''.join(t.text or '' for t in child.iter(qn('w:t'))).strip()
            if text == '변경 이력':
                found_history = True

    # ── 5. 저장 ─────────────────────────────────────────────────────────────
    doc.save(str(DEST))
    print(f"[OK] 저장 완료: {DEST.name}")


if __name__ == '__main__':
    run()
