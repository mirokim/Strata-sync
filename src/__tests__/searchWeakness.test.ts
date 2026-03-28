/**
 * 검색 약점 시나리오 50건 (301-350)
 *
 * ▶ toBe(false) — 현재 엔진(BM25+TF-IDF)이 처리 못하는 것을 문서화.
 *   엔진이 개선되면 toBe(true)로 바꾸는 회귀 지표로 사용.
 * ▶ toBe(true)  — 현재 엔진이 처리할 수 있어야 하는 경계/우회 케이스.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { parseMarkdownFile } from '@/lib/markdownParser'
import { TfIdfIndex } from '@/lib/graphAnalysis'
import { directVaultSearch } from '@/lib/graphRAG'
import type { LoadedDocument } from '@/types'
import { useVaultStore } from '@/stores/vaultStore'
import { useGraphStore } from '@/stores/graphStore'

const VAULT = 'C:/dev2/refined_vault'
let allDocs: LoadedDocument[] = []
let tfidf: TfIdfIndex

function loadDir(dir: string, prefix: string): LoadedDocument[] {
  if (!fs.existsSync(dir)) return []
  const docs: LoadedDocument[] = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue
    const abs = path.join(dir, e.name)
    try {
      const c = fs.readFileSync(abs, 'utf-8'), s = fs.statSync(abs)
      docs.push(parseMarkdownFile({ relativePath: prefix ? `${prefix}/${e.name}` : e.name, absolutePath: abs, content: c, mtime: s.mtimeMs }))
    } catch { /* skip */ }
  }
  return docs
}

beforeAll(() => {
  allDocs = [
    ...loadDir(VAULT, ''),
    ...loadDir(path.join(VAULT, 'active'), 'active'),
    ...loadDir(path.join(VAULT, '.archive'), '.archive'),
    ...loadDir(path.join(VAULT, 'jira'), 'jira'),
    ...loadDir(path.join(VAULT, 'jira', 'attachments_md'), 'jira/attachments_md'),
  ]
  console.log(`\n📂 볼트 (Jira 포함): ${allDocs.length}개`)
  useVaultStore.setState({ loadedDocuments: allDocs })
  useGraphStore.setState({ links: [] })
  tfidf = new TfIdfIndex()
  tfidf.build(allDocs)
}, 120_000)

// ── Engine ─────────────────────────────────────────────────────────────────

interface H { rank: number; fn: string; score: number; ln: number; src: string }

function S(q: string, n = 10): H[] {
  const dh = directVaultSearch(q, n * 2), bh = tfidf.search(q, n * 2)
  const dm = new Map(dh.map(h => [h.doc_id, h.score])), bm = new Map(bh.map(h => [h.docId, h.score]))
  const ids = new Set([...dm.keys(), ...bm.keys()])
  const m: { id: string; s: number; src: string }[] = []
  for (const id of ids) {
    const d = dm.get(id) ?? 0, b = bm.get(id) ?? 0
    m.push({ id, s: d > 0 && b > 0 ? Math.max(d, b) + Math.min(d, b) * 0.3 : Math.max(d, b), src: d > 0 && b > 0 ? 'both' : d > 0 ? 'direct' : 'bm25' })
  }
  m.sort((a, b) => b.s - a.s)
  const dm2 = new Map(allDocs.map(d => [d.id, d]))
  return m.slice(0, n).map((x, i) => {
    const doc = dm2.get(x.id)!
    return { rank: i + 1, fn: doc.filename, score: Math.round(x.s * 1000) / 1000, ln: (doc.rawContent?.split('\n').length ?? 0), src: x.src }
  })
}

function P(q: string, r: H[]) {
  console.log(`\n🔍 "${q}"`)
  console.log(`${'#'.padStart(2)} | ${'Score'.padStart(6)} | ${'Src'.padStart(6)} | ${'Ln'.padStart(5)} | Filename`)
  for (const h of r.slice(0, 5))
    console.log(`${String(h.rank).padStart(2)} | ${String(h.score).padStart(6)} | ${h.src.padStart(6)} | ${String(h.ln).padStart(5)} | ${h.fn.slice(0, 70)}`)
}

function has(r: H[], n: number, ...kw: string[]) {
  return r.slice(0, n).some(h => kw.some(k => h.fn.toLowerCase().includes(k.toLowerCase())))
}
function chk(label: string, ok: boolean) { console.log(`  ${ok ? '✅' : '❌'} ${label}`); return ok }

// ── A. 동의어 테스트 (301-315) ──────────────────────────────────────────────
// 실제 실행 결과 기반으로 정리:
//   [강점확인] = 동의어처럼 보이지만 body content 매칭으로 실제로 찾힘
//   [진짜약점] = vitest·MCP 양쪽 모두 못 찾음
//   [엔진차이] = vitest에선 찾지만 MCP에선 못 찾음 (토크나이저 차이)
//   [vitest약점] = MCP에선 찾지만 vitest에선 못 찾음

describe('검색 약점 시나리오 50건 (301-350)', () => {

  it('301 [강점확인] 음향 효과 → 사운드 관련 문서', () => {
    const r = S('음향 효과'); P('음향 효과', r)
    // 예상은 실패였으나 body에 "사운드/음향" 혼용 문서 다수 → 실제로 찾힘
    expect(chk('Top-5 사운드 관련', has(r, 5, '사운드'))).toBe(true)
  })

  it('302 [강점확인] 적 AI → 몬스터 구현 (body: 적 언급)', () => {
    const r = S('적 AI 구현'); P('적 AI 구현', r)
    // Epic 본문에 "적" 직접 등장 → vitest·MCP 양쪽 4위 이내
    expect(chk('Top-5 몬스터', has(r, 5, '몬스터'))).toBe(true)
  })

  it('303 [동의어✓] 아이템 조합 → 레시피 시스템 (조합→레시피 동의어 확장)', () => {
    const r = S('아이템 조합 제작'); P('아이템 조합 제작', r)
    // 조합→레시피,크래프팅 동의어 확장 후 Top-5 진입
    expect(chk('Top-5 레시피 (동의어 확장)', has(r, 5, '레시피'))).toBe(true)
  })

  it('304 [강점확인] 이동 점프 → 조작 시스템 (조작 키워드 overlap)', () => {
    const r = S('캐릭터 이동 점프 조작'); P('캐릭터 이동 점프 조작', r)
    expect(chk('Top-5 조작', has(r, 5, '조작'))).toBe(true)
  })

  it('305 [동의어✓] 배틀로얄 → BR모드 (배틀로얄→br,br모드 동의어 확장)', () => {
    const r = S('배틀로얄 맵 작업'); P('배틀로얄 맵 작업', r)
    // 배틀로얄→br,br모드 동의어 확장 후 BR모드 파일 Top-5 진입
    expect(chk('Top-5 BR모드 (동의어 확장)', has(r, 5, 'BR모드', 'BR맵', '배틀로얄'))).toBe(true)
  })

  it('306 [강점확인] 겨울 사막 → 얼어붙은 사막 (사막+테마 overlap)', () => {
    const r = S('겨울 사막 테마 제작'); P('겨울 사막 테마 제작', r)
    // "사막"+"테마"+"제작" 키워드 overlap으로 얼어붙은 사막 Epic 상위권
    expect(chk('Top-5 얼어붙은 사막', has(r, 5, '얼어붙은'))).toBe(true)
  })

  it('307 [강점확인] 캐릭터 능력 → 캐릭터 스킬 구현 (능력 body 매칭)', () => {
    const r = S('캐릭터 능력 시스템'); P('캐릭터 능력 시스템', r)
    // "캐릭터" 파일명 매칭으로 스킬 구현 Epic 진입
    expect(chk('Top-5 스킬 구현', has(r, 5, '스킬'))).toBe(true)
  })

  it('308 [엔진차이] 전용 서버 → 데디케이트 (vitest 찾음, MCP 못 찾음)', () => {
    const r = S('전용 서버 독립 설계'); P('전용 서버 독립 설계', r)
    // vitest TF-IDF는 찾지만 MCP BM25는 못 찾음 — 토크나이저 차이
    expect(chk('Top-5 데디케이트 (vitest 한정)', has(r, 5, '데디케이트'))).toBe(true)
  })

  it('309 [강점확인] BGM 효과음 → 사운드 Epic (BGM 본문 언급)', () => {
    const r = S('BGM 효과음 구현'); P('BGM 효과음 구현', r)
    expect(chk('Top-5 사운드', has(r, 5, '사운드'))).toBe(true)
  })

  it('310 [강점확인] 인게임 영상 컷 → 컷씬 (컷 키워드 overlap)', () => {
    const r = S('인게임 영상 장면 컷'); P('인게임 영상 장면 컷', r)
    // "컷" 키워드가 컷씬/컷신 파일 매칭 — vitest·MCP 모두 찾힘
    expect(chk('Top-5 컷씬', has(r, 5, '컷씬', '컷신'))).toBe(true)
  })

  it('311 [강점확인] 보스 패턴 → 몬스터 구현 (보스몬스터 본문)', () => {
    const r = S('보스몬스터 패턴 구현'); P('보스몬스터 패턴 구현', r)
    expect(chk('Top-5 몬스터', has(r, 5, '몬스터'))).toBe(true)
  })

  it('312 [강점확인] 인벤토리 스킬 장착 → 레시피 (YAML 수정 후 3위 진입)', () => {
    const r = S('인벤토리 스킬 장착'); P('인벤토리 스킬 장착', r)
    // related 필드 YAML 수정 전: vitest 탈락 / 수정 후: 3위 진입
    expect(chk('Top-5 레시피', has(r, 5, '레시피'))).toBe(true)
  })

  it('313 [동의어✓] 마법사 눈뜨기 → 마법사 각성 (눈뜨기→각성 동의어 확장)', () => {
    const r = S('마법사 눈뜨기 성장'); P('마법사 눈뜨기 성장', r)
    // 눈뜨기→각성 동의어 확장 후 각성 문서 Top-5 진입
    expect(chk('Top-5 각성 (동의어 확장)', has(r, 5, '각성'))).toBe(true)
  })

  it('314 [진짜약점⚠] 세계 지도 → 월드맵 (지도≠world_map)', () => {
    const r = S('세계 지도 지형 맵'); P('세계 지도 지형 맵', r)
    expect(chk('Top-5에 world_map 없음 (진짜 약점)', !has(r, 5, 'world_map', '월드맵'))).toBe(true)
  })

  it('315 [엔진차이] 마법 재료 제작 → 레시피 (vitest 찾음, MCP 못 찾음)', () => {
    const r = S('마법 재료를 모아 새 능력 제작'); P('마법 재료를 모아 새 능력 제작', r)
    // vitest에서는 크래프팅 문서 찾히나 MCP에서는 정례보고 문서에 밀림
    expect(chk('Top-5 크래프팅 (vitest 한정)', has(r, 5, '레시피', '크래프팅', '크래프트'))).toBe(true)
  })

  // ── B. 개념 설명형 약점 (316-322) ────────────────────────────────────────
  // 정답 문서의 키워드가 없는 자연어 질문 — 대부분 실패 예상

  it('316 [개념⚠] AI가 플레이어를 추적하고 공격하는 적 → 몬스터 구현', () => {
    const r = S('AI가 플레이어를 추적하고 공격하는 적'); P('AI 추적 공격 적', r)
    expect(chk('Top-5에 몬스터 없음 (예상)', !has(r, 5, '몬스터'))).toBe(true)
  })

  it('317 [동의어✓] 게임 로비 배경음악 → 사운드 Epic (배경음악→사운드 동의어 확장)', () => {
    const r = S('게임 로비에서 흘러나오는 배경음악'); P('게임 로비 배경음악', r)
    // 배경음악→bgm,사운드 동의어 확장 후 사운드 문서 Top-5 진입
    expect(chk('Top-5 사운드 (동의어 확장)', has(r, 5, '사운드'))).toBe(true)
  })

  it('318 [개념⚠] 마지막 1명이 살아남는 전투 모드 → BR모드', () => {
    const r = S('마지막 1명이 살아남는 전투 모드'); P('마지막 1명 생존 전투', r)
    expect(chk('Top-5에 BR모드 없음 (예상)', !has(r, 5, 'BR모드', 'BR맵', '배틀로얄'))).toBe(true)
  })

  it('319 [개념⚠] 캐릭터가 강력한 스킬을 새로 배우는 과정 → 마법사 각성', () => {
    const r = S('캐릭터가 강력한 스킬을 새로 배우는 성장 과정'); P('강한 스킬 새로 배우기', r)
    expect(chk('Top-5에 각성 없음 (예상)', !has(r, 5, '각성'))).toBe(true)
  })

  it('320 [강점확인] 클라서버 분리 → 데디케이트 (클라서버 키워드 body 매칭)', () => {
    const r = S('클라이언트와 서버가 분리되어 독립적으로 동작하는 구조'); P('클라 서버 분리 독립', r)
    // "클라서버" 키워드가 Epic 파일명에 포함 → 2위 진입
    expect(chk('Top-5 데디케이트', has(r, 5, '데디케이트'))).toBe(true)
  })

  it('321 [강점확인] 얼음 눈 사막 → 얼어붙은 사막 (사막+R&D overlap)', () => {
    const r = S('얼음과 눈으로 덮인 사막 환경 그래픽 R&D'); P('얼음 눈 사막 환경 R&D', r)
    expect(chk('Top-5 얼어붙은 사막', has(r, 5, '얼어붙은'))).toBe(true)
  })

  it('322 [개념⚠] 매직크래프트 상호작용 이펙트 연출 → 매직빌드 Epic', () => {
    const r = S('마법 이펙트와 오브젝트 상호작용 연출'); P('마법 이펙트 상호작용 연출', r)
    // 매직빌드 Epic은 "마법 상호작용 구현 및 연출"이지만 쿼리 어휘가 분산됨
    expect(chk('Top-5 매직빌드', has(r, 5, '매직빌드', '마법 상호작용'))).toBe(true)
  })

  // ── C. 오타/변형 (323-330) ────────────────────────────────────────────────
  // 한국어 형태소 기반 BM25의 오타 내성 실측 결과

  it('323 [강점확인] 메직빌드 → 매직빌드 (자소 유사성으로 매칭)', () => {
    const r = S('메직빌드 마법 연출'); P('메직빌드 마법 연출', r)
    // 메직(ㅔ)→매직(ㅐ) 1글자 차이인데 vitest·MCP 모두 2위권 매칭
    expect(chk('Top-5 매직빌드', has(r, 5, '매직빌드'))).toBe(true)
  })

  it('324 [진짜약점⚠] 레서피 시스탬 → 레시피 시스템 (2글자 오타 한계)', () => {
    const r = S('레서피 시스탬 구현'); P('레서피 시스탬 구현', r)
    // 레서피+시스탬 동시 오타 — 양쪽 엔진 모두 실패
    expect(chk('Top-5에 레시피 없음 (진짜 약점)', !has(r, 5, '레시피'))).toBe(true)
  })

  it('325 [강점확인] 몬스타 → 몬스터 (형태소 유사성)', () => {
    const r = S('몬스타 AI 구현'); P('몬스타 AI 구현', r)
    expect(chk('Top-5 몬스터', has(r, 5, '몬스터'))).toBe(true)
  })

  it('326 [강점확인] 카트씬 → 컷씬 (컷 키워드 overlap)', () => {
    const r = S('카트씬 연출 작업'); P('카트씬 연출 작업', r)
    expect(chk('Top-5 컷씬', has(r, 5, '컷씬', '컷신'))).toBe(true)
  })

  it('327 [엔진차이] 사운트 → 사운드 (vitest 찾음, MCP Epic 못 찾음)', () => {
    const r = S('사운트 BGM 구현'); P('사운트 BGM 구현', r)
    // vitest TF-IDF: 사운드 Epic 찾음 / MCP: 효과음 관련 active 문서만 반환
    expect(chk('Top-5 사운드 (vitest 한정)', has(r, 5, '사운드'))).toBe(true)
  })

  it('328 [강점확인] 스켈 → 스킬 (형태소 유사성)', () => {
    const r = S('스켈 구현 Epic'); P('스켈 구현 Epic', r)
    expect(chk('Top-5 스킬', has(r, 5, '스킬'))).toBe(true)
  })

  it('329 [엔진차이] 아이탬 → 아이템 (vitest 찾음, MCP 못 찾음)', () => {
    const r = S('아이탬 컨텐츠 Epic'); P('아이탬 컨텐츠 Epic', r)
    // vitest: 아이템 Epic 찾음 / MCP: 아이템 파일 Top-5 미진입
    expect(chk('Top-5 아이템 (vitest 한정)', has(r, 5, '아이템'))).toBe(true)
  })

  it('330 [강점확인] 캐릭타 스켈 → 캐릭터 스킬 (복합 오타도 부분 매칭)', () => {
    const r = S('캐릭타 스켈 구현'); P('캐릭타 스켈 구현', r)
    expect(chk('Top-5 스킬/캐릭터', has(r, 5, '스킬', '캐릭터'))).toBe(true)
  })

  // ── D. 우회 표현 / Jira 메타 (331-343) ───────────────────────────────────
  // 키워드가 문서 내부에 있거나 직접 매칭되는 경우 — PASS 가능

  it('331 [우회] 10월 회장님 보고 → 회장님 보고 Epic', () => {
    const r = S('10월 회장님 보고 작업'); P('10월 회장님 보고 작업', r)
    expect(chk('Top-5 회장님 보고', has(r, 5, '회장', '보고'))).toBe(true)
  })

  it('332 [우회] 7월 여름 구현 → 7월 작업 Epic', () => {
    const r = S('7월 구현 작업'); P('7월 구현 작업', r)
    expect(chk('Top-5 7월', has(r, 5, '7월'))).toBe(true)
  })

  it('333 [우회] 개발팀 2022 → 개발팀 작업_2022년', () => {
    const r = S('개발팀 2022년 작업'); P('개발팀 2022년 작업', r)
    expect(chk('Top-5 개발팀 2022', has(r, 5, '2022', '개발팀'))).toBe(true)
  })

  it('334 [우회] 아트팀 2021 → Release 아트팀 작업_2021년', () => {
    const r = S('아트팀 2021년 작업'); P('아트팀 2021년 작업', r)
    expect(chk('Top-5 아트팀 2021', has(r, 5, '2021', '아트팀'))).toBe(true)
  })

  it('335 [강점확인] SGEATF-1369 → 레시피 (YAML 수정 후 1위 — 문서 인덱싱 복구)', () => {
    const r = S('SGEATF-1369'); P('SGEATF-1369', r)
    // YAML related 필드 파싱 오류 수정 후 레시피 Epic 정상 인덱싱 → 1위
    expect(chk('Top-3 레시피', has(r, 3, '레시피'))).toBe(true)
  })

  it('336 [Jira키] SGEATF-160 → 매직빌드 마법 상호작용', () => {
    const r = S('SGEATF-160'); P('SGEATF-160', r)
    expect(chk('Top-3 매직빌드', has(r, 3, '매직빌드', '마법 상호작용'))).toBe(true)
  })

  it('337 [Jira키] SGEATF-2023 → 데디케이트 서버', () => {
    const r = S('SGEATF-2023'); P('SGEATF-2023', r)
    expect(chk('Top-3 데디케이트', has(r, 3, '데디케이트', '클라서버'))).toBe(true)
  })

  it('338 [우회⚠] M11 다음 마일스톤 → M12', () => {
    const r = S('M11 다음 마일스톤'); P('M11 다음 마일스톤', r)
    // "다음"이라는 순서 관계 → BM25가 처리 불가, M11 문서가 상위에 올 가능성 높음
    expect(chk('Top-3에 M12 없음 (예상)', !has(r, 3, 'M12'))).toBe(true)
  })

  it('339 [우회] 2018년 이전 릴리즈 → Release 2018 이전 작업', () => {
    const r = S('2018년 이전 릴리즈 작업'); P('2018년 이전 릴리즈 작업', r)
    expect(chk('Top-5 2018 이전', has(r, 5, '2018', '이전'))).toBe(true)
  })

  it('340 [우회] M7 스펙 → Epic M7 SPEC & 개발팀 M7', () => {
    const r = S('M7 스펙 작업'); P('M7 스펙 작업', r)
    expect(chk('Top-5 M7', has(r, 5, 'M7'))).toBe(true)
  })

  it('341 [우회] 장기 과제 목록 → Release 장기과제', () => {
    const r = S('장기 과제 목록'); P('장기 과제 목록', r)
    expect(chk('Top-5 장기과제', has(r, 5, '장기과제', '장기'))).toBe(true)
  })

  it('342 [우회] 플레이 콘티 문서 → Release 플레이 콘티', () => {
    const r = S('플레이 콘티 기획'); P('플레이 콘티 기획', r)
    expect(chk('Top-5 플레이 콘티', has(r, 5, '콘티'))).toBe(true)
  })

  it('343 [우회] 보고자료 릴리즈 → Release 보고자료', () => {
    const r = S('보고자료 릴리즈'); P('보고자료 릴리즈', r)
    expect(chk('Top-5 보고자료', has(r, 5, '보고자료', '보고'))).toBe(true)
  })

  // ── E. 경계 케이스 / 고유명사 (344-350) ──────────────────────────────────

  it('344 [경계] 캐릭터 목소리 대본 → Voice 대본 파일들', () => {
    const r = S('캐릭터 목소리 대본'); P('캐릭터 목소리 대본', r)
    // "대본" 직접 매칭 → PASS 가능, "목소리"→Voice는 약점
    expect(chk('Top-5 대본', has(r, 5, '대본', 'Voice'))).toBe(true)
  })

  it('345 [경계] 에타큐브 v5 → 에타큐브 아이디어 문서', () => {
    const r = S('에타큐브 v5 아이디어'); P('에타큐브 v5 아이디어', r)
    // 고유명사 에타큐브 → 유일한 문서 직접 히트
    expect(chk('Top-3 에타큐브', has(r, 3, '에타큐브'))).toBe(true)
  })

  it('346 [경계] 우로보 레이드 보스 전투 → 레이드우로보', () => {
    const r = S('우로보 레이드 보스 전투'); P('우로보 레이드 보스 전투', r)
    expect(chk('Top-3 우로보', has(r, 3, '우로보'))).toBe(true)
  })

  it('347 [경계] 노든 세력 관계도 → 노든 세력 및 캐릭터 관계도', () => {
    const r = S('노든 세력 관계도'); P('노든 세력 관계도', r)
    expect(chk('Top-3 노든 관계도', has(r, 3, '노든'))).toBe(true)
  })

  it('348 [경계] 미하일 컨셉 아트 레퍼런스 → 미하일 컨셉 레퍼런스', () => {
    const r = S('미하일 컨셉 아트 레퍼런스'); P('미하일 컨셉 아트 레퍼런스', r)
    expect(chk('Top-3 미하일', has(r, 3, '미하일'))).toBe(true)
  })

  it('349 [경계⚠] 컷씬 vs 컷신 — 두 표기 모두 허용', () => {
    const r1 = S('컷씬 연출'); P('컷씬 연출', r1)
    const r2 = S('컷신 연출'); P('컷신 연출', r2)
    const pass1 = has(r1, 5, '컷씬', '컷신', 'cutscene')
    const pass2 = has(r2, 5, '컷씬', '컷신', 'cutscene')
    console.log(`  컷씬 검색: ${pass1 ? '✅' : '❌'} / 컷신 검색: ${pass2 ? '✅' : '❌'}`)
    // 두 표기 중 하나라도 작동해야 함
    expect(pass1 || pass2).toBe(true)
  })

  it('350 [경계⚠] 보르후 스킬 컨셉 → Voice대본 vs 스킬 컨셉 자료 (중의적 검색)', () => {
    const r = S('보르후 스킬 컨셉'); P('보르후 스킬 컨셉', r)
    // "보르후"는 Voice대본과 스킬컨셉자료 두 파일에 있음 — 어느 쪽이 상위에 오는지 확인
    const hasVoice = has(r, 5, '보르후')
    const fileNames = r.slice(0, 5).map(h => h.fn)
    console.log(`  보르후 관련 Top-5: ${fileNames.slice(0, 3).join(', ')}`)
    expect(chk('Top-5에 보르후 문서', hasVoice)).toBe(true)
  })
})
