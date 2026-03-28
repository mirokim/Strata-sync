/**
 * VaultManagerTab — Vault file management and data refinement hub (v3.14)
 *
 * Default view: vault selection + status + pipeline execution + script grid
 * Advanced view: quality checklist (§16) + periodic schedule (§17.2)
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


// §16 Quality Checklist
const QUALITY_CHECKLIST = [
  { id: 'no-link',      label: 'Files without links ratio',               target: '0%',                      script: 'check_quality.py' },
  { id: 'ghost-pr',     label: 'Ghost node PageRank top occupancy',       target: 'None',                    script: 'check_quality.py' },
  { id: 'heading',      label: 'Section heading (##) coverage',           target: '80%+',                    script: 'check_quality.py' },
  { id: 'frontmatter',  label: 'Missing frontmatter files',               target: 'None',                    script: 'audit_and_fix.py' },
  { id: 'source-url',   label: 'Missing source URL (external files)',      target: 'None',                   script: 'check_quality.py' },
  { id: 'img-naming',   label: 'Image filename rule violations',          target: 'None',                    script: 'check_links.py' },
  { id: 'thin-file',    label: 'Standalone files under 300 chars',        target: 'None',                    script: 'scan_cleanup.py' },
  { id: 'nested-link',  label: 'Nested wikilink (inject bug)',            target: 'None',                    script: 'audit_and_fix.py' },
  { id: 'broken-img',   label: 'Broken image links (![[]])',              target: 'None',                    script: 'check_links.py' },
  { id: 'chief-tag',    label: 'Feedback files missing chief tag',        target: 'None',                    script: 'gen_year_hubs.py' },
  { id: 'obsidian',     label: '.obsidian/app.json exists',               target: 'Yes',                     script: null },
  { id: 'current',      label: 'currentSituation.md freshness',           target: 'Within 2 weeks',          script: 'check_outdated.py' },
  { id: 'index',        label: '_index.md file count match',              target: 'Same as active/ count',   script: 'gen_index.py' },
  { id: 'orphan',       label: 'Orphan attachment files',                 target: 'None',                    script: 'check_quality.py' },
]

// §17.2 Periodic Refinement Cycle
const PERIODIC_TASKS = [
  {
    period: 'Weekly',
    tasks: [
      { script: 'gen_index.py',      label: 'Regenerate _index.md' },
      { script: 'check_outdated.py', label: 'Check currentSituation.md update status' },
    ],
  },
  {
    period: 'Monthly',
    tasks: [
      { script: 'check_quality.py',    label: 'Inspect files without links' },
      { script: 'enhance_wikilinks.py', label: 'Strengthen isolated node links' },
      { script: 'gen_year_hubs.py',    label: 'Update year hubs' },
    ],
  },
  {
    period: 'Quarterly',
    tasks: [
      { script: 'scan_cleanup.py',     label: 'Clean up ghost nodes and empty docs' },
      { script: 'check_outdated.py',   label: 'Review outdated document archives' },
      { script: 'strengthen_links.py', label: 'PageRank optimization check' },
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
        addLog('  Done')
        setScriptResults(prev => ({ ...prev, [script.name]: 'ok' }))
      } else {
        addLog(`  Error (exit ${r.exitCode}): ${r.stderr.slice(0, 300)}`)
        setScriptResults(prev => ({ ...prev, [script.name]: 'error' }))
      }
    } catch (e) {
      addLog(`  Failed: ${e instanceof Error ? e.message : String(e)}`)
      setScriptResults(prev => ({ ...prev, [script.name]: 'error' }))
    }
    setRunningScript(null)
  }

  const runPipeline = async () => {
    if (!vaultPath || !hasAPI || isBusy) return
    setPipelineRunning(true)
    setScriptResults({})  // Reset previous results
    addLog('Full pipeline started (§17.1.4)')
    for (const scriptName of PIPELINE_ORDER) {
      const script = SCRIPTS.find(s => s.name === scriptName)
      if (!script) continue
      addLog(`[${PIPELINE_ORDER.indexOf(scriptName) + 1}/${PIPELINE_ORDER.length}] ${script.name}`)
      try {
        const r = await confluenceAPI.runScript(script.name, script.buildArgs(vaultPath))
        if (r.exitCode === 0) {
          r.stdout.trim().split('\n').filter(Boolean).slice(0, 4).forEach(l => addLog(`  ${l}`))
          addLog('  Done')
          setScriptResults(prev => ({ ...prev, [script.name]: 'ok' }))
        } else {
          addLog(`  Error (exit ${r.exitCode}): ${r.stderr.slice(0, 150)}`)
          setScriptResults(prev => ({ ...prev, [script.name]: 'error' }))
        }
      } catch (e) {
        addLog(`  Failed: ${e instanceof Error ? e.message : String(e)}`)
        setScriptResults(prev => ({ ...prev, [script.name]: 'error' }))
      }
    }
    addLog('Pipeline complete')
    setPipelineRunning(false)
  }

  const canRun = Boolean(vaultPath) && hasAPI && !isBusy

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-5">

      {/* Vault selection */}
      <section>
        <VaultSelector />
      </section>

      <div style={{ borderTop: '1px solid var(--color-border)' }} />

      {/* Vault status */}
      {stats && (
        <section>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8,
          }}>
            {[
              { label: 'Total Docs',        value: stats.total,       alert: false },
              { label: 'Stubs (<50 chars)', value: stats.stubCount,  alert: stats.stubCount > 0 },
              { label: 'Thin (<300 chars)', value: stats.thinCount, alert: stats.thinCount > 10 },
              { label: 'No Links',          value: stats.noLinkCount, alert: stats.noLinkCount > 0 },
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

          {/* currentSituation.md status */}
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
                Graph RAG BFS entry point — refresh recommended within 2 weeks (§14.1)
              </div>
            </div>
            <div style={{
              fontSize: 11, fontWeight: 600, paddingLeft: 12,
              color: stats.hasCurrentSituation ? 'var(--color-success)' : 'var(--color-error)',
            }}>
              {stats.hasCurrentSituation ? 'Exists' : 'Missing'}
            </div>
          </div>
        </section>
      )}

      <div style={{ borderTop: '1px solid var(--color-border)' }} />

      {/* Pipeline + script execution */}
      <section>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12,
        }}>
          <h3 style={{
            fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
            color: 'var(--color-text-muted)',
          }}>
            Script Execution
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
            {pipelineRunning ? 'Running...' : 'Run Full Pipeline (§17.1.4)'}
          </button>
        </div>

        {!hasAPI && (
          <p style={{ fontSize: 12, color: '#f59e0b', marginBottom: 10 }}>
            Scripts can only be executed in the Electron environment.
          </p>
        )}

        {/* Script grid (primary items) */}
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
                {/* Category dot */}
                <div style={{
                  width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                  background: CATEGORY_COLOR[script.category],
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                    {script.label}
                    {result === 'ok' && <span style={{ marginLeft: 5, color: 'var(--color-success)', fontSize: 11 }}>Done</span>}
                    {result === 'error' && <span style={{ marginLeft: 5, color: 'var(--color-error)', fontSize: 11 }}>Error</span>}
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
                  {isRunning ? '…' : 'Run'}
                </button>
              </div>
            )
          })}
        </div>
      </section>

      {/* Execution log */}
      {log.length > 0 && (
        <section>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Execution Log
            </span>
            <button
              onClick={() => setLog([])}
              style={{ fontSize: 11, color: 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              Clear
            </button>
          </div>
          <div style={{
            background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)',
            borderRadius: 6, padding: '8px 12px', maxHeight: 160, overflowY: 'auto',
          }}>
            {log.map((line, i) => (
              <div key={i} style={{
                fontSize: 12, fontFamily: 'monospace', lineHeight: 1.7,
                color: line.includes('Error') || line.includes('Failed') ? 'var(--color-error)'
                  : line.includes('Done') || line.includes('Pipeline') || line.includes('pipeline') ? 'var(--color-success)'
                  : 'var(--color-text-secondary)',
              }}>
                {line}
              </div>
            ))}
          </div>
        </section>
      )}

      <div style={{ borderTop: '1px solid var(--color-border)' }} />

      {/* Advanced settings toggle */}
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
            Advanced
          </span>
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginLeft: 4, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
            Additional scripts, quality checklist, periodic schedule
          </span>
        </button>

        {showAdvanced && (
          <div className="flex flex-col gap-5" style={{ marginTop: 16 }}>

            {/* Additional scripts */}
            <div>
              <div style={{
                fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)',
                marginBottom: 8, letterSpacing: '0.04em',
              }}>
                Additional Scripts
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
                          {result === 'ok' && <span style={{ marginLeft: 5, color: 'var(--color-success)', fontSize: 11 }}>Done</span>}
                          {result === 'error' && <span style={{ marginLeft: 5, color: 'var(--color-error)', fontSize: 11 }}>Error</span>}
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
                        {isRunning ? '…' : 'Run'}
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--color-border)' }} />

            {/* Quality Checklist §16 */}
            <div>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8,
              }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', letterSpacing: '0.04em' }}>
                  Quality Checklist (§16)
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                  {checkedItems.size}/{QUALITY_CHECKLIST.length} done
                  {checkedItems.size > 0 && (
                    <button
                      onClick={() => setCheckedItems(new Set())}
                      style={{ marginLeft: 8, fontSize: 11, color: 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
                    >
                      Reset
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
                      {/* Checkbox */}
                      <div style={{
                        width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                        border: `1.5px solid ${checked ? 'var(--color-success)' : 'var(--color-border)'}`,
                        background: checked ? 'var(--color-success)' : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {checked && <span style={{ color: '#fff', fontSize: 9, lineHeight: 1 }}>✓</span>}
                      </div>
                      {/* Item label */}
                      <span style={{
                        fontSize: 12,
                        color: checked ? 'var(--color-text-muted)' : 'var(--color-text-primary)',
                        textDecoration: checked ? 'line-through' : 'none',
                      }}>
                        {item.label}
                      </span>
                      {/* Target */}
                      <span style={{ fontSize: 11, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                        {item.target}
                      </span>
                      {/* Run button */}
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
                          {runningScript === item.script ? '…' : 'Run'}
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

            {/* Periodic refinement cycle §17.2 */}
            <div>
              <div style={{
                fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)',
                marginBottom: 8, letterSpacing: '0.04em',
              }}>
                Periodic Refinement Cycle (§17.2)
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
                            {result === 'ok'    && <span style={{ fontSize: 11, color: 'var(--color-success)' }}>Done</span>}
                            {result === 'error' && <span style={{ fontSize: 11, color: 'var(--color-error)' }}>Error</span>}
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
                              {runningScript === task.script ? '…' : 'Run'}
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

            {/* §18 Graph RAG freshness bug response */}
            <div style={{
              padding: '12px 14px', borderRadius: 6,
              background: 'rgba(245,158,11,0.05)', border: '1px solid rgba(245,158,11,0.25)',
            }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#f59e0b', marginBottom: 6 }}>
                §18 Graph RAG Freshness Bug Response
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.7, marginBottom: 10 }}>
                If AI responds with outdated information as if it's current, run the following steps in order.
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {[
                  { step: '1', script: 'check_outdated.py', note: 'Check outdated files and isolated new documents' },
                  { step: '2', script: 'gen_year_hubs.py',  note: 'Update latest year hub "recently added" section' },
                  { step: '3', script: 'gen_index.py',      note: 'Specify latest documents at top of _index.md' },
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
                        {runningScript === sname ? '…' : 'Run'}
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
