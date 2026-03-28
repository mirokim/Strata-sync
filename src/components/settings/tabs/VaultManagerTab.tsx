/**
 * VaultManagerTab — Vault 파일 관리 및 데이터 정제 허브 (v3.14)
 *
 * 기본 뷰: 볼트 선택 + 현황 + 파이프라인 실행 + 스크립트 그리드
 * 고급 뷰: 품질 체크리스트 (§16) + 정기 일정 (§17.2)
 */

import { useState, useMemo } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useVaultStore } from '@/stores/vaultStore'
import { calcBodyCharCount, hasImageOrTable, hasWikiLink, computeStats, type VaultStats } from '@/lib/vaultStats'
import { SCRIPTS, PIPELINE_ORDER, type ScriptDef } from '@/lib/scriptConfig'
import VaultSelector from '../VaultSelector'

// ── Preload API ────────────────────────────────────────────────────────────────

declare const confluenceAPI: {
  runScript: (
    scriptName: string,
    args: string[],
  ) => Promise<{ stdout: string; stderr: string; exitCode: number }>
}


// §16 품질 체크리스트
const QUALITY_CHECKLIST = [
  { id: 'no-link',      label: '링크 없는 파일 비율',             target: '0%',                   script: 'check_quality.py' },
  { id: 'ghost-pr',     label: 'Ghost 노드 PageRank 상위 점유',   target: '없음',                  script: 'check_quality.py' },
  { id: 'heading',      label: '섹션 헤딩(##) 보유 비율',         target: '80% 이상',              script: 'check_quality.py' },
  { id: 'frontmatter',  label: 'Frontmatter 누락 파일',           target: '없음',                  script: 'audit_and_fix.py' },
  { id: 'source-url',   label: 'source URL 누락 (외부 변환 파일)', target: '없음',                 script: 'check_quality.py' },
  { id: 'img-naming',   label: '이미지 파일명 규칙 위반',         target: '없음',                  script: 'check_links.py' },
  { id: 'thin-file',    label: '300자 미만 초소형 단독 파일',     target: '없음',                  script: 'scan_cleanup.py' },
  { id: 'nested-link',  label: '중첩 wikilink (inject 버그)',     target: '없음',                  script: 'audit_and_fix.py' },
  { id: 'broken-img',   label: '깨진 이미지 링크 (![[]])',        target: '없음',                  script: 'check_links.py' },
  { id: 'chief-tag',    label: 'chief 태그 누락 피드백 파일',     target: '없음',                  script: 'gen_year_hubs.py' },
  { id: 'obsidian',     label: '.obsidian/app.json 존재',         target: '있음',                  script: null },
  { id: 'current',      label: 'currentSituation.md 최신 여부',   target: '2주 이내',              script: 'check_outdated.py' },
  { id: 'index',        label: '_index.md 파일 수 일치',          target: 'active/ 파일 수 동일',  script: 'gen_index.py' },
  { id: 'orphan',       label: '고아 첨부 파일',                  target: '없음',                  script: 'check_quality.py' },
]

// §17.2 정기 정제 주기
const PERIODIC_TASKS = [
  {
    period: '매주',
    tasks: [
      { script: 'gen_index.py',      label: '_index.md 재생성' },
      { script: 'check_outdated.py', label: 'currentSituation.md 업데이트 여부 확인' },
    ],
  },
  {
    period: '매월',
    tasks: [
      { script: 'check_quality.py',    label: '링크 없는 파일 점검' },
      { script: 'enhance_wikilinks.py', label: '고립 노드 링크 강화' },
      { script: 'gen_year_hubs.py',    label: '연도 허브 갱신' },
    ],
  },
  {
    period: '분기',
    tasks: [
      { script: 'scan_cleanup.py',     label: 'ghost 노드·빈 문서 정리' },
      { script: 'check_outdated.py',   label: 'outdated 문서 아카이브 검토' },
      { script: 'strengthen_links.py', label: 'PageRank 최적화 점검' },
    ],
  },
]

const CATEGORY_COLOR: Record<ScriptDef['category'], string> = {
  fix:   '#f59e0b',
  link:  '#60a5fa',
  index: '#a78bfa',
  check: 'var(--color-success)',
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function VaultManagerTab() {
  const vaultPath    = useVaultStore(s => s.vaultPath)
  const loadedDocuments = useVaultStore(s => s.loadedDocuments)

  const [log, setLog]                       = useState<string[]>([])
  const [runningScript, setRunningScript]   = useState<string | null>(null)
  const [pipelineRunning, setPipelineRunning] = useState(false)
  const [scriptResults, setScriptResults]   = useState<Record<string, 'ok' | 'error'>>({})
  const [showAdvanced, setShowAdvanced]     = useState(false)
  const [checkedItems, setCheckedItems]     = useState<Set<string>>(new Set())

  const hasAPI  = typeof confluenceAPI !== 'undefined'
  const isBusy  = pipelineRunning || runningScript !== null

  const stats = useMemo<VaultStats | null>(() => {
    if (!loadedDocuments) return null
    return computeStats(loadedDocuments)
  }, [loadedDocuments])

  const addLog = (msg: string) => setLog(prev => [...prev, msg])

  const runScript = async (script: ScriptDef) => {
    if (!vaultPath || !hasAPI || isBusy) return
    setRunningScript(script.name)
    addLog(`> ${script.name}`)
    try {
      const r = await confluenceAPI.runScript(script.name, script.buildArgs(vaultPath))
      if (r.exitCode === 0) {
        r.stdout.trim().split('\n').filter(Boolean).slice(0, 8).forEach(l => addLog(`  ${l}`))
        addLog('  완료')
        setScriptResults(prev => ({ ...prev, [script.name]: 'ok' }))
      } else {
        addLog(`  오류 (exit ${r.exitCode}): ${r.stderr.slice(0, 300)}`)
        setScriptResults(prev => ({ ...prev, [script.name]: 'error' }))
      }
    } catch (e) {
      addLog(`  실패: ${e instanceof Error ? e.message : String(e)}`)
      setScriptResults(prev => ({ ...prev, [script.name]: 'error' }))
    }
    setRunningScript(null)
  }

  const runPipeline = async () => {
    if (!vaultPath || !hasAPI || isBusy) return
    setPipelineRunning(true)
    setScriptResults({})  // 이전 실행 결과 초기화
    addLog('전체 파이프라인 시작 (§17.1.4)')
    for (const scriptName of PIPELINE_ORDER) {
      const script = SCRIPTS.find(s => s.name === scriptName)
      if (!script) continue
      addLog(`[${PIPELINE_ORDER.indexOf(scriptName) + 1}/${PIPELINE_ORDER.length}] ${script.name}`)
      try {
        const r = await confluenceAPI.runScript(script.name, script.buildArgs(vaultPath))
        if (r.exitCode === 0) {
          r.stdout.trim().split('\n').filter(Boolean).slice(0, 4).forEach(l => addLog(`  ${l}`))
          addLog('  완료')
          setScriptResults(prev => ({ ...prev, [script.name]: 'ok' }))
        } else {
          addLog(`  오류 (exit ${r.exitCode}): ${r.stderr.slice(0, 150)}`)
          setScriptResults(prev => ({ ...prev, [script.name]: 'error' }))
        }
      } catch (e) {
        addLog(`  실패: ${e instanceof Error ? e.message : String(e)}`)
        setScriptResults(prev => ({ ...prev, [script.name]: 'error' }))
      }
    }
    addLog('파이프라인 완료')
    setPipelineRunning(false)
  }

  const canRun = Boolean(vaultPath) && hasAPI && !isBusy

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-5">

      {/* 볼트 선택 */}
      <section>
        <VaultSelector />
      </section>

      <div style={{ borderTop: '1px solid var(--color-border)' }} />

      {/* 볼트 현황 */}
      {stats && (
        <section>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8,
          }}>
            {[
              { label: '전체 문서',    value: stats.total,       alert: false },
              { label: '스텁 (50자↓)',  value: stats.stubCount,  alert: stats.stubCount > 0 },
              { label: '초소형 (300자↓)', value: stats.thinCount, alert: stats.thinCount > 10 },
              { label: '링크 없음',    value: stats.noLinkCount, alert: stats.noLinkCount > 0 },
            ].map(item => (
              <div key={item.label} style={{
                padding: '10px 8px', borderRadius: 6, textAlign: 'center',
                background: 'var(--color-bg-surface)',
                border: `1px solid ${item.alert ? 'rgba(245,158,11,0.3)' : 'var(--color-border)'}`,
              }}>
                <div style={{
                  fontSize: 22, fontWeight: 700, lineHeight: 1,
                  color: item.alert ? '#f59e0b' : 'var(--color-text-primary)',
                }}>
                  {item.value}
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4, lineHeight: 1.3 }}>
                  {item.label}
                </div>
              </div>
            ))}
          </div>

          {/* currentSituation.md 상태 */}
          <div style={{
            marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '8px 12px', borderRadius: 6,
            background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)',
          }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                currentSituation.md
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                Graph RAG BFS 진입점 — 2주 이내 갱신 권장 (§14.1)
              </div>
            </div>
            <div style={{
              fontSize: 11, fontWeight: 600, paddingLeft: 12,
              color: stats.hasCurrentSituation ? 'var(--color-success)' : 'var(--color-error)',
            }}>
              {stats.hasCurrentSituation ? '존재' : '없음'}
            </div>
          </div>
        </section>
      )}

      <div style={{ borderTop: '1px solid var(--color-border)' }} />

      {/* 파이프라인 + 스크립트 실행 */}
      <section>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12,
        }}>
          <h3 style={{
            fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
            color: 'var(--color-text-muted)',
          }}>
            스크립트 실행
          </h3>
          <button
            onClick={runPipeline}
            disabled={!canRun}
            style={{
              fontSize: 12, padding: '6px 16px', borderRadius: 4, fontWeight: 600,
              background: canRun ? 'var(--color-accent)' : 'var(--color-bg-surface)',
              color: canRun ? '#fff' : 'var(--color-text-muted)',
              border: canRun ? 'none' : '1px solid var(--color-border)',
              cursor: canRun ? 'pointer' : 'not-allowed',
              opacity: pipelineRunning ? 0.7 : 1,
            }}
          >
            {pipelineRunning ? '실행 중…' : '전체 파이프라인 실행 (§17.1.4)'}
          </button>
        </div>

        {!hasAPI && (
          <p style={{ fontSize: 12, color: '#f59e0b', marginBottom: 10 }}>
            Electron 환경에서만 스크립트를 실행할 수 있습니다.
          </p>
        )}

        {/* 스크립트 그리드 (primary 항목) */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {SCRIPTS.filter(s => s.primary).map(script => {
            const isRunning = runningScript === script.name
            const result    = scriptResults[script.name]
            return (
              <div key={script.name} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 12px', borderRadius: 6,
                background: 'var(--color-bg-surface)',
                border: `1px solid ${
                  isRunning ? 'var(--color-accent)'
                  : result === 'ok' ? 'rgba(52,211,153,0.3)'
                  : result === 'error' ? 'rgba(248,113,113,0.3)'
                  : 'var(--color-border)'
                }`,
              }}>
                {/* 카테고리 도트 */}
                <div style={{
                  width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                  background: CATEGORY_COLOR[script.category],
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                    {script.label}
                    {result === 'ok' && <span style={{ marginLeft: 5, color: 'var(--color-success)', fontSize: 11 }}>완료</span>}
                    {result === 'error' && <span style={{ marginLeft: 5, color: 'var(--color-error)', fontSize: 11 }}>오류</span>}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2, lineHeight: 1.3 }}>
                    {script.desc}
                  </div>
                </div>
                <button
                  onClick={() => runScript(script)}
                  disabled={!canRun}
                  style={{
                    fontSize: 11, padding: '3px 10px', borderRadius: 3, flexShrink: 0,
                    background: isRunning ? 'var(--color-accent)' : 'var(--color-bg-hover)',
                    color: isRunning ? '#fff' : 'var(--color-text-secondary)',
                    border: '1px solid var(--color-border)',
                    cursor: canRun ? 'pointer' : 'not-allowed',
                    opacity: canRun || isRunning ? 1 : 0.4,
                  }}
                >
                  {isRunning ? '…' : '실행'}
                </button>
              </div>
            )
          })}
        </div>
      </section>

      {/* 실행 로그 */}
      {log.length > 0 && (
        <section>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              실행 로그
            </span>
            <button
              onClick={() => setLog([])}
              style={{ fontSize: 11, color: 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              지우기
            </button>
          </div>
          <div style={{
            background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)',
            borderRadius: 6, padding: '8px 12px', maxHeight: 160, overflowY: 'auto',
          }}>
            {log.map((line, i) => (
              <div key={i} style={{
                fontSize: 12, fontFamily: 'monospace', lineHeight: 1.7,
                color: line.includes('오류') || line.includes('실패') ? 'var(--color-error)'
                  : line.includes('완료') || line.includes('파이프라인') ? 'var(--color-success)'
                  : 'var(--color-text-secondary)',
              }}>
                {line}
              </div>
            ))}
          </div>
        </section>
      )}

      <div style={{ borderTop: '1px solid var(--color-border)' }} />

      {/* 고급 설정 토글 */}
      <section>
        <button
          onClick={() => setShowAdvanced(v => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, width: '100%',
            background: 'none', border: 'none', cursor: 'pointer', padding: 0,
          }}
        >
          {showAdvanced
            ? <ChevronDown size={14} style={{ color: 'var(--color-text-muted)' }} />
            : <ChevronRight size={14} style={{ color: 'var(--color-text-muted)' }} />
          }
          <span style={{
            fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
            color: 'var(--color-text-muted)',
          }}>
            고급
          </span>
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginLeft: 4, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
            나머지 스크립트 · 품질 체크리스트 · 정기 일정
          </span>
        </button>

        {showAdvanced && (
          <div className="flex flex-col gap-5" style={{ marginTop: 16 }}>

            {/* 나머지 스크립트 */}
            <div>
              <div style={{
                fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)',
                marginBottom: 8, letterSpacing: '0.04em',
              }}>
                추가 스크립트
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {SCRIPTS.filter(s => !s.primary).map(script => {
                  const isRunning = runningScript === script.name
                  const result    = scriptResults[script.name]
                  return (
                    <div key={script.name} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '9px 12px', borderRadius: 6,
                      background: 'var(--color-bg-surface)',
                      border: `1px solid ${
                        isRunning ? 'var(--color-accent)'
                        : result === 'ok' ? 'rgba(52,211,153,0.3)'
                        : result === 'error' ? 'rgba(248,113,113,0.3)'
                        : 'var(--color-border)'
                      }`,
                    }}>
                      <div style={{
                        width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                        background: CATEGORY_COLOR[script.category],
                      }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                          {script.label}
                          {result === 'ok' && <span style={{ marginLeft: 5, color: 'var(--color-success)', fontSize: 11 }}>완료</span>}
                          {result === 'error' && <span style={{ marginLeft: 5, color: 'var(--color-error)', fontSize: 11 }}>오류</span>}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2, lineHeight: 1.3 }}>
                          {script.desc}
                        </div>
                      </div>
                      <button
                        onClick={() => runScript(script)}
                        disabled={!canRun}
                        style={{
                          fontSize: 11, padding: '3px 10px', borderRadius: 3, flexShrink: 0,
                          background: isRunning ? 'var(--color-accent)' : 'var(--color-bg-hover)',
                          color: isRunning ? '#fff' : 'var(--color-text-secondary)',
                          border: '1px solid var(--color-border)',
                          cursor: canRun ? 'pointer' : 'not-allowed',
                          opacity: canRun || isRunning ? 1 : 0.4,
                        }}
                      >
                        {isRunning ? '…' : '실행'}
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--color-border)' }} />

            {/* 품질 체크리스트 §16 */}
            <div>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8,
              }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', letterSpacing: '0.04em' }}>
                  품질 체크리스트 (§16)
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                  {checkedItems.size}/{QUALITY_CHECKLIST.length} 완료
                  {checkedItems.size > 0 && (
                    <button
                      onClick={() => setCheckedItems(new Set())}
                      style={{ marginLeft: 8, fontSize: 11, color: 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
                    >
                      초기화
                    </button>
                  )}
                </div>
              </div>
              <div style={{ border: '1px solid var(--color-border)', borderRadius: 6, overflow: 'hidden' }}>
                {QUALITY_CHECKLIST.map((item, i) => {
                  const checked = checkedItems.has(item.id)
                  return (
                    <div
                      key={item.id}
                      onClick={() => setCheckedItems(prev => {
                        const next = new Set(prev)
                        checked ? next.delete(item.id) : next.add(item.id)
                        return next
                      })}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '16px 1fr auto auto',
                        alignItems: 'center',
                        gap: 10,
                        padding: '8px 12px',
                        cursor: 'pointer',
                        borderBottom: i < QUALITY_CHECKLIST.length - 1 ? '1px solid var(--color-border)' : 'none',
                        background: checked ? 'rgba(52,211,153,0.04)' : 'var(--color-bg-surface)',
                      }}
                    >
                      {/* 체크박스 */}
                      <div style={{
                        width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                        border: `1.5px solid ${checked ? 'var(--color-success)' : 'var(--color-border)'}`,
                        background: checked ? 'var(--color-success)' : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {checked && <span style={{ color: '#fff', fontSize: 9, lineHeight: 1 }}>✓</span>}
                      </div>
                      {/* 항목명 */}
                      <span style={{
                        fontSize: 12,
                        color: checked ? 'var(--color-text-muted)' : 'var(--color-text-primary)',
                        textDecoration: checked ? 'line-through' : 'none',
                      }}>
                        {item.label}
                      </span>
                      {/* 목표값 */}
                      <span style={{ fontSize: 11, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                        {item.target}
                      </span>
                      {/* 실행 버튼 */}
                      {item.script ? (
                        <button
                          onClick={e => {
                            e.stopPropagation()
                            const script = SCRIPTS.find(s => s.name === item.script)
                            if (script) runScript(script)
                          }}
                          disabled={!canRun}
                          style={{
                            fontSize: 11, padding: '2px 8px', borderRadius: 3,
                            background: 'var(--color-bg-hover)', color: 'var(--color-text-muted)',
                            border: '1px solid var(--color-border)',
                            cursor: canRun ? 'pointer' : 'not-allowed', opacity: canRun ? 1 : 0.4,
                          }}
                        >
                          {runningScript === item.script ? '…' : '실행'}
                        </button>
                      ) : (
                        <div style={{ width: 36 }} />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--color-border)' }} />

            {/* 정기 정제 주기 §17.2 */}
            <div>
              <div style={{
                fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)',
                marginBottom: 8, letterSpacing: '0.04em',
              }}>
                정기 정제 주기 (§17.2)
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {PERIODIC_TASKS.map(pt => (
                  <div key={pt.period} style={{
                    display: 'grid', gridTemplateColumns: '40px 1fr', gap: 10,
                    padding: '10px 12px', borderRadius: 6,
                    background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)',
                  }}>
                    <div style={{
                      fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)',
                      paddingTop: 2, letterSpacing: '0.04em',
                    }}>
                      {pt.period}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      {pt.tasks.map(task => {
                        const script = SCRIPTS.find(s => s.name === task.script)
                        const result = scriptResults[task.script]
                        return (
                          <div key={task.script} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', flex: 1 }}>
                              {task.label}
                            </span>
                            {result === 'ok'    && <span style={{ fontSize: 11, color: 'var(--color-success)' }}>완료</span>}
                            {result === 'error' && <span style={{ fontSize: 11, color: 'var(--color-error)' }}>오류</span>}
                            <button
                              onClick={() => script && runScript(script)}
                              disabled={!canRun || !script}
                              style={{
                                fontSize: 11, padding: '2px 10px', borderRadius: 3,
                                background: runningScript === task.script ? 'var(--color-accent)' : 'var(--color-bg-hover)',
                                color: runningScript === task.script ? '#fff' : 'var(--color-text-secondary)',
                                border: '1px solid var(--color-border)',
                                cursor: (canRun && script) ? 'pointer' : 'not-allowed',
                                opacity: (canRun && script) ? 1 : 0.4,
                              }}
                            >
                              {runningScript === task.script ? '…' : '실행'}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--color-border)' }} />

            {/* §18 최신성 버그 대응 */}
            <div style={{
              padding: '12px 14px', borderRadius: 6,
              background: 'rgba(245,158,11,0.05)', border: '1px solid rgba(245,158,11,0.25)',
            }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#f59e0b', marginBottom: 6 }}>
                §18 Graph RAG 최신성 버그 대응
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.7, marginBottom: 10 }}>
                AI가 오래된 정보를 최신이라 응답할 경우 아래 순서로 실행하세요.
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {[
                  { step: '1', script: 'check_outdated.py', note: 'outdated 파일·고립 신규 문서 점검' },
                  { step: '2', script: 'gen_year_hubs.py',  note: '최신 연도 허브 "최근 추가" 섹션 갱신' },
                  { step: '3', script: 'gen_index.py',      note: '_index.md 상단에 최신 문서 명시' },
                ].map(({ step, script: sname, note }) => {
                  const script = SCRIPTS.find(s => s.name === sname)
                  return (
                    <div key={sname} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{
                        fontSize: 11, fontWeight: 700, color: '#f59e0b',
                        width: 16, textAlign: 'right', flexShrink: 0,
                      }}>{step}</span>
                      <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', flex: 1 }}>
                        {note}
                      </span>
                      <button
                        onClick={() => script && runScript(script)}
                        disabled={!canRun || !script}
                        style={{
                          fontSize: 11, padding: '2px 10px', borderRadius: 3,
                          background: runningScript === sname ? 'var(--color-accent)' : 'var(--color-bg-hover)',
                          color: runningScript === sname ? '#fff' : 'var(--color-text-secondary)',
                          border: '1px solid var(--color-border)',
                          cursor: (canRun && script) ? 'pointer' : 'not-allowed',
                          opacity: (canRun && script) ? 1 : 0.4,
                        }}
                      >
                        {runningScript === sname ? '…' : '실행'}
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>

          </div>
        )}
      </section>

    </div>
  )
}
