/**
 * Settings tab for Edit Agent configuration.
 * Controls: enable/disable, interval, model, refinement manual.
 */
import { useState } from 'react'
import { useSettingsStore, DEFAULT_EDIT_AGENT_CONFIG } from '@/stores/settingsStore'
import { useEditAgentStore } from '@/stores/editAgentStore'
import { useVaultStore } from '@/stores/vaultStore'
import { MODEL_OPTIONS } from '@/lib/modelConfig'
import { runEditAgentCycle } from '@/services/editAgentRunner'
import { Play, Square, FolderOpen, RefreshCw } from 'lucide-react'

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  color: 'var(--color-text-muted)',
  marginBottom: 4,
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  background: 'var(--color-bg-tertiary)',
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  color: 'var(--color-text-primary)',
  fontSize: 13,
  outline: 'none',
  boxSizing: 'border-box',
}

const SECTION_DEFS = [
  { file: 's01_overview.md',     label: '§1-2 개요·파이프라인' },
  { file: 's02_triage.md',       label: '§3 삭제·격리·보강 판단' },
  { file: 's03_conversion.md',   label: '§4 형식→MD 변환 (Confluence)' },
  { file: 's04_structure.md',    label: '§5-6 분할·프론트매터' },
  { file: 's05_links.md',        label: '§7-9 링크 주입·키워드' },
  { file: 's06_optimization.md', label: '§10-11 BFS·PageRank' },
  { file: 's07_quality.md',      label: '§12-16 품질 감사·체크리스트' },
  { file: 's08_operations.md',   label: '§17 운영 가이드' },
  { file: 's09_troubleshoot.md', label: '§18- 버그 대응·변경이력' },
  { file: 's10_jira_fetch.md',  label: '§Jira Fetch·변환·Triage' },
  { file: 's11_jira_aggregate.md', label: '§Jira Epic/Release 집계' },
  { file: 's12_jira_crosslink.md', label: '§Jira 교차 링크' },
] as const

const DEFAULT_SECTIONS = [
  's01_overview.md',    // 개요·파이프라인
  's02_triage.md',      // 삭제·격리·보강 판단
  's04_structure.md',   // 분할·프론트매터
  's05_links.md',       // 링크 주입·키워드 — BFS/PPR 핵심
  's06_optimization.md', // BFS·PageRank 최적화 — 검색 품질 직결
]

export default function EditAgentTab() {
  const config        = useSettingsStore(s => s.editAgentConfig ?? DEFAULT_EDIT_AGENT_CONFIG)
  const setConfig     = useSettingsStore(s => s.setEditAgentConfig)
  const isRunning     = useEditAgentStore(s => s.isRunning)
  const lastWakeAt    = useEditAgentStore(s => s.lastWakeAt)
  const vaultPath     = useVaultStore(s => s.vaultPath)
  const [loadStatus, setLoadStatus] = useState<string | null>(null)
  const [selectedSections, setSelectedSections] = useState<string[]>(DEFAULT_SECTIONS)
  const [hasSections, setHasSections] = useState<boolean | null>(null)

  const lastWakeStr = lastWakeAt
    ? new Date(lastWakeAt).toLocaleString('ko-KR')
    : '없음'

  const handleRunNow = async () => {
    if (isRunning) return
    await runEditAgentCycle()
  }

  /** manual/sections/ 존재 여부 감지 후 섹션 선택 UI 표시 */
  const handleDetectSections = async () => {
    if (!vaultPath || !window.vaultAPI) return
    try {
      const { files } = await window.vaultAPI.loadFiles(`${vaultPath}/manual/sections`)
      const exists = files.some((f: { relativePath: string }) => f.relativePath.includes('s0'))
      setHasSections(exists)
    } catch {
      setHasSections(false)
    }
  }

  /** 선택된 섹션만 합쳐서 시스템 프롬프트로 로드 */
  const handleLoadLatestManual = async () => {
    if (!vaultPath || !window.vaultAPI) {
      setLoadStatus('볼트가 열려 있지 않습니다')
      return
    }
    setLoadStatus('탐색 중...')
    try {
      // sections/ 폴더 우선 시도
      const sectionsPath = `${vaultPath}/manual/sections`
      let sectionFiles: { relativePath: string; absolutePath: string }[] = []
      try {
        const { files } = await window.vaultAPI.loadFiles(sectionsPath)
        sectionFiles = files.filter((f: { relativePath: string }) => f.relativePath.endsWith('.md'))
      } catch { /* sections 없으면 fallback */ }

      if (sectionFiles.length > 0) {
        setHasSections(true)
        const toLoad = sectionFiles.filter(f =>
          selectedSections.some(s => f.relativePath.endsWith(s))
        )
        if (toLoad.length === 0) { setLoadStatus('선택된 섹션 없음'); return }
        const parts: string[] = []
        for (const f of toLoad.sort((a, b) => a.relativePath.localeCompare(b.relativePath))) {
          const content = await window.vaultAPI.readFile(f.absolutePath)
          if (content) parts.push(content)
        }
        setConfig({ refinementManual: parts.join('\n\n---\n\n') })
        const totalKB = Math.round(parts.join('').length / 1024)
        setLoadStatus(`✓ ${toLoad.length}개 섹션 로드 (~${totalKB}KB)`)
        return
      }

      // fallback: 기존 방식 (최신 전체 매뉴얼)
      setHasSections(false)
      const { files } = await window.vaultAPI.loadFiles(`${vaultPath}/manual`)
      const manualFiles = files
        .filter((f: { relativePath: string }) => f.relativePath.endsWith('.md'))
        .sort((a: { relativePath: string }, b: { relativePath: string }) =>
          b.relativePath.localeCompare(a.relativePath, undefined, { numeric: true }))
      if (manualFiles.length === 0) { setLoadStatus('manual/ 폴더에 .md 파일 없음'); return }
      const latest = manualFiles[0]
      const content = await window.vaultAPI.readFile(latest.absolutePath)
      if (!content) { setLoadStatus('파일 읽기 실패'); return }
      setConfig({ refinementManual: content })
      const name = latest.relativePath.split('/').pop() ?? latest.relativePath
      setLoadStatus(`✓ 로드됨: ${name}`)
    } catch {
      setLoadStatus('불러오기 실패')
    }
  }

  /** 커스텀 경로에서 매뉴얼 로드 */
  const handleLoadFromPath = async (relativePath: string) => {
    if (!vaultPath || !window.vaultAPI || !relativePath.trim()) return
    setLoadStatus('로드 중...')
    try {
      const content = await window.vaultAPI.readFile(`${vaultPath}/${relativePath.trim()}`)
      if (!content) { setLoadStatus('파일 없음 또는 읽기 실패'); return }
      setConfig({ refinementManual: content })
      setLoadStatus(`✓ 로드됨: ${relativePath.trim()}`)
    } catch {
      setLoadStatus('불러오기 실패')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Enable toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text-primary)' }}>
            자동 편집 에이전트
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
            설정된 간격마다 자동으로 볼트 파일을 분석·개선합니다
          </div>
        </div>
        <label style={{ position: 'relative', display: 'inline-block', width: 44, height: 24, flexShrink: 0 }}>
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={e => setConfig({ enabled: e.target.checked })}
            style={{ opacity: 0, width: 0, height: 0 }}
          />
          <span style={{
            position: 'absolute', cursor: 'pointer', inset: 0,
            background: config.enabled ? 'var(--color-info)' : 'rgba(255,255,255,0.1)',
            borderRadius: 12,
            transition: 'background 0.2s',
          }} />
          <span style={{
            position: 'absolute',
            height: 18, width: 18,
            left: config.enabled ? 23 : 3,
            bottom: 3,
            background: 'white',
            borderRadius: '50%',
            transition: 'left 0.2s',
          }} />
        </label>
      </div>

      {/* Data sync */}
      {(['syncConfluence', 'syncJira'] as const).map(key => (
        <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text-primary)' }}>
              {key === 'syncConfluence' ? 'Confluence 자동 가져오기' : 'Jira 자동 가져오기'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
              웨이크 사이클마다 변경된 데이터를 자동으로 가져와 처리합니다
            </div>
          </div>
          <label style={{ position: 'relative', display: 'inline-block', width: 44, height: 24, flexShrink: 0 }}>
            <input
              type="checkbox"
              checked={config[key] ?? false}
              onChange={e => setConfig({ [key]: e.target.checked })}
              style={{ opacity: 0, width: 0, height: 0 }}
            />
            <span style={{
              position: 'absolute', cursor: 'pointer', inset: 0,
              background: (config[key] ?? false) ? 'var(--color-info)' : 'rgba(255,255,255,0.1)',
              borderRadius: 12, transition: 'background 0.2s',
            }} />
            <span style={{
              position: 'absolute', height: 18, width: 18,
              left: (config[key] ?? false) ? 23 : 3, bottom: 3,
              background: 'white', borderRadius: '50%', transition: 'left 0.2s',
            }} />
          </label>
        </div>
      ))}

      {/* Interval */}
      <div>
        <label style={labelStyle}>웨이크 간격 (분)</label>
        <input
          type="number"
          min={1} max={1440}
          value={config.intervalMinutes}
          onChange={e => setConfig({ intervalMinutes: Number(e.target.value) || 30 })}
          style={{ ...inputStyle, width: 120 }}
        />
      </div>

      {/* Model */}
      <div>
        <label style={labelStyle}>사용 모델</label>
        <select
          value={config.modelId}
          onChange={e => setConfig({ modelId: e.target.value })}
          style={{ ...inputStyle, width: 280 }}
        >
          {MODEL_OPTIONS.map(m => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      </div>

      {/* Refinement manual */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <label style={{ ...labelStyle, marginBottom: 0 }}>개선 지침 (에이전트 시스템 프롬프트)</label>
          <button
            onClick={handleLoadLatestManual}
            title="sections/ 우선, 없으면 최신 전체 매뉴얼 로드"
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '4px 10px', borderRadius: 5, fontSize: 11,
              border: '1px solid var(--color-border)',
              background: 'transparent', color: 'var(--color-text-secondary)',
              cursor: 'pointer',
            }}
          >
            <RefreshCw size={11} />
            매뉴얼 로드
          </button>
        </div>

        {/* 섹션 선택 (sections/ 폴더 감지 시 표시) */}
        {hasSections !== false && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                섹션 선택 <span style={{ opacity: 0.6 }}>(sections/ 폴더 기반 — 필요한 섹션만 선택해 토큰 절약)</span>
              </span>
              <button
                onClick={handleDetectSections}
                style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4,
                  border: '1px solid var(--color-border)', background: 'transparent',
                  color: 'var(--color-text-muted)', cursor: 'pointer' }}
              >
                감지
              </button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
              {SECTION_DEFS.map(({ file, label }) => (
                <label key={file} style={{ display: 'flex', alignItems: 'center', gap: 4,
                  fontSize: 11, color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={selectedSections.includes(file)}
                    onChange={e => setSelectedSections(prev =>
                      e.target.checked ? [...prev, file] : prev.filter(s => s !== file)
                    )}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Custom path loader */}
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            id="manual-path-input"
            type="text"
            placeholder="manual/sections/s03_conversion.md"
            style={{ ...inputStyle, fontSize: 11 }}
          />
          <button
            onClick={() => {
              const el = document.getElementById('manual-path-input') as HTMLInputElement
              handleLoadFromPath(el?.value ?? '')
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '4px 10px', borderRadius: 5, fontSize: 11, flexShrink: 0,
              border: '1px solid var(--color-border)',
              background: 'transparent', color: 'var(--color-text-secondary)',
              cursor: 'pointer',
            }}
          >
            <FolderOpen size={11} />
            불러오기
          </button>
        </div>

        {loadStatus && (
          <div style={{ fontSize: 11, color: loadStatus.startsWith('✓') ? 'var(--color-success)' : 'var(--color-error)' }}>
            {loadStatus}
          </div>
        )}

        <textarea
          value={config.refinementManual}
          onChange={e => setConfig({ refinementManual: e.target.value })}
          rows={10}
          style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5, fontFamily: 'monospace', fontSize: 12 }}
        />
      </div>

      {/* Status + manual trigger */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 14px',
        background: 'rgba(255,255,255,0.04)',
        borderRadius: 8,
        fontSize: 12,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ color: 'var(--color-text-muted)' }}>마지막 실행: {lastWakeStr}</div>
          {isRunning && <div style={{ color: 'var(--color-success)', marginTop: 2 }}>● 현재 실행 중...</div>}
        </div>
        <button
          onClick={handleRunNow}
          disabled={isRunning}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 14px', borderRadius: 6, border: 'none',
            background: isRunning ? 'rgba(255,255,255,0.05)' : 'rgba(59,130,246,0.2)',
            color: isRunning ? 'var(--color-text-muted)' : '#60a5fa',
            cursor: isRunning ? 'not-allowed' : 'pointer',
            fontSize: 12,
          }}
        >
          {isRunning ? <Square size={12} /> : <Play size={12} />}
          {isRunning ? '실행 중' : '지금 실행'}
        </button>
      </div>
    </div>
  )
}
