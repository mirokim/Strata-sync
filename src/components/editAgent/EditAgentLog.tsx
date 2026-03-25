import { useEffect, useRef, useState, useCallback } from 'react'
import { useEditAgentStore } from '@/stores/editAgentStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useVaultStore } from '@/stores/vaultStore'
import EditAgentLogEntryRow from './EditAgentLogEntry'
import { Trash2, Play, Square, History } from 'lucide-react'
import { runEditAgentCycle } from '@/services/editAgentRunner'
import { EDIT_AGENT_LOG_PATH } from '@/lib/constants'

interface CycleRecord {
  start: string   // ISO timestamp
  done?: string
  processed?: number
  edited?: number
  model?: string
}

export default function EditAgentLog() {
  const logs           = useEditAgentStore(s => s.logs)
  const isRunning      = useEditAgentStore(s => s.isRunning)
  const clearLogs      = useEditAgentStore(s => s.clearLogs)
  const lastWakeAt     = useEditAgentStore(s => s.lastWakeAt)
  const pendingQueue   = useEditAgentStore(s => s.pendingQueue)
  const processingFile = useEditAgentStore(s => s.processingFile)
  const enabled        = useSettingsStore(s => s.editAgentConfig.enabled)
  const vaultPath      = useVaultStore(s => s.vaultPath)
  const bottomRef      = useRef<HTMLDivElement>(null)
  const [showHistory, setShowHistory]   = useState(false)
  const [history, setHistory]           = useState<CycleRecord[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs.length])

  const loadHistory = useCallback(async () => {
    if (!vaultPath || !window.vaultAPI) return
    setHistoryLoading(true)
    try {
      const raw = await window.vaultAPI.readFile(`${vaultPath}/${EDIT_AGENT_LOG_PATH}`)
      if (!raw) { setHistory([]); return }
      const entries = raw.trim().split('\n').map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
      // Group into cycles: cycle_start -> next cycle_start
      const cycles: CycleRecord[] = []
      let current: CycleRecord | null = null
      for (const e of entries) {
        if (e.action === 'cycle_start') {
          if (current) cycles.push(current)
          current = { start: e.timestamp, model: e.model }
        } else if (e.action === 'cycle_done' && current) {
          current.done = e.timestamp
          current.processed = e.processed
          current.edited = e.edited
        }
      }
      if (current) cycles.push(current)
      setHistory(cycles.reverse()) // newest first
    } finally {
      setHistoryLoading(false)
    }
  }, [vaultPath])

  const handleToggleHistory = () => {
    if (!showHistory) loadHistory()
    setShowHistory(v => !v)
  }

  const lastWakeStr = lastWakeAt
    ? new Date(lastWakeAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
    : '\u2014'

  const MONO = 'var(--ea-font-mono)'

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: 'var(--color-bg-secondary)',
    }}>

      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '0 10px', height: 34,
        borderBottom: '1px solid var(--color-border)',
        flexShrink: 0,
      }}>
        <span style={{
          flex: 1, fontFamily: MONO, fontSize: 10,
          color: isRunning ? 'var(--color-accent)' : 'var(--color-text-muted)',
        }}>
          {isRunning ? '\u25CF running' : `last run ${lastWakeStr}`}
        </span>

        {/* Run now button */}
        <button
          onClick={isRunning ? undefined : () => runEditAgentCycle()}
          disabled={isRunning}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '3px 8px', borderRadius: 5,
            border: '1px solid var(--color-border)',
            background: 'transparent',
            color: isRunning ? 'var(--color-text-muted)' : 'var(--color-text-secondary)',
            cursor: isRunning ? 'not-allowed' : 'pointer',
            fontSize: 11, fontWeight: 500,
            transition: 'border-color 0.12s, color 0.12s, background 0.12s',
          }}
          onMouseEnter={e => { if (!isRunning) { const b = e.currentTarget as HTMLButtonElement; b.style.borderColor = 'var(--color-text-muted)'; b.style.color = 'var(--color-text-primary)' } }}
          onMouseLeave={e => { const b = e.currentTarget as HTMLButtonElement; b.style.borderColor = 'var(--color-border)'; b.style.color = isRunning ? 'var(--color-text-muted)' : 'var(--color-text-secondary)' }}
        >
          {isRunning ? <Square size={10} /> : <Play size={10} />}
          {isRunning ? 'running' : 'run now'}
        </button>

        {/* History */}
        <button
          onClick={handleToggleHistory}
          title="Previous run history"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 26, height: 26, borderRadius: 5, border: 'none',
            background: showHistory ? 'var(--color-bg-hover)' : 'transparent',
            color: showHistory ? 'var(--color-accent)' : 'var(--color-text-muted)',
            cursor: 'pointer', transition: 'color 0.12s, background 0.12s',
          }}
        >
          <History size={12} />
        </button>

        {/* Clear logs */}
        <button
          onClick={clearLogs}
          title="Clear logs"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 26, height: 26, borderRadius: 5, border: 'none',
            background: 'transparent', color: 'var(--color-text-muted)',
            cursor: 'pointer', transition: 'color 0.12s, background 0.12s',
          }}
          onMouseEnter={e => { const b = e.currentTarget as HTMLButtonElement; b.style.background = 'var(--color-bg-hover)'; b.style.color = 'var(--color-text-secondary)' }}
          onMouseLeave={e => { const b = e.currentTarget as HTMLButtonElement; b.style.background = 'transparent'; b.style.color = 'var(--color-text-muted)' }}
        >
          <Trash2 size={12} />
        </button>
      </div>

      {/* History panel */}
      {showHistory && (
        <div style={{
          flexShrink: 0, borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-bg-primary)',
          maxHeight: 200, overflowY: 'auto',
        }}>
          {historyLoading ? (
            <div style={{ padding: '8px 12px', fontFamily: MONO, fontSize: 10, color: 'var(--color-text-muted)' }}>
              Loading...
            </div>
          ) : history.length === 0 ? (
            <div style={{ padding: '8px 12px', fontFamily: MONO, fontSize: 10, color: 'var(--color-text-muted)' }}>
              No history
            </div>
          ) : history.map((c, i) => {
            const startDate = new Date(c.start)
            const dateStr = startDate.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit' })
            const timeStr = startDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
            const duration = c.done
              ? Math.round((new Date(c.done).getTime() - startDate.getTime()) / 1000)
              : null
            return (
              <div key={i} style={{
                display: 'grid', gridTemplateColumns: '72px 1fr auto',
                gap: '0 8px', padding: '5px 12px',
                borderBottom: '1px solid var(--color-border)',
                fontFamily: MONO, fontSize: 10,
              }}>
                <span style={{ color: 'var(--color-text-muted)' }}>{dateStr} {timeStr}</span>
                <span style={{ color: 'var(--color-text-secondary)' }}>
                  processed {c.processed ?? '?'} · edited {c.edited ?? '?'}
                  {c.model && <span style={{ color: 'var(--color-text-muted)', marginLeft: 6 }}>{c.model.split('-').slice(-2).join('-')}</span>}
                </span>
                {duration != null && (
                  <span style={{ color: 'var(--color-text-muted)' }}>{duration}s</span>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Status banners */}
      {isRunning && pendingQueue.length > 0 && (
        <div style={{
          padding: '5px 12px', flexShrink: 0,
          borderBottom: '1px solid var(--color-border)',
          display: 'flex', alignItems: 'center', gap: 6,
          fontFamily: MONO, fontSize: 10,
          background: 'var(--color-bg-surface)',
        }}>
          <span style={{ color: 'var(--color-accent)' }}>{pendingQueue.length} queued</span>
          {processingFile && (
            <span style={{ color: 'var(--color-text-muted)' }}>
              &rarr;&nbsp;
              <span style={{ color: 'var(--color-text-secondary)' }}>
                {processingFile.length > 32
                  ? '\u2026' + processingFile.slice(-30)
                  : processingFile}
              </span>
            </span>
          )}
        </div>
      )}

      {!enabled && (
        <div style={{
          padding: '5px 12px', flexShrink: 0,
          borderBottom: '1px solid var(--color-border)',
          fontFamily: MONO, fontSize: 10,
          color: 'var(--color-text-muted)',
        }}>
          disabled · enable in settings
        </div>
      )}

      {/* Log rows */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {logs.length === 0 ? (
          <div style={{
            padding: 20, textAlign: 'center',
            fontSize: 12, color: 'var(--color-text-muted)',
          }}>
            no logs
          </div>
        ) : (
          logs.map(entry => <EditAgentLogEntryRow key={entry.id} entry={entry} />)
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
