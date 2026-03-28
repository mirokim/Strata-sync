> **4. 원본 파일 → Markdown 변환**

HTML · PDF · PPTX · XLSX · DOCX · TXT · MD 총 7가지 형식을 Obsidian 호환 마크다운으로 변환한다. 모든 형식에 공통 원칙을 적용한 뒤 형식별 처리를 수행한다.

**4.0 공통 원칙 (전 형식 적용)**

모든 변환 스크립트는 아래 출력 구조와 frontmatter 규칙을 동일하게 따른다.

출력 구조:

> active/
>
> └── {파일stem}.md           \# 변환된 마크다운
>
> attachments/
>
> └── {파일stem}\_p{페이지}\_{순번}.{확장자}   \# 추출 이미지

Frontmatter 필수 필드:

> \-\--
>
> title: "원본 파일명 (확장자 제외)"
>
> date: YYYY-MM-DD         \# 파일 수정일 또는 내용 내 날짜
>
> type: spec               \# spec / meeting / guide / reference / decision
>
> status: active
>
> tags: \[도메인\]
>
> speaker: chief\_director    \# 담당자 ID — PPR speaker affinity 재순위화에 사용
>
> \# chief\_director / art\_director / design\_director / level\_director / tech\_director
>
> graph\_weight: normal        \# Graph RAG 링크 가중치: normal(기본) / low(100-499링크) / skip(500+링크)
>
> related: \[허브\_파일\_stem\]  \# 상위 허브 참조 (구조적 링크 — body 링크와 분리)
>
> source: "원본 파일 경로 또는 URL"
>
> origin: pptx             \# 원본 형식 식별자 (pptx / xlsx / pdf / docx / html / txt / md)
>
> \-\--

이미지 파일명 규칙: `{파일stem}_p{페이지}_{순번}.png`

- 페이지 개념이 없는 형식(XLSX, DOCX)은 `{파일stem}_{순번}.png` 사용
- 이미지가 없으면 attachments/ 항목 생략

> *스크립트가 자동 생성한 frontmatter는 이후 §6 프론트매터 통일 단계에서 전체 일괄 정규화한다.*

**4.0.1 Confluence 첨부 파일 출처 기록 규칙**

Confluence 페이지에 첨부된 파일(PPT, XLSX, DOCX 등)을 변환할 때는 파일
자체의 경로가 아닌 **첨부 파일이 올라간 Confluence 페이지 URL**을 출처로
기록한다. 파일 경로는 Confluence 외부에서 접근할 수 없고, 페이지 URL만이
원본 컨텍스트를 보존하는 식별자이다.

Frontmatter 작성 기준:

> \-\--
>
> source: "https://confluence.company.com/pages/viewpage.action?pageId=XXXXXXXX"
>
> \# 첨부 파일이 있던 Confluence 페이지 URL (파일 경로 X)
>
> origin: pptx             \# 원본 첨부 파일 형식
>
> \-\--

본문 `## 개요` 섹션 첫 줄 패턴:

> 원본 파일: \[\[Confluence 페이지 MD 파일명\|페이지 제목\]\] 에 첨부된 \`파일명.pptx\`

  ----------------------------------------- -------------------------------------------------------
  **상황**                                  **처리 방법**
  부모 페이지도 MD로 변환된 경우            `[[부모페이지_stem|페이지 제목]]` wikilink 삽입
  부모 페이지가 변환되지 않은 경우          Confluence URL을 텍스트로 기재 (`source` 필드와 동일)
  첨부 파일 출처 페이지 불명               `source: unknown` 기재 후 §14 보조 문서로 이동 검토
  ----------------------------------------- -------------------------------------------------------

> *source 필드에 Confluence 페이지 URL을 기록하면 check\_quality.py의 source
> URL 누락 점검 ⑧번 항목을 통과할 수 있다. 파일 경로(예: `/attachments/`)를
> 기재하면 오탐 처리된다.*

**4.1 HTML → MD**

→ 스크립트: refine\_html\_to\_md.py | 라이브러리: BeautifulSoup4, markdownify

-   HTML 파싱 후 본문 텍스트 추출, HTML 테이블 → Markdown 테이블 변환

-   ac:image(Confluence 첨부 이미지) → `![[파일명.확장자]]` 변환

-   multiprocessing.Pool 병렬처리로 대량 파일 일괄 변환

-   Frontmatter: source에 Confluence/Jira/Notion 원본 URL 반드시 기록

> *Confluence HTML 내보내기 시 ac:image 태그가 일반 img 태그와 다름. BeautifulSoup으로 별도 처리 필요.*

**4.2 PDF → MD**

→ 스크립트: pdf\_to\_md.py, extract\_images.py | 라이브러리: pdfplumber, pymupdf, pdf2image, pytesseract

**4.2.0 Tesseract 설치 가이드 (플랫폼별)**

pytesseract는 Tesseract OCR 엔진의 Python 래퍼다. 반드시 Tesseract 엔진을 먼저 설치해야 한다.

| 플랫폼 | 설치 명령 | 한글 언어팩 |
|--------|-----------|-------------|
| **Windows** | [GitHub: UB-Mannheim/tesseract](https://github.com/UB-Mannheim/tesseract/wiki) 인스톨러 다운로드 → 설치 시 "Additional language data (download)" → `Korean` 체크 | 인스톨러에서 선택 |
| **macOS** | `brew install tesseract tesseract-lang` | `brew install tesseract-lang` (모든 언어 포함) |
| **Ubuntu/Debian** | `sudo apt install tesseract-ocr tesseract-ocr-kor` | `tesseract-ocr-kor` 패키지 |
| **CentOS/RHEL** | `sudo yum install tesseract` + `tesseract-langpack-kor` | `tesseract-langpack-kor` |

Windows 추가 설정 (환경 변수):
```python
# pdf_to_md.py 상단에 추가
import pytesseract
pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'
```

설치 확인:
```bash
tesseract --version
tesseract --list-langs  # kor 이 목록에 있어야 함
```

> *언어팩에 `kor`가 없으면 OCR 결과가 영문 전용으로 처리된다. PDF가 한글 문서라면 반드시 확인할 것.*

**대용량 PDF 타임아웃 대응:**

| 문서 규모 | 권장 처리 방식 |
|-----------|----------------|
| 100 페이지 미만 | 기본 단일 프로세스 |
| 100~500 페이지 | `multiprocessing.Pool(os.cpu_count())` 페이지 병렬 처리 |
| 500 페이지 이상 | 파일을 100 페이지 단위로 분할 후 배치 처리 (pdftk 또는 PyPDF2) |

```python
# 500페이지 초과 시 분할 예시
from PyPDF2 import PdfReader, PdfWriter
def split_pdf(path, chunk_size=100):
    reader = PdfReader(path)
    for i in range(0, len(reader.pages), chunk_size):
        writer = PdfWriter()
        for page in reader.pages[i:i+chunk_size]:
            writer.add_page(page)
        yield writer  # 청크별 처리
```

**다국어 혼합 문서 처리:**

```python
# 한글+영문 혼합 OCR (권장 설정)
text = pytesseract.image_to_string(img, lang='kor+eng')
# 일본어 포함 시
text = pytesseract.image_to_string(img, lang='kor+eng+jpn')
# 중국어 간체 포함 시
text = pytesseract.image_to_string(img, lang='kor+eng+chi_sim')
```

**기본 방침: OCR 우선.** 텍스트 레이어가 있는 디지털 PDF도 레이아웃 순서 오류·깨진 문자 위험이 있으므로, 원칙적으로 OCR(pytesseract)을 1순위 추출 경로로 사용한다. pdfplumber는 처리 속도가 중요하고 텍스트 품질이 확인된 경우에만 대안으로 선택한다.

  ------------ --------------------------------------------- ----------------------------------------------------------
  **케이스**   **판단 기준**                                  **처리 방법**
  일반 PDF     모든 PDF (기본 경로)                           **pdf2image로 페이지 이미지화 → pytesseract OCR (kor+eng)**, pymupdf로 이미지 추출
  텍스트 PDF   배치 처리·속도 우선이고 텍스트 품질 확인 완료  pdfplumber로 텍스트+테이블 추출, pymupdf로 이미지 추출 (선택적 대안)
  Confluence PDF 브라우저 인쇄 저장본   헤더/푸터/페이지번호 노이즈 다수   OCR 추출 후 §4.2.1 노이즈 제거 적용
  ------------ --------------------------------------------- ----------------------------------------------------------

처리 단계:

  ---------- -------------------------------------------------------------------------
  **단계**   **작업**
  1단계      pdf2image로 페이지별 이미지 변환 (OCR 경로) 또는 pdfplumber 선택
  2단계      pytesseract OCR (kor+eng) 실행 → 페이지별 텍스트 추출 및 섹션 구조 분析
  3단계      이미지 추출 → attachments/ 저장 (파일명 규칙 적용)
  4단계      노이즈 제거 (§4.2.1 기준)
  5단계      허브-스포크 분할 계획 수립 (§5 참조)
  6단계      Frontmatter 생성 및 위키링크 보강
  ---------- -------------------------------------------------------------------------

> *pdfplumber 대안 경로는 대량 배치 처리 시 속도 최적화 목적으로만 사용. 품질 기준 문서(계약서·기획서·회의록 등)는 반드시 OCR 경로를 사용한다.*

**4.2.1 PDF 노이즈 제거 기준**

  ------------------ --------------------------------------------------------
  **제거 대상**      **예시**
  페이지 헤더/푸터   페이지 상단/하단 반복 텍스트
  페이지 번호 URL    https://\... 3/12 형태의 페이지 경로
  광고 블록          배너·파워링크 등 광고 관련 문자열
  저작권 고지        CC BY·All rights reserved 등
  플랫폼 UI 잔재     Powered by Confluence, Edit this page, View history 등
  ------------------ --------------------------------------------------------

**4.2.2 앱 내 PDF 변환 방식 (pdfjs-dist) — 제한 사항 숙지 필수**

Sandbox Map 앱의 "파일 불러오기" 기능은 Python 스크립트와 **다른 엔진**으로 PDF를 처리한다.

  ------------------------------ -----------------------------------------------------------------------
  **항목**                       **내용**
  라이브러리                     `pdfjs-dist` — `getTextContent()` API
  추출 방식                      텍스트 레이어 직접 파싱 (OCR 아님)
  스캔 PDF                       **추출 불가** — 이미지만 있는 스캔본은 결과가 빈 문자열
  이미지 추출                    미지원 — 텍스트만 추출
  적용 대상                      텍스트 레이어가 내장된 PDF (디지털 생성본)
  ------------------------------ -----------------------------------------------------------------------

> *스캔 PDF·이미지 기반 PDF는 앱 내 변환 불가. §4.2 Python 스크립트 경로(pytesseract OCR)를 통해 처리한다.*

**4.3 PPTX → MD**

→ 스크립트: pptx\_to\_md.py | 라이브러리: python-pptx

-   슬라이드 1개 = `## 슬라이드 N — {제목}` 섹션 1개

-   텍스트박스·표·SmartArt 내 텍스트 추출, 발표자 노트는 `> 📌 노트:` 인용구로 변환

-   삽입 이미지(PNG/JPG/GIF)는 attachments/ 폴더에 추출

-   도형(Shape)/차트는 텍스트 데이터만 추출. 시각적 렌더링이 필요하면 LibreOffice headless로 슬라이드 전체를 PNG 변환 후 `![[stem_pN_1.png]]` 삽입

출력 예시:

> \-\--
>
> title: "UX개선\_스킬FX기조\_v4"
>
> origin: pptx
>
> \-\--
>
> \#\# 슬라이드 1 --- 표지
>
> 스킬 FX 제작 기조 / UX 관점
>
> \#\# 슬라이드 2 --- 현황
>
> 본문 텍스트...
>
> !\[\[UX개선\_스킬FX기조\_v4\_p2\_1.png\]\]
>
> \> 📌 노트: 이 슬라이드에서 강조할 내용...

> *python-pptx는 벡터 도형(SmartArt, 그룹 도형)을 이미지로 렌더링하지 못한다. 시각 정보가 중요한 슬라이드는 LibreOffice headless 변환을 병행한다.*

**4.3.1 앱 내 PPTX/DOCX 변환 방식 (JSZip + XML) — 제한 사항 숙지 필수**

Sandbox Map 앱의 "파일 불러오기" 기능은 Python 스크립트와 **다른 엔진**으로 PPTX/DOCX를 처리한다.

PPTX:

  ------------------------------ -----------------------------------------------------------------------
  **항목**                       **내용**
  라이브러리                     `JSZip` (브라우저/Node.js 환경)
  추출 방식                      `ppt/slides/slide*.xml` → `<a:t>` 태그 XML 파싱 (OCR 아님)
  발표자 노트                    **추출 안 됨** — `notesSlides/` 폴더 미파싱
  차트(Chart) 내 텍스트          **추출 안 됨**
  이미지 안 텍스트               **추출 안 됨**
  ------------------------------ -----------------------------------------------------------------------

DOCX:

  ------------------------------ -----------------------------------------------------------------------
  **항목**                       **내용**
  라이브러리                     `JSZip`
  추출 방식                      `word/document.xml` → `<w:t>` 태그 XML 파싱 (OCR 아님)
  단어 경계                      `<w:t>` 분절 방식에 따라 단어 사이 공백 누락 가능
  머리글·바닥글·주석             추출 안 됨
  ------------------------------ -----------------------------------------------------------------------

> *발표자 노트·차트 텍스트가 중요한 파일은 §4.3 Python 스크립트 경로(python-pptx)를 사용한다. DOCX 단어 경계 문제가 발생하면 §4.5 python-docx 경로로 재처리한다.*

**4.4 XLSX → MD**

→ 스크립트: xlsx\_to\_md.py | 라이브러리: openpyxl

-   시트 1개 = `## 시트명` 섹션 1개

-   셀 데이터 → Markdown 테이블 변환. 병합 셀은 첫 번째 셀 값 사용

-   빈 시트·숨겨진 시트는 건너뜀

-   시트에 삽입된 이미지(Image 객체)는 attachments/ 폴더에 추출

-   차트(Chart 객체)는 원본 데이터 범위를 테이블로 표현. 시각 렌더링 필요 시 LibreOffice headless PNG 변환

출력 예시:

> \#\# 시트 1 --- 캐릭터 기본 스탯
>
> \| 캐릭터 \| HP \| 공격력 \| 방어력 \|
>
> \|-----\|-----\|-----\|-----\|
>
> \| 다이잔 \| 100 \| 85 \| 60 \|

> *행이 1000개 이상인 시트는 §5 허브-스포크 분할 대상으로 검토한다 (시트 상단 요약 허브 + 행 단위 스포크).*

**4.5 DOCX → MD**

→ 스크립트: docx\_to\_md.py | 라이브러리: python-docx

-   스타일 기반 헤딩 변환: Heading 1 → `#`, Heading 2 → `##`, Heading 3 → `###`

-   본문 단락 → 일반 텍스트, 표 → Markdown 테이블

-   인라인 이미지(그림) → attachments/ 폴더에 추출 후 `![[stem_1.png]]` 삽입

-   볼드/이탤릭 인라인 포맷팅 유지 (`**텍스트**`, `*텍스트*`)

-   머리글/바닥글·주석·추적 변경은 제외

> *스타일이 없는 DOCX(스타일 미적용 단락만 있는 경우)는 헤딩 구조가 생성되지 않는다. 변환 후 §10 섹션 헤딩 추가 단계에서 `## 개요` 자동 삽입 처리된다.*

**4.6 TXT → MD**

→ 스크립트: txt\_to\_md.py | 라이브러리: 없음 (표준 라이브러리만 사용)

-   내용 그대로 보존, frontmatter만 자동 생성

-   파일명에서 날짜 패턴(`YYYY-MM-DD`, `YYYYMMDD`) 감지 시 date 필드 자동 설정

-   이미지 없음

> *TXT 파일은 정보 밀도가 낮을 가능성이 높다. 변환 후 §3.1.1 스텁 판단 기준을 통해 50자 미만이면 .archive/ 이동 대상으로 처리한다.*

**4.7 MD 정규화**

→ 스크립트: md\_normalize.py | 라이브러리: 없음

이미 마크다운 형식인 파일은 내용을 변경하지 않고 frontmatter만 정규화한다.

-   frontmatter가 없으면 자동 생성 (파일명·수정일 기반)

-   frontmatter가 있으면 필수 필드(date · type · status · tags · origin) 누락분만 보완

-   `origin: md` 필드 추가

-   `![[이미지]]` 링크 대상 파일이 attachments/ 에 없으면 경고 출력

**4.0.2 날짜 파일명 패턴 권장**

Rembrandt Map의 directVaultSearch는 `[YYYY.MM.DD]` 형식의 파일명을 감지하여
자연어 질문에서도 해당 파일을 직접 검색한다. TF-IDF를 통하지 않고 파일명
매칭으로 우선 처리되므로 날짜 기반 문서(피드백·회의록·보고서)는 아래 형식을
따를 때 검색 정확도가 크게 향상된다.

> 권장 패턴: `[2026.03.12] 이사장 피드백_XXXXXXXX.md`
>
> → "3월 12일 피드백", "3월 피드백", "최근 이사장 피드백" 등 자연어 쿼리에서 직접 매칭

-   Confluence 내보내기 시 페이지 제목에 날짜가 없으면 수동으로 파일명 앞에 `[YYYY.MM.DD] ` 추가
-   날짜 불명 파일은 파일 수정일을 기준으로 추가 (§4.0 date 필드 규칙과 동일)
-   **recency boost 연동 (v3.26)**: `parseFilenameDate()`가 파일명에서 날짜를 자동 추출하여 BM25/directVaultSearch recency boost에 사용. 인식 패턴: `YYYY_MM_DD`, `YYYYMMDD`, `YY_MM_DD`, `YYMMDD`. 파일명 날짜 > frontmatter date > mtime 순으로 우선 적용. 파일명에 날짜가 있으면 Confluence mtime 오염(§18.5·§18.6)에도 정확한 최신도 판단 가능.

**4.8 형식별 비교 요약**

  ----------- ----------------------------------------- -------- ------------ ---------------------------- ----------------------------------
  **형식**    **스크립트**                              **텍스트** **이미지 추출** **주의사항**                **Confluence 출처 기록**
  HTML        refine\_html\_to\_md.py                   ✅        ✅            ac:image 태그 별도 처리     페이지 URL 자동 추출 가능
  PDF         pdf\_to\_md.py + extract\_images.py       ✅        ✅            스캔본은 OCR 필요           첨부 페이지 URL 수동 기재
  PPTX        pptx\_to\_md.py                           ✅        ✅ (삽입 이미지) 벡터 도형은 LibreOffice   첨부 페이지 URL 수동 기재 (§4.0.1)
  XLSX        xlsx\_to\_md.py                           ✅        ✅ (삽입 이미지) 차트는 데이터 테이블로    첨부 페이지 URL 수동 기재 (§4.0.1)
  DOCX        docx\_to\_md.py                           ✅        ✅            스타일 없으면 헤딩 미생성   첨부 페이지 URL 수동 기재 (§4.0.1)
  TXT         txt\_to\_md.py                            ✅        ❌            frontmatter 추가만          해당 없음 (독립 파일)
  MD          md\_normalize.py                          ✅ (유지)  ❌ (링크 점검만) frontmatter 정규화만     해당 없음 (독립 파일)
  ----------- ----------------------------------------- -------- ------------ ---------------------------- ----------------------------------

