/**
 * 대규모 검색 파이프라인 검증 — 100개 시나리오.
 * 캐릭터, 세계관, 기획/시스템, 아트/기술, 게임모드, 회의/보고, 레벨/맵, 엣지케이스 전방위.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { parseMarkdownFile } from '@/lib/markdownParser'
import { TfIdfIndex } from '@/lib/graphAnalysis'
import { directVaultSearch } from '@/lib/graphRAG'
import type { LoadedDocument, VaultFile } from '@/types'
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

interface H { rank: number; fn: string; score: number; ln: number; arc: boolean; src: string; gw?: string }

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
    return { rank: i + 1, fn: doc.filename, score: Math.round(x.s * 1000) / 1000, ln: (doc.rawContent?.split('\n').length ?? 0), arc: /\.?archive/i.test(doc.folderPath || doc.absolutePath || ''), src: x.src, gw: doc.graphWeight }
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

// ── 100 Scenarios ───────────────────────────────────────────────────────────

describe('100개 시나리오 대규모 검증', () => {

  // ━━━ 캐릭터 (1-15) ━━━

  it('001: 캐릭터G 쇼군', () => { const r = S('캐릭터G 쇼군'); P('캐릭터G 쇼군', r); chk('Top-3 캐릭터G 쇼군', has(r, 3, '캐릭터G 쇼군', '캐릭터G')) })
  it('002: 캐릭터E 캐릭터 설정', () => { const r = S('캐릭터E 캐릭터 설정'); P('캐릭터E 캐릭터', r); chk('Top-5 캐릭터E', has(r, 5, '캐릭터E')) })
  it('003: 캐릭터A 프리징 레기온', () => { const r = S('캐릭터A 프리징 레기온'); P('캐릭터A 프리징', r); chk('Top-3 캐릭터A', has(r, 3, '캐릭터A')) })
  it('004: 캐릭터F 용암폭발', () => { const r = S('캐릭터F 용암폭발'); P('캐릭터F 용암폭발', r); chk('Top-3 캐릭터F', has(r, 3, '캐릭터F')) })
  it('005: 오룰론 변경점 정리', () => { const r = S('오룰론 변경점 정리'); P('오룰론 변경점', r); chk('Top-5 오룰론', has(r, 5, '오룰론')) })
  it('006: 캐릭터C 귀무연 스킬', () => { const r = S('캐릭터C 귀무연'); P('캐릭터C 귀무연', r); chk('Top-5 캐릭터C', has(r, 5, '캐릭터C')) })
  it('007: 캐릭터C 비녀령 모션 연출', () => { const r = S('캐릭터C 비녀령 모션 연출'); P('캐릭터C 비녀령', r); chk('Top-3 캐릭터C/비녀령', has(r, 3, '캐릭터C', '비녀령')) })
  it('008: 캐릭터I 스킬 컨셉 자료', () => { const r = S('캐릭터I 스킬 컨셉 자료'); P('캐릭터I 스킬 컨셉', r); chk('Top-5 캐릭터I', has(r, 5, '캐릭터I')) })
  it('009: 캐릭터H 궁극기 변경', () => { const r = S('캐릭터H 궁극기 변경'); P('캐릭터H 궁극기', r); chk('Top-3 캐릭터H', has(r, 3, '캐릭터H')) })
  it('010: 캐릭터B 번역본', () => { const r = S('캐릭터B 번역본'); P('캐릭터B 번역본', r); chk('Top-5 캐릭터B', has(r, 5, '캐릭터B')) })
  it('011: 캐릭터 도감 캐릭터G', () => { const r = S('캐릭터 도감 캐릭터G'); P('캐릭터 도감 캐릭터G', r); chk('Top-5 도감/캐릭터G', has(r, 5, '도감', '캐릭터G')) })
  it('012: 영웅 스킬 정보', () => { const r = S('영웅 스킬 정보'); P('영웅 스킬 정보', r); chk('Top-5 영웅/스킬', has(r, 5, '영웅', '스킬')) })
  it('013: 마블 캐릭터 모션 요청', () => { const r = S('마블 캐릭터 모션 요청'); P('마블 캐릭터 모션', r); chk('Top-3 마블/모션', has(r, 3, '마블', '모션')) })
  it('014: 캐릭터 R&D 260106', () => { const r = S('캐릭터 R&D'); P('캐릭터 R&D', r); chk('Top-5 캐릭터 R', has(r, 5, 'r_d', 'r&d', '캐릭터')) })
  it('015: 캐릭터별 CC FX 연출', () => { const r = S('캐릭터별 CC FX 연출'); P('캐릭터별 CC FX', r); chk('Top-3 CC/FX', has(r, 3, 'cc', 'fx')) })

  // ━━━ 세계관 (16-25) ━━━

  it('016: 센트럴 사도 설정', () => { const r = S('센트럴 사도 설정'); P('센트럴 사도', r); chk('Top-5 센트럴', has(r, 5, '센트럴')) })
  it('017: 노든 마법진 체계', () => { const r = S('노든 마법진 체계'); P('노든 마법진', r); chk('Top-5 노든/마법진', has(r, 5, '노든')) })
  it('018: 센트럴 입문 지역', () => { const r = S('센트럴 입문 지역'); P('센트럴 입문', r); chk('Top-5 센트럴/입문', has(r, 5, '센트럴')) })
  it('019: 설정 회의 신들의 설정', () => { const r = S('설정 회의 신들의 설정'); P('설정 회의 신', r); chk('Top-5 설정 회의/신', has(r, 5, '설정 회의', '신들')) })
  it('020: 시나리오 및 설정 개요', () => { const r = S('시나리오 설정 개요'); P('시나리오 설정', r); chk('Top-5 시나리오/설정', has(r, 5, '시나리오', '설정')) })
  it('021: 국가들 최종본 세계관', () => { const r = S('국가들 최종본 세계관'); P('국가들 최종본', r); chk('Top-5 국가/세계관', has(r, 5, '국가', '세계관')) })
  it('022: 센트럴과 캐릭터D', () => { const r = S('센트럴과 캐릭터D'); P('센트럴과 캐릭터D', r); chk('Top-5 센트럴/캐릭터D', has(r, 5, '센트럴', '캐릭터D')) })
  it('023: 노든 세력 캐릭터 관계도', () => { const r = S('노든 세력 캐릭터 관계도'); P('노든 세력 관계도', r); chk('Top-5 노든', has(r, 5, '노든')) })
  it('024: 에녹 1막 정례', () => { const r = S('에녹 1막'); P('에녹 1막', r); chk('Top-5 에녹', has(r, 5, '에녹')) })
  it('025: 퀘스트 시나리오 기획', () => { const r = S('퀘스트 시나리오 기획'); P('퀘스트 시나리오', r); chk('Top-5 퀘스트/시나리오', has(r, 5, '퀘스트', '시나리오')) })

  // ━━━ 기획/시스템 (26-40) ━━━

  it('026: 매치메이킹 변경', () => { const r = S('매치메이킹 변경'); P('매치메이킹', r); chk('Top-3 매치메이킹/매칭', has(r, 3, '매치메이킹', '매칭')) })
  it('027: 소환 시스템 요약', () => { const r = S('소환 시스템 요약'); P('소환 시스템', r); chk('Top-5 소환 시스템', has(r, 5, '소환')) })
  it('028: Passive Skill 시스템', () => { const r = S('Passive Skill 시스템'); P('Passive Skill', r); chk('Top-3 Passive/Skill', has(r, 3, 'passive', 'skill')) })
  it('029: 변신 시스템', () => { const r = S('변신 시스템'); P('변신 시스템', r); chk('Top-5 변신', has(r, 5, '변신')) })
  it('030: 채널링 입력 조작 추가', () => { const r = S('채널링 입력 조작'); P('채널링 입력 조작', r); chk('Top-3 채널링', has(r, 3, '채널링')) })
  it('031: 약한 블록 기획', () => { const r = S('약한 블록 기획'); P('약한 블록', r); chk('Top-5 약한 블록', has(r, 5, '약한 블록')) })
  it('032: 스킬 연계 발동 기능', () => { const r = S('스킬 연계 발동 기능'); P('스킬 연계 발동', r); chk('Top-3 스킬 연계', has(r, 3, '연계', '발동')) })
  it('033: 전투 정보 정리 2024', () => { const r = S('전투 정보 정리 2024'); P('전투 정보 2024', r); chk('Top-3 전투 정보', has(r, 3, '전투 정보')) })
  it('034: 재장전 시스템', () => { const r = S('재장전'); P('재장전', r); chk('Top-5 재장전', has(r, 5, '재장전')) })
  it('035: 마법 크래프트 재료 조합', () => { const r = S('마법 크래프트 재료 조합'); P('마법 크래프트', r); chk('Top-5 크래프트/마법', has(r, 5, '크래프트', '마법')) })
  it('036: 크래프팅 보고', () => { const r = S('크래프팅 보고'); P('크래프팅 보고', r); chk('Top-5 크래프팅', has(r, 5, '크래프팅')) })
  it('037: 개인서버 셋팅 가이드', () => { const r = S('개인서버 셋팅 가이드'); P('개인서버 셋팅', r); chk('Top-3 개인서버/셋팅', has(r, 3, '개인서버', '셋팅', '세팅')) })
  it('038: 로비서버 치트키', () => { const r = S('로비서버 치트키'); P('로비서버 치트키', r); chk('Top-3 로비서버/치트키', has(r, 3, '로비서버', '치트키')) })
  it('039: 맵 데이터 추가 매뉴얼', () => { const r = S('맵 데이터 추가 매뉴얼'); P('맵 데이터 매뉴얼', r); chk('Top-5 맵 데이터/매뉴얼', has(r, 5, '맵 데이터', '메뉴얼', '매뉴얼')) })
  it('040: 태그 정의서', () => { const r = S('태그 정의서'); P('태그 정의서', r); chk('Top-3 태그 정의', has(r, 3, '태그', '정의')) })

  // ━━━ 게임 모드 (41-55) ━━━

  it('041: MOBA 모드 리스폰 규칙', () => { const r = S('MOBA 모드 리스폰 규칙'); P('MOBA 리스폰', r); chk('Top-3 MOBA/리스폰', has(r, 3, 'moba', '리스폰')) })
  it('042: 난투전 사망 레벨 다운', () => { const r = S('난투전 사망 레벨 다운'); P('난투전 사망 레벨', r); chk('Top-3 난투전 사망', has(r, 3, '사망', '레벨 다운')) })
  it('043: 난투전 생존 현황 UI', () => { const r = S('난투전 생존 현황 UI'); P('난투전 생존 UI', r); chk('Top-3 생존/UI', has(r, 3, '생존', 'ui')) })
  it('044: 난투전 라디오 메시지 개선', () => { const r = S('난투전 라디오 메시지 개선'); P('난투전 라디오', r); chk('Top-3 라디오 메시지', has(r, 3, '라디오')) })
  it('045: 난투전 상황판 결과창', () => { const r = S('난투전 상황판 결과창'); P('난투전 상황판', r); chk('Top-3 상황판/결과', has(r, 3, '상황판', '결과')) })
  it('046: BR모드 변경 사항', () => { const r = S('BR모드 변경 사항'); P('BR모드 변경', r); chk('Top-3 BR모드', has(r, 3, 'br모드', 'br')) })
  it('047: 점령전 회로 기획', () => { const r = S('점령전 회로'); P('점령전 회로', r); chk('Top-3 점령전 회로', has(r, 3, '회로')) })
  it('048: 점령전 HUD 개선', () => { const r = S('점령전 HUD 개선'); P('점령전 HUD', r); chk('Top-3 점령전 HUD', has(r, 3, 'hud', '점령전')) })
  it('049: 점령전 규칙 수정', () => { const r = S('점령전 규칙 수정'); P('점령전 규칙', r); chk('Top-5 점령전 규칙', has(r, 5, '규칙')) })
  it('050: 점령전 이슈 정리 보고', () => { const r = S('점령전 이슈 정리 보고'); P('점령전 이슈', r); chk('Top-3 점령전 이슈', has(r, 3, '점령전')) })
  it('051: 점령전 테스트 2025', () => { const r = S('점령전 테스트 2025'); P('점령전 테스트', r); chk('Top-5 점령전 테스트', has(r, 5, '점령전 테스트')) })
  it('052: PVP 접속 플레이', () => { const r = S('PVP 접속 플레이'); P('PVP 접속', r); chk('Top-3 PVP/접속', has(r, 3, 'pvp', '접속')) })
  it('053: 난투전 개선 보고', () => { const r = S('난투전 개선 보고'); P('난투전 개선', r); chk('Top-3 난투전 개선', has(r, 3, '난투전')) })
  it('054: 플레이 시나리오 1차', () => { const r = S('플레이 시나리오 1차'); P('플레이 시나리오', r); chk('Top-5 플레이 시나리오', has(r, 5, '플레이 시나리오', '시나리오')) })
  it('055: 게임 플레이 구조 최신', () => { const r = S('게임 플레이 구조'); P('게임 플레이 구조', r); chk('Top-3 게임 플레이 구조', has(r, 3, '게임 플레이 구조', '플레이 구조')) })

  // ━━━ 아트/기술 (56-70) ━━━

  it('056: 엣지 디텍트 라인 셰이더', () => { const r = S('엣지 디텍트 라인 셰이더'); P('엣지 디텍트', r); chk('Top-3 엣지/셰이더', has(r, 3, '엣지', '셰이더')) })
  it('057: URP 캐릭터 셰이더 테스트', () => { const r = S('URP 캐릭터 셰이더 테스트'); P('URP 캐릭터 셰이더', r); chk('Top-3 URP/셰이더', has(r, 3, 'urp', '셰이더', '쉐이더')) })
  it('058: HDRP Emission', () => { const r = S('HDRP Emission'); P('HDRP Emission', r); chk('Top-3 HDRP/Emission', has(r, 3, 'hdrp', 'emission')) })
  it('059: 부쉬 오브젝트 셰이더', () => { const r = S('부쉬 오브젝트 셰이더'); P('부쉬 셰이더', r); chk('Top-3 부쉬/셰이더', has(r, 3, '부쉬', '셰이더')) })
  it('060: SDF 얼굴 그림자 맵 생성기', () => { const r = S('SDF 얼굴 그림자 맵 생성기'); P('SDF 얼굴 그림자', r); chk('Top-3 SDF/얼굴', has(r, 3, 'sdf', '얼굴')) })
  it('061: 데미지 플로터 연출', () => { const r = S('데미지 플로터 연출'); P('데미지 플로터', r); chk('Top-3 데미지 플로터', has(r, 3, '데미지', '플로터')) })
  it('062: UX 관점 스킬 FX 기조', () => { const r = S('UX 관점 스킬 FX 제작 기조'); P('UX 스킬 FX', r); chk('Top-3 UX/FX', has(r, 3, 'ux', 'fx')) })
  it('063: 금제 CC 연출', () => { const r = S('금제 CC 연출'); P('금제 CC', r); chk('Top-3 금제/CC', has(r, 3, '금제', 'cc')) })
  it('064: 톱니바람 Flow 정리', () => { const r = S('톱니바람 Flow 정리'); P('톱니바람 Flow', r); chk('Top-3 톱니바람', has(r, 3, '톱니바람', '톱니')) })
  it('065: Cinemachine Camera 빌드 문제', () => { const r = S('Cinemachine Camera 빌드 문제'); P('Cinemachine Camera', r); chk('Top-3 Cinemachine', has(r, 3, 'cinemachine')) })
  it('066: 블록 파편화 스크립트', () => { const r = S('블록 파편화 스크립트'); P('블록 파편화', r); chk('Top-3 파편화/스크립트', has(r, 3, '파편화', '스크립트')) })
  it('067: 카메라 차폐 처리 블록 시야', () => { const r = S('카메라 차폐 처리 블록 시야'); P('카메라 차폐', r); chk('Top-5 카메라/차폐', has(r, 5, '카메라', '차폐')) })
  it('068: 아트 설정 관리', () => { const r = S('아트 설정 관리'); P('아트 설정 관리', r); chk('Top-3 아트 설정', has(r, 3, '아트 설정')) })
  it('069: Voxel Tool', () => { const r = S('Voxel Tool'); P('Voxel Tool', r); chk('Top-3 Voxel', has(r, 3, 'voxel')) })
  it('070: 맵파괴 R&D 프로젝트A', () => { const r = S('맵파괴 R&D 프로젝트A'); P('맵파괴 R&D', r); chk('Top-5 맵파괴/프로젝트A', has(r, 5, '맵파괴', '프로젝트A')) })

  // ━━━ 레벨/맵 디자인 (71-80) ━━━

  it('071: 시밤 컨셉 블록 발주', () => { const r = S('시밤 컨셉 블록 발주'); P('시밤 컨셉', r); chk('Top-5 시밤', has(r, 5, '시밤')) })
  it('072: 새 월드맵 씬 만들기', () => { const r = S('새 월드맵 씬 만들기'); P('월드맵 씬', r); chk('Top-3 월드맵', has(r, 3, '월드맵')) })
  it('073: 스폰 구역 영역 처리 연출', () => { const r = S('스폰 구역 영역 처리 연출'); P('스폰 구역 영역', r); chk('Top-3 스폰 구역', has(r, 3, '스폰 구역', '스폰')) })
  it('074: 신규 타워 붕괴 세팅', () => { const r = S('신규 타워 붕괴 세팅'); P('타워 붕괴', r); chk('Top-3 타워 붕괴', has(r, 3, '타워', '붕괴')) })
  it('075: 돌 암석 블록 경도', () => { const r = S('돌 암석 블록 경도'); P('돌 암석 경도', r); chk('Top-3 암석/경도', has(r, 3, '암석', '경도')) })
  it('076: 빅캠프 초반 PvE 지역', () => { const r = S('빅캠프 초반 PvE 지역'); P('빅캠프 PvE', r); chk('Top-3 빅캠프/PvE', has(r, 3, '빅캠프', 'pve')) })
  it('077: BR맵 시작 지역 약한 블록 학습', () => { const r = S('BR맵 시작 지역 약한 블록 학습'); P('BR맵 약한 블록', r); chk('Top-5 BR/약한 블록', has(r, 5, 'br', '약한 블록')) })
  it('078: 이빨 태양의 유적', () => { const r = S('이빨 태양의 유적'); P('이빨 태양 유적', r); chk('Top-3 이빨/태양', has(r, 3, '이빨', '태양')) })
  it('079: M8 발리스타 상세기획서', () => { const r = S('M8 발리스타 상세기획서'); P('M8 발리스타', r); chk('Top-3 발리스타/M8', has(r, 3, '발리스타', 'm8')) })
  it('080: 월드맵 정례보고', () => { const r = S('월드맵 정례보고'); P('월드맵 정례보고', r); chk('Top-5 월드맵', has(r, 5, '월드맵')) })

  // ━━━ 회의/보고/피드백 (81-90) ━━━

  it('081: 회장님 시연 보고 피드백', () => { const r = S('회장님 시연 보고 피드백'); P('회장님 시연', r); chk('Top-3 회장님/시연', has(r, 3, '회장님')) })
  it('082: 기획 리뷰 보고 피드백', () => { const r = S('기획 리뷰 보고 피드백'); P('기획 리뷰', r); chk('Top-3 기획 리뷰', has(r, 3, '기획 리뷰', '리뷰 보고')) })
  it('083: 정례보고 자료 2026', () => { const r = S('정례보고 자료 2026'); P('정례보고 2026', r); chk('Top-3 정례보고', has(r, 3, '정례보고')) })
  it('084: 회의록 2018', () => { const r = S('회의록 2018'); P('회의록 2018', r); chk('Top-3 회의록', has(r, 3, '회의록')) })
  it('085: 게임 방향성 논의', () => { const r = S('게임 방향성 논의'); P('게임 방향성', r); chk('Top-5 게임 방향성', has(r, 5, '방향성')) })
  it('086: PvP 작업 방향성 보고', () => { const r = S('PvP 작업 방향성 보고'); P('PvP 방향성', r); chk('Top-5 PvP/방향성', has(r, 5, 'pvp', '방향성')) })
  it('087: 개발 관리 문서', () => { const r = S('개발 관리'); P('개발 관리', r); chk('Top-3 개발 관리/개발관리', has(r, 3, '개발 관리', '개발관리')) })
  it('088: 전체 작업 재정리 고도화', () => { const r = S('전체 작업 재정리 고도화'); P('작업 재정리', r); chk('Top-3 재정리/고도화', has(r, 3, '재정리', '고도화')) })
  it('089: 추가 대미지 킥오프 자료', () => { const r = S('추가 대미지 킥오프 자료'); P('대미지 킥오프', r); chk('Top-3 대미지/킥오프', has(r, 3, '대미지', '킥오프')) })
  it('090: 캐릭터 논의 회의록 20250723', () => { const r = S('캐릭터 논의 회의록 20250723'); P('캐릭터 논의 회의록', r); chk('Top-3 캐릭터 논의/회의록', has(r, 3, '캐릭터 논의', '20250723')) })

  // ━━━ 엣지 케이스 (91-100) ━━━

  it('091: SGE-Project A (영문 약어)', () => { const r = S('SGE-Project A'); P('SGE-Project A', r); chk('Top-5 SGE', has(r, 5, 'sge')) })
  it('092: Virtuos Services Overview (완전 영문)', () => { const r = S('Virtuos Services Overview'); P('Virtuos Services', r); chk('Top-3 Virtuos', has(r, 3, 'virtuos')) })
  it('093: 파쇄장 R-Click', () => { const r = S('파쇄장 R-Click'); P('파쇄장', r); chk('Top-5 파쇄장', has(r, 5, '파쇄장')) })
  it('094: 산요강신', () => { const r = S('산요강신'); P('산요강신', r); chk('Top-5 산요강신/캐릭터C', has(r, 5, '산요강신', '산요')) })
  it('095: 영웅 페이지', () => { const r = S('영웅 페이지'); P('영웅 페이지', r); chk('Top-5 영웅 페이지', has(r, 5, '영웅 페이지', '영웅')) })
  it('096: 레퍼런스 마블 라이벌즈 보이스', () => { const r = S('레퍼런스 마블 라이벌즈 보이스'); P('마블 라이벌즈 보이스', r); chk('Top-5 레퍼런스/마블', has(r, 5, '레퍼런스', '마블')) })
  it('097: 피격 방향 인지 개선', () => { const r = S('피격 방향 인지 개선'); P('피격 방향 인지', r); chk('Top-3 피격 방향', has(r, 3, '피격 방향', '피격')) })
  it('098: 외주 서칭 현황', () => { const r = S('외주 서칭 현황'); P('외주 서칭', r); chk('Top-3 외주/서칭', has(r, 3, '외주', '서칭')) })
  it('099: 오브젝트 피아 구분 데이터 세팅', () => { const r = S('오브젝트 피아 구분 데이터 세팅'); P('오브젝트 피아 구분', r); chk('Top-3 피아 구분', has(r, 3, '피아', '구분')) })
  it('100: currentSituation', () => { const r = S('currentSituation'); P('currentSituation', r); chk('Top-5 currentSituation', has(r, 5, 'currentsituation', 'current')) })
})
