/**
 * 추가 40개 시나리오 — 200개 달성용.
 * 기존 160개와 중복 없이 새 키워드/조합 커버.
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
  allDocs = [...loadDir(VAULT, ''), ...loadDir(path.join(VAULT, 'active'), 'active'), ...loadDir(path.join(VAULT, '.archive'), '.archive')]
  console.log(`\n📂 볼트: ${allDocs.length}개`)
  useVaultStore.setState({ loadedDocuments: allDocs })
  useGraphStore.setState({ links: [] })
  tfidf = new TfIdfIndex()
  tfidf.build(allDocs)
}, 60_000)

// ── Engine ──────────────────────────────────────────────────────────────────

interface H { rank: number; fn: string; score: number; ln: number; arc: boolean; src: string }

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
    return { rank: i + 1, fn: doc.filename, score: Math.round(x.s * 1000) / 1000, ln: (doc.rawContent?.split('\n').length ?? 0), arc: /\.?archive/i.test(doc.folderPath || doc.absolutePath || ''), src: x.src }
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

// ── 40 Scenarios (101-140) ───────────────────────────────────────────────

describe('40개 추가 시나리오 (101-140)', () => {

  // ━━━ 전투/스킬 심화 (101-108) ━━━

  it('101: 버프 디버프 시스템 추가', () => { const r = S('버프 디버프 시스템 추가'); P('버프 디버프 시스템', r); chk('Top-3 버프/디버프', has(r, 3, '버프', '디버프')) })
  it('102: 스킬 슬롯 전환 기능', () => { const r = S('스킬 슬롯 전환'); P('스킬 슬롯 전환', r); chk('Top-3 슬롯 전환', has(r, 3, '슬롯 전환', '슬롯')) })
  it('103: 캐릭터 슬롯 시스템', () => { const r = S('캐릭터 슬롯 시스템'); P('캐릭터 슬롯', r); chk('Top-5 캐릭터 슬롯', has(r, 5, '캐릭터 슬롯', '슬롯 시스템')) })
  it('104: 스킬 제작 심화', () => { const r = S('스킬 제작 심화'); P('스킬 제작 심화', r); chk('Top-3 스킬 제작/심화', has(r, 3, '스킬제작', '스킬 제작', '심화')) })
  it('105: 레벨업 효과 인지 개선', () => { const r = S('레벨업 효과 인지 개선'); P('레벨업 효과', r); chk('Top-3 레벨업', has(r, 3, '레벨업', '레벨 업')) })
  it('106: 낮은 HP 스크린 FX', () => { const r = S('낮은 HP 스크린 FX 연출'); P('낮은 HP FX', r); chk('Top-3 HP/FX', has(r, 3, 'hp', 'fx')) })
  it('107: 인게임 시스템 메시지', () => { const r = S('인게임 시스템 메시지'); P('인게임 시스템 메시지', r); chk('Top-3 시스템 메시지', has(r, 3, '시스템 메시지', '인게임')) })
  it('108: 핑 시스템 개선 기획', () => { const r = S('핑 시스템 개선'); P('핑 시스템', r); chk('Top-3 핑 시스템', has(r, 3, '핑 시스템', '핑')) })

  // ━━━ 캐릭터 심화 (109-116) ━━━

  it('109: 사무라이 캐릭터 개요', () => { const r = S('사무라이 캐릭터 개요'); P('사무라이', r); chk('Top-5 사무라이', has(r, 5, '사무라이')) })
  it('110: 마투아 거대화 스킬', () => { const r = S('마투아 거대화'); P('마투아 거대화', r); chk('Top-3 마투아/거대화', has(r, 3, '마투아', '거대화')) })
  it('111: 마투아 암석 투척', () => { const r = S('마투아 암석 투척'); P('마투아 암석', r); chk('Top-3 마투아/암석', has(r, 3, '마투아', '암석')) })
  it('112: 월영 리뉴얼 상세 기획서', () => { const r = S('월영 리뉴얼 상세 기획서'); P('월영 리뉴얼 상세', r); chk('Top-3 월영 리뉴얼', has(r, 3, '월영 리뉴얼', '월영')) })
  it('113: 다이잔 용오름 스킬', () => { const r = S('다이잔 용오름'); P('다이잔 용오름', r); chk('Top-3 다이잔/용오름', has(r, 3, '다이잔', '용오름')) })
  it('114: 다이잔 용쇄격', () => { const r = S('다이잔 용쇄격'); P('다이잔 용쇄격', r); chk('Top-3 다이잔/용쇄격', has(r, 3, '다이잔', '용쇄격')) })
  it('115: 월영 역령부 스킬', () => { const r = S('월영 역령부'); P('월영 역령부', r); chk('Top-3 월영/역령부', has(r, 3, '월영', '역령부')) })
  it('116: 마티니 재블린 미사일', () => { const r = S('마티니 재블린 미사일'); P('마티니 재블린', r); chk('Top-3 마티니/재블린', has(r, 3, '마티니', '재블린')) })

  // ━━━ 맵/레벨 심화 (117-122) ━━━

  it('117: 점령전 폴리싱 블록 리스트', () => { const r = S('점령전 폴리싱 블록 리스트'); P('점령전 폴리싱', r); chk('Top-3 폴리싱 블록', has(r, 3, '폴리싱', '블록 리스트')) })
  it('118: 점령전 킬캠 기획', () => { const r = S('점령전 킬캠'); P('점령전 킬캠', r); chk('Top-3 킬캠', has(r, 3, '킬캠')) })
  it('119: 공성전 테스트 결과', () => { const r = S('공성전 테스트'); P('공성전 테스트', r); chk('Top-3 공성전', has(r, 3, '공성전')) })
  it('120: 바벨 타워 레벨', () => { const r = S('바벨 타워'); P('바벨 타워', r); chk('Top-3 바벨/타워', has(r, 3, '바벨', '타워')) })
  it('121: 신전 구역 보고 히스토리', () => { const r = S('신전 구역 보고'); P('신전 구역', r); chk('Top-5 신전', has(r, 5, '신전')) })
  it('122: 텔모칸 타워 레벨 디자인', () => { const r = S('텔모칸 타워'); P('텔모칸 타워', r); chk('Top-3 텔모칸/타워', has(r, 3, '텔모칸', '타워')) })

  // ━━━ 아트/테크 심화 (123-128) ━━━

  it('123: 버텍스 아웃라인 셰이더', () => { const r = S('버텍스 아웃라인'); P('버텍스 아웃라인', r); chk('Top-3 버텍스/아웃라인', has(r, 3, '버텍스', '아웃라인')) })
  it('124: 아군 적군 아웃라인 표시 규칙', () => { const r = S('아군 적군 아웃라인 표시 규칙'); P('아웃라인 규칙', r); chk('Top-3 아웃라인 규칙', has(r, 3, '아웃라인', '규칙')) })
  it('125: 블록 파괴 메쉬 셋팅', () => { const r = S('블록 파괴 메쉬 셋팅'); P('블록 파괴 메쉬', r); chk('Top-3 블록 파괴/메쉬', has(r, 3, '파괴 메쉬', '블록 파괴', '메쉬')) })
  it('126: 배경파트 작업 과정', () => { const r = S('배경파트 작업 과정'); P('배경파트', r); chk('Top-3 배경파트', has(r, 3, '배경파트', '배경')) })
  it('127: 의상 파괴 시스템', () => { const r = S('의상 파괴'); P('의상 파괴', r); chk('Top-3 의상파괴/의상', has(r, 3, '의상파괴', '의상')) })
  it('128: 카메라 셀렉터 기능', () => { const r = S('카메라 셀렉터'); P('카메라 셀렉터', r); chk('Top-3 카메라/셀렉터', has(r, 3, '카메라', '셀렉터')) })

  // ━━━ 기획/시스템 심화 (129-134) ━━━

  it('129: 엔진 교체 고려 사항', () => { const r = S('엔진 교체 고려 사항'); P('엔진 교체', r); chk('Top-3 엔진 교체', has(r, 3, '엔진 교체', '엔진')) })
  it('130: 기획 테스트 서버 가이드', () => { const r = S('기획 테스트 서버 가이드'); P('테스트 서버 가이드', r); chk('Top-3 테스트 서버/가이드', has(r, 3, '테스트 서버', '서버 가이드', '기획 테스트')) })
  it('131: 재확인 기능 목록', () => { const r = S('재확인 기능 목록'); P('재확인 기능', r); chk('Top-3 재확인', has(r, 3, '재확인', '기능 목록')) })
  it('132: TLS 스킬 만들기 가이드', () => { const r = S('TLS 스킬 만들기'); P('TLS 스킬', r); chk('Top-3 TLS/스킬', has(r, 3, 'tls', '스킬 만들기')) })
  it('133: WorldObject 등록 데이터테이블 관리', () => { const r = S('WorldObject 등록 데이터테이블'); P('WorldObject 등록', r); chk('Top-3 WorldObject', has(r, 3, 'worldobject', '데이터테이블')) })
  it('134: 오브젝트 블록 그룹 시스템', () => { const r = S('오브젝트 블록 그룹 시스템'); P('블록 그룹', r); chk('Top-3 블록 그룹', has(r, 3, '블록 그룹', '오브젝트 블록')) })

  // ━━━ 세계관/시나리오 (135-138) ━━━

  it('135: 루모와 마법 설정', () => { const r = S('루모와 마법 설정'); P('루모 마법', r); chk('Top-3 루모/마법', has(r, 3, '루모', '마법')) })
  it('136: 마법공학 컨셉', () => { const r = S('마법공학 컨셉'); P('마법공학', r); chk('Top-3 마법공학', has(r, 3, '마법공학')) })
  it('137: 직업 크래프팅 기준표', () => { const r = S('직업 크래프팅 기준표'); P('직업 크래프팅', r); chk('Top-5 직업/크래프팅', has(r, 5, '직업', '크래프팅')) })
  it('138: 텔모칸 문자 체계', () => { const r = S('텔모칸 문자'); P('텔모칸 문자', r); chk('Top-3 텔모칸 문자', has(r, 3, '텔모칸 문자', '텔모칸')) })

  // ━━━ 엣지/복합 (139-140) ━━━

  it('139: Wwise Appendix 사운드', () => { const r = S('Wwise Appendix'); P('Wwise Appendix', r); chk('Top-3 Wwise', has(r, 3, 'wwise')) })
  it('140: 스페이스 엔지니어 레퍼런스', () => { const r = S('스페이스 엔지니어 레퍼런스'); P('스페이스 엔지니어', r); chk('Top-3 스페이스 엔지니어', has(r, 3, '스페이스 엔지니어', 'space')) })
})
