# .tools — Graph RAG Vault 자동화 스크립트 모음

## 파이프라인 전체 흐름

```
downloaded_pages/  →  [pipeline.py]  →  refined_vault/active/  →  [품질 도구]
```

---

## 변환 파이프라인 (최초 실행)

| 스크립트 | §단계 | 설명 |
|---------|------|------|
| `pipeline.py` | §4 | HTML / PPTX / DOCX → MD 통합 실행 |
| `refine_html_to_md.py` | §4.1 | Confluence HTML → Obsidian MD |
| `pptx_to_md.py` | §4.3 | PPTX → MD (슬라이드별 섹션) |
| `docx_to_md.py` | §4.5 | DOCX → MD (스타일 기반 헤딩) |

## 정제·강화 도구

| 스크립트 | §단계 | 설명 |
|---------|------|------|
| `normalize_frontmatter.py` | §6 | 빈 tags 자동 분류, ## 개요 삽입, chief 태그 |
| `enhance_wikilinks.py` | §7 | 동일 태그 파일 간 클러스터 링크 주입 |
| `inject_keywords.py` | §9 | 캐릭터명/시스템명 → 첫 등장 wikilink 변환 |
| `gen_year_hubs.py` | §11 | 연도별 허브 파일 생성 (회의록_YYYY.md) |
| `gen_index.py` | §14 | _index.md + currentSituation.md 생성 |

## 유지보수 도구

| 스크립트 | §단계 | 설명 |
|---------|------|------|
| `check_quality.py` | §13 | 품질 감사 (고립 노드/태그/헤딩/깨진 링크) |
| `check_outdated.py` | §18 | 최신성 점검 (오래된 spec, archived 파일) |
| `fix_image_links.py` | 버그픽스 | 괄호 포함 파일명의 이미지 링크 복원 |
| `incremental_update.py` | §4+ | 신규 HTML 증분 변환 + 파이프라인 자동 실행 |

---

## 빠른 시작

```bash
# 1. 최초 변환 (HTML+PPTX+DOCX)
python pipeline.py --step all \
  --src /path/to/downloaded_pages \
  --vault /path/to/refined_vault

# 2. 정제
python normalize_frontmatter.py /path/refined_vault/active
python enhance_wikilinks.py /path/refined_vault/active
python inject_keywords.py /path/refined_vault/active

# 3. 허브/인덱스 생성
python gen_year_hubs.py /path/refined_vault/active
python gen_index.py /path/refined_vault/active

# 4. 품질 감사
python check_quality.py /path/refined_vault/active \
  --attachments /path/refined_vault/attachments --verbose

# 5. 이후 신규 파일 추가 시
python incremental_update.py \
  --src /path/downloaded_pages /path/downloaded_pages2 \
  --vault /path/refined_vault \
  --scripts /path/refined_vault/.manual/scripts \
  --full-pipeline
```
