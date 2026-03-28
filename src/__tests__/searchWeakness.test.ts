/**
 * Search weakness scenarios — 50 cases (301-350)
 *
 * ▶ toBe(false) — Documents what the current engine (BM25+TF-IDF) cannot handle.
 *   Used as a regression indicator: flip to toBe(true) when the engine improves.
 * ▶ toBe(true)  — Boundary/workaround cases the current engine should handle.
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
  console.log(`\n📂 Vault (incl. Jira): ${allDocs.length} docs`)
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

// ── A. Synonym tests (301-315) ──────────────────────────────────────────────
// Organized based on actual execution results:
//   [strength-confirmed] = Looks like a synonym gap but actually found via body content matching
//   [real-weakness]      = Neither vitest nor MCP can find it
//   [engine-diff]        = vitest finds it but MCP does not (tokenizer difference)
//   [vitest-weakness]    = MCP finds it but vitest does not

describe('Search weakness scenarios — 50 cases (301-350)', () => {

  it('301 [strength-confirmed] 음향 효과 → sound-related docs', () => {
    const r = S('음향 효과'); P('음향 효과', r)
    // Expected failure, but many docs mix "사운드/음향" in body → actually found
    expect(chk('Top-5 sound related', has(r, 5, '사운드'))).toBe(true)
  })

  it('302 [strength-confirmed] 적 AI → 몬스터 구현 (body mentions 적)', () => {
    const r = S('적 AI 구현'); P('적 AI 구현', r)
    // "적" appears directly in Epic body → within top 4 for both vitest and MCP
    expect(chk('Top-5 몬스터', has(r, 5, '몬스터'))).toBe(true)
  })

  it('303 [synonym-ok] 아이템 조합 → 레시피 시스템 (synonym expansion: 조합→레시피)', () => {
    const r = S('아이템 조합 제작'); P('아이템 조합 제작', r)
    // After synonym expansion 조합→레시피,크래프팅, enters Top-5
    expect(chk('Top-5 레시피 (synonym expansion)', has(r, 5, '레시피'))).toBe(true)
  })

  it('304 [strength-confirmed] 이동 점프 → 조작 시스템 (조작 keyword overlap)', () => {
    const r = S('캐릭터 이동 점프 조작'); P('캐릭터 이동 점프 조작', r)
    expect(chk('Top-5 조작', has(r, 5, '조작'))).toBe(true)
  })

  it('305 [synonym-ok] 배틀로얄 → BR모드 (synonym expansion: 배틀로얄→br,br모드)', () => {
    const r = S('배틀로얄 맵 작업'); P('배틀로얄 맵 작업', r)
    // After synonym expansion 배틀로얄→br,br모드, BR mode file enters Top-5
    expect(chk('Top-5 BR모드 (synonym expansion)', has(r, 5, 'BR모드', 'BR맵', '배틀로얄'))).toBe(true)
  })

  it('306 [strength-confirmed] 겨울 사막 → 얼어붙은 사막 (사막+테마 keyword overlap)', () => {
    const r = S('겨울 사막 테마 제작'); P('겨울 사막 테마 제작', r)
    // Keyword overlap of "사막"+"테마"+"제작" ranks frozen desert Epic high
    expect(chk('Top-5 얼어붙은 사막', has(r, 5, '얼어붙은'))).toBe(true)
  })

  it('307 [strength-confirmed] 캐릭터 능력 → 캐릭터 스킬 구현 (능력 body matching)', () => {
    const r = S('캐릭터 능력 시스템'); P('캐릭터 능력 시스템', r)
    // Filename matching on "캐릭터" brings skill implementation Epic into results
    expect(chk('Top-5 skill impl', has(r, 5, '스킬'))).toBe(true)
  })

  it('308 [engine-diff] 전용 서버 → 데디케이트 (vitest finds, MCP misses)', () => {
    const r = S('전용 서버 독립 설계'); P('전용 서버 독립 설계', r)
    // vitest TF-IDF finds it but MCP BM25 does not — tokenizer difference
    expect(chk('Top-5 데디케이트 (vitest only)', has(r, 5, '데디케이트'))).toBe(true)
  })

  it('309 [strength-confirmed] BGM 효과음 → 사운드 Epic (BGM mentioned in body)', () => {
    const r = S('BGM 효과음 구현'); P('BGM 효과음 구현', r)
    expect(chk('Top-5 사운드', has(r, 5, '사운드'))).toBe(true)
  })

  it('310 [strength-confirmed] 인게임 영상 컷 → 컷씬 (컷 keyword overlap)', () => {
    const r = S('인게임 영상 장면 컷'); P('인게임 영상 장면 컷', r)
    // "컷" keyword matches cutscene files — found by both vitest and MCP
    expect(chk('Top-5 컷씬', has(r, 5, '컷씬', '컷신'))).toBe(true)
  })

  it('311 [strength-confirmed] 보스 패턴 → 몬스터 구현 (보스몬스터 in body)', () => {
    const r = S('보스몬스터 패턴 구현'); P('보스몬스터 패턴 구현', r)
    expect(chk('Top-5 몬스터', has(r, 5, '몬스터'))).toBe(true)
  })

  it('312 [strength-confirmed] 인벤토리 스킬 장착 → 레시피 (enters rank 3 after YAML fix)', () => {
    const r = S('인벤토리 스킬 장착'); P('인벤토리 스킬 장착', r)
    // Before YAML related field fix: vitest miss / after fix: enters rank 3
    expect(chk('Top-5 레시피', has(r, 5, '레시피'))).toBe(true)
  })

  it('313 [synonym-ok] 마법사 눈뜨기 → 마법사 각성 (synonym expansion: 눈뜨기→각성)', () => {
    const r = S('마법사 눈뜨기 성장'); P('마법사 눈뜨기 성장', r)
    // After synonym expansion 눈뜨기→각성, awakening doc enters Top-5
    expect(chk('Top-5 각성 (synonym expansion)', has(r, 5, '각성'))).toBe(true)
  })

  it('314 [real-weakness] 세계 지도 → 월드맵 (지도≠world_map)', () => {
    const r = S('세계 지도 지형 맵'); P('세계 지도 지형 맵', r)
    expect(chk('Top-5 world_map absent (real weakness)', !has(r, 5, 'world_map', '월드맵'))).toBe(true)
  })

  it('315 [engine-diff] 마법 재료 제작 → 레시피 (vitest finds, MCP misses)', () => {
    const r = S('마법 재료를 모아 새 능력 제작'); P('마법 재료를 모아 새 능력 제작', r)
    // vitest finds crafting doc but MCP gets pushed down by regular report docs
    expect(chk('Top-5 크래프팅 (vitest only)', has(r, 5, '레시피', '크래프팅', '크래프트'))).toBe(true)
  })

  // ── B. Conceptual description weaknesses (316-322) ────────────────────────
  // Natural language queries without the target document's keywords — mostly expected to fail

  it('316 [concept-gap] AI가 플레이어를 추적하고 공격하는 적 → 몬스터 구현', () => {
    const r = S('AI가 플레이어를 추적하고 공격하는 적'); P('AI 추적 공격 적', r)
    expect(chk('Top-5 몬스터 absent (expected)', !has(r, 5, '몬스터'))).toBe(true)
  })

  it('317 [synonym-ok] 게임 로비 배경음악 → 사운드 Epic (synonym expansion: 배경음악→사운드)', () => {
    const r = S('게임 로비에서 흘러나오는 배경음악'); P('게임 로비 배경음악', r)
    // After synonym expansion 배경음악→bgm,사운드, sound doc enters Top-5
    expect(chk('Top-5 사운드 (synonym expansion)', has(r, 5, '사운드'))).toBe(true)
  })

  it('318 [concept-gap] 마지막 1명이 살아남는 전투 모드 → BR모드', () => {
    const r = S('마지막 1명이 살아남는 전투 모드'); P('마지막 1명 생존 전투', r)
    expect(chk('Top-5 BR모드 absent (expected)', !has(r, 5, 'BR모드', 'BR맵', '배틀로얄'))).toBe(true)
  })

  it('319 [concept-gap] 캐릭터가 강력한 스킬을 새로 배우는 과정 → 마법사 각성', () => {
    const r = S('캐릭터가 강력한 스킬을 새로 배우는 성장 과정'); P('강한 스킬 새로 배우기', r)
    expect(chk('Top-5 각성 absent (expected)', !has(r, 5, '각성'))).toBe(true)
  })

  it('320 [strength-confirmed] 클라서버 분리 → 데디케이트 (클라서버 keyword body matching)', () => {
    const r = S('클라이언트와 서버가 분리되어 독립적으로 동작하는 구조'); P('클라 서버 분리 독립', r)
    // "클라서버" keyword is in Epic filename → enters rank 2
    expect(chk('Top-5 데디케이트', has(r, 5, '데디케이트'))).toBe(true)
  })

  it('321 [strength-confirmed] 얼음 눈 사막 → 얼어붙은 사막 (사막+R&D overlap)', () => {
    const r = S('얼음과 눈으로 덮인 사막 환경 그래픽 R&D'); P('얼음 눈 사막 환경 R&D', r)
    expect(chk('Top-5 얼어붙은 사막', has(r, 5, '얼어붙은'))).toBe(true)
  })

  it('322 [concept-gap] 매직크래프트 상호작용 이펙트 연출 → 매직빌드 Epic', () => {
    const r = S('마법 이펙트와 오브젝트 상호작용 연출'); P('마법 이펙트 상호작용 연출', r)
    // MagicBuild Epic is about "magic interaction implementation and effects" but query vocabulary is dispersed
    expect(chk('Top-5 매직빌드', has(r, 5, '매직빌드', '마법 상호작용'))).toBe(true)
  })

  // ── C. Typos/Variations (323-330) ────────────────────────────────────────────
  // Empirical results of Korean morpheme-based BM25 typo tolerance

  it('323 [strength-confirmed] 메직빌드 → 매직빌드 (jamo similarity matching)', () => {
    const r = S('메직빌드 마법 연출'); P('메직빌드 마법 연출', r)
    // 메직(ㅔ)→매직(ㅐ) only 1 character diff, both vitest and MCP match within rank 2
    expect(chk('Top-5 매직빌드', has(r, 5, '매직빌드'))).toBe(true)
  })

  it('324 [real-weakness] 레서피 시스탬 → 레시피 시스템 (2-char typo limit)', () => {
    const r = S('레서피 시스탬 구현'); P('레서피 시스탬 구현', r)
    // Simultaneous typos in 레서피+시스탬 — both engines fail
    expect(chk('Top-5 레시피 absent (real weakness)', !has(r, 5, '레시피'))).toBe(true)
  })

  it('325 [strength-confirmed] 몬스타 → 몬스터 (morpheme similarity)', () => {
    const r = S('몬스타 AI 구현'); P('몬스타 AI 구현', r)
    expect(chk('Top-5 몬스터', has(r, 5, '몬스터'))).toBe(true)
  })

  it('326 [strength-confirmed] 카트씬 → 컷씬 (컷 keyword overlap)', () => {
    const r = S('카트씬 연출 작업'); P('카트씬 연출 작업', r)
    expect(chk('Top-5 컷씬', has(r, 5, '컷씬', '컷신'))).toBe(true)
  })

  it('327 [engine-diff] 사운트 → 사운드 (vitest finds, MCP Epic misses)', () => {
    const r = S('사운트 BGM 구현'); P('사운트 BGM 구현', r)
    // vitest TF-IDF: finds sound Epic / MCP: only returns active docs related to sound effects
    expect(chk('Top-5 사운드 (vitest only)', has(r, 5, '사운드'))).toBe(true)
  })

  it('328 [strength-confirmed] 스켈 → 스킬 (morpheme similarity)', () => {
    const r = S('스켈 구현 Epic'); P('스켈 구현 Epic', r)
    expect(chk('Top-5 스킬', has(r, 5, '스킬'))).toBe(true)
  })

  it('329 [engine-diff] 아이탬 → 아이템 (vitest finds, MCP misses)', () => {
    const r = S('아이탬 컨텐츠 Epic'); P('아이탬 컨텐츠 Epic', r)
    // vitest: finds item Epic / MCP: item file does not enter Top-5
    expect(chk('Top-5 아이템 (vitest only)', has(r, 5, '아이템'))).toBe(true)
  })

  it('330 [strength-confirmed] 캐릭타 스켈 → 캐릭터 스킬 (compound typos partially matched)', () => {
    const r = S('캐릭타 스켈 구현'); P('캐릭타 스켈 구현', r)
    expect(chk('Top-5 스킬/캐릭터', has(r, 5, '스킬', '캐릭터'))).toBe(true)
  })

  // ── D. Workaround expressions / Jira meta (331-343) ──────────────────────
  // Cases where keywords exist inside documents or match directly — PASS possible

  it('331 [workaround] 10월 회장님 보고 → 회장님 보고 Epic', () => {
    const r = S('10월 회장님 보고 작업'); P('10월 회장님 보고 작업', r)
    expect(chk('Top-5 회장님 보고', has(r, 5, '회장', '보고'))).toBe(true)
  })

  it('332 [workaround] 7월 여름 구현 → 7월 작업 Epic', () => {
    const r = S('7월 구현 작업'); P('7월 구현 작업', r)
    expect(chk('Top-5 7월', has(r, 5, '7월'))).toBe(true)
  })

  it('333 [workaround] 개발팀 2022 → 개발팀 작업_2022년', () => {
    const r = S('개발팀 2022년 작업'); P('개발팀 2022년 작업', r)
    expect(chk('Top-5 개발팀 2022', has(r, 5, '2022', '개발팀'))).toBe(true)
  })

  it('334 [workaround] 아트팀 2021 → Release 아트팀 작업_2021년', () => {
    const r = S('아트팀 2021년 작업'); P('아트팀 2021년 작업', r)
    expect(chk('Top-5 아트팀 2021', has(r, 5, '2021', '아트팀'))).toBe(true)
  })

  it('335 [strength-confirmed] SGEATF-1369 → 레시피 (rank 1 after YAML fix — doc indexing restored)', () => {
    const r = S('SGEATF-1369'); P('SGEATF-1369', r)
    // After fixing YAML related field parsing error, recipe Epic indexes correctly → rank 1
    expect(chk('Top-3 레시피', has(r, 3, '레시피'))).toBe(true)
  })

  it('336 [Jira-key] SGEATF-160 → 매직빌드 마법 상호작용', () => {
    const r = S('SGEATF-160'); P('SGEATF-160', r)
    expect(chk('Top-3 매직빌드', has(r, 3, '매직빌드', '마법 상호작용'))).toBe(true)
  })

  it('337 [Jira-key] SGEATF-2023 → 데디케이트 서버', () => {
    const r = S('SGEATF-2023'); P('SGEATF-2023', r)
    expect(chk('Top-3 데디케이트', has(r, 3, '데디케이트', '클라서버'))).toBe(true)
  })

  it('338 [workaround-fail] M11 다음 마일스톤 → M12', () => {
    const r = S('M11 다음 마일스톤'); P('M11 다음 마일스톤', r)
    // Sequential relationship via "다음" (next) → BM25 cannot handle this, M11 docs likely rank higher
    expect(chk('Top-3 M12 absent (expected)', !has(r, 3, 'M12'))).toBe(true)
  })

  it('339 [workaround] 2018년 이전 릴리즈 → Release 2018 이전 작업', () => {
    const r = S('2018년 이전 릴리즈 작업'); P('2018년 이전 릴리즈 작업', r)
    expect(chk('Top-5 2018 이전', has(r, 5, '2018', '이전'))).toBe(true)
  })

  it('340 [workaround] M7 스펙 → Epic M7 SPEC & 개발팀 M7', () => {
    const r = S('M7 스펙 작업'); P('M7 스펙 작업', r)
    expect(chk('Top-5 M7', has(r, 5, 'M7'))).toBe(true)
  })

  it('341 [workaround] 장기 과제 목록 → Release 장기과제', () => {
    const r = S('장기 과제 목록'); P('장기 과제 목록', r)
    expect(chk('Top-5 장기과제', has(r, 5, '장기과제', '장기'))).toBe(true)
  })

  it('342 [workaround] 플레이 콘티 문서 → Release 플레이 콘티', () => {
    const r = S('플레이 콘티 기획'); P('플레이 콘티 기획', r)
    expect(chk('Top-5 플레이 콘티', has(r, 5, '콘티'))).toBe(true)
  })

  it('343 [workaround] 보고자료 릴리즈 → Release 보고자료', () => {
    const r = S('보고자료 릴리즈'); P('보고자료 릴리즈', r)
    expect(chk('Top-5 보고자료', has(r, 5, '보고자료', '보고'))).toBe(true)
  })

  // ── E. Boundary cases / Proper nouns (344-350) ──────────────────────────────

  it('344 [boundary] 캐릭터 목소리 대본 → Voice 대본 파일들', () => {
    const r = S('캐릭터 목소리 대본'); P('캐릭터 목소리 대본', r)
    // "대본" direct match → PASS possible, "목소리"→Voice is a weakness
    expect(chk('Top-5 대본', has(r, 5, '대본', 'Voice'))).toBe(true)
  })

  it('345 [boundary] 에타큐브 v5 → 에타큐브 아이디어 문서', () => {
    const r = S('에타큐브 v5 아이디어'); P('에타큐브 v5 아이디어', r)
    // Proper noun 에타큐브 → direct hit on the only matching document
    expect(chk('Top-3 에타큐브', has(r, 3, '에타큐브'))).toBe(true)
  })

  it('346 [boundary] 우로보 레이드 보스 전투 → 레이드우로보', () => {
    const r = S('우로보 레이드 보스 전투'); P('우로보 레이드 보스 전투', r)
    expect(chk('Top-3 우로보', has(r, 3, '우로보'))).toBe(true)
  })

  it('347 [boundary] 노든 세력 관계도 → 노든 세력 및 캐릭터 관계도', () => {
    const r = S('노든 세력 관계도'); P('노든 세력 관계도', r)
    expect(chk('Top-3 노든 관계도', has(r, 3, '노든'))).toBe(true)
  })

  it('348 [boundary] 캐릭터E 컨셉 아트 레퍼런스 → 캐릭터E 컨셉 레퍼런스', () => {
    const r = S('캐릭터E 컨셉 아트 레퍼런스'); P('캐릭터E 컨셉 아트 레퍼런스', r)
    expect(chk('Top-3 캐릭터E', has(r, 3, '캐릭터E'))).toBe(true)
  })

  it('349 [boundary-edge] 컷씬 vs 컷신 — 두 표기 모두 허용', () => {
    const r1 = S('컷씬 연출'); P('컷씬 연출', r1)
    const r2 = S('컷신 연출'); P('컷신 연출', r2)
    const pass1 = has(r1, 5, '컷씬', '컷신', 'cutscene')
    const pass2 = has(r2, 5, '컷씬', '컷신', 'cutscene')
    console.log(`  컷씬 search: ${pass1 ? '✅' : '❌'} / 컷신 search: ${pass2 ? '✅' : '❌'}`)
    // At least one of the two spellings must work
    expect(pass1 || pass2).toBe(true)
  })

  it('350 [boundary-edge] 캐릭터I 스킬 컨셉 → Voice대본 vs 스킬 컨셉 자료 (ambiguous search)', () => {
    const r = S('캐릭터I 스킬 컨셉'); P('캐릭터I 스킬 컨셉', r)
    // "캐릭터I" exists in both Voice script and skill concept files — check which ranks higher
    const hasVoice = has(r, 5, '캐릭터I')
    const fileNames = r.slice(0, 5).map(h => h.fn)
    console.log(`  캐릭터I related Top-5: ${fileNames.slice(0, 3).join(', ')}`)
    expect(chk('Top-5 캐릭터I doc', hasVoice)).toBe(true)
  })
})
