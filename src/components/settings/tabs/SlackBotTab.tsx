/**
 * SlackBotTab — Slack bot process management tab.
 * Uses Electron main process bot:start / bot:stop IPC to
 * spawn/kill the bot process and display logs in real time.
 */

import { useState, useEffect, useRef } from 'react'
import { Play, Square } from 'lucide-react'
import { useSettingsStore } from '@/stores/settingsStore'
import { useBotStore } from '@/stores/botStore'
import { fieldInputStyle, fieldLabelStyle } from '../settingsShared'

export default function SlackBotTab() {
  const { slackBotConfig, setSlackBotConfig } = useSettingsStore()
  const { running, setRunning, startBot, stopBot } = useBotStore()

  const [logs, setLogs] = useState<string[]>([])
  const logEndRef = useRef<HTMLDivElement>(null)

  // Sync initial state + load buffered logs
  useEffect(() => {
    window.botAPI?.getStatus().then(s => setRunning(s.running)).catch(() => {})
    window.botAPI?.getLogs?.().then((lines: string[]) => { if (lines?.length) setLogs(lines.slice(-500)) }).catch(() => {})
  }, [setRunning])

  // Subscribe to log + stop events
  useEffect(() => {
    const offLog     = window.botAPI?.onLog(line => setLogs(prev => [...prev.slice(-500), line]))
    const offStopped = window.botAPI?.onStopped(() => setRunning(false))
    return () => { offLog?.(); offStopped?.() }
  }, [setRunning])

  // Auto-scroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  const handleStart = async () => {
    const result = await startBot()
    if (result.ok) {
      setLogs(prev => [...prev, '> Bot started'])
    } else {
      setLogs(prev => [...prev, `[ERROR] Start failed: ${result.error}`])
    }
  }

  const handleStop = async () => {
    await stopBot()
    setLogs(prev => [...prev, '> Bot stopped'])
  }

  const canStart = slackBotConfig.botToken.trim() && slackBotConfig.appToken.trim()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '2px 0' }}>

      {/* Status card */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 14px', borderRadius: 2,
        background: running ? 'color-mix(in srgb, var(--color-accent) 8%, transparent)' : 'var(--color-bg-surface)',
        border: `1px solid ${running ? 'color-mix(in srgb, var(--color-accent) 35%, transparent)' : 'var(--color-border)'}`,
        transition: 'border-color 0.2s, background 0.2s',
      }}>
        <div style={{ position: 'relative', width: 9, height: 9, flexShrink: 0 }}>
          <div style={{ width: 9, height: 9, borderRadius: '50%', background: running ? 'var(--color-accent)' : 'var(--color-text-muted)' }} />
          {running && (
            <div style={{
              position: 'absolute', inset: -3, borderRadius: '50%',
              background: 'var(--color-accent)', opacity: 0.25,
              animation: 'slackPing 1.8s ease-out infinite',
            }} />
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: running ? 'var(--color-accent)' : 'var(--color-text-primary)', lineHeight: 1.3 }}>
            {running ? 'Slack Bot Running' : 'Slack Bot'}
          </div>
          {!canStart && !running && (
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
              Enter tokens first
            </div>
          )}
        </div>

        <button
          onClick={running ? handleStop : handleStart}
          disabled={!running && !canStart}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '6px 14px', borderRadius: 2, fontSize: 12, fontWeight: 500,
            border: running ? '1px solid #ef444450' : 'none',
            cursor: (!running && !canStart) ? 'not-allowed' : 'pointer',
            background: running ? '#ef444415' : 'var(--color-accent)',
            color: running ? '#ef4444' : '#fff',
            opacity: (!running && !canStart) ? 0.4 : 1,
            flexShrink: 0, whiteSpace: 'nowrap',
          }}
        >
          {running ? <><Square size={11} /> Stop</> : <><Play size={11} /> Start</>}
        </button>
      </div>

      <style>{`@keyframes slackPing { 0% { transform: scale(1); opacity: 0.25; } 100% { transform: scale(3); opacity: 0; } }`}</style>

      {/* Credentials */}
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 10 }}>
          Connection Settings
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 14, borderRadius: 2, background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)' }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text-muted)', display: 'block', marginBottom: 5 }}>Bot Token</label>
            <input
              type="password"
              value={slackBotConfig.botToken}
              onChange={e => setSlackBotConfig({ botToken: e.target.value })}
              placeholder="xoxb-..."
              style={fieldInputStyle}
              spellCheck={false}
            />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text-muted)', display: 'block', marginBottom: 5 }}>App Token</label>
            <input
              type="password"
              value={slackBotConfig.appToken}
              onChange={e => setSlackBotConfig({ appToken: e.target.value })}
              placeholder="xapp-..."
              style={fieldInputStyle}
              spellCheck={false}
            />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text-muted)', display: 'block', marginBottom: 5 }}>Response Model</label>
            <input
              type="text"
              value={slackBotConfig.model}
              onChange={e => setSlackBotConfig({ model: e.target.value })}
              style={fieldInputStyle}
            />
          </div>
        </div>
      </div>

      {/* Log panel */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>
            Logs
          </div>
          {logs.length > 0 && (
            <button
              onClick={() => setLogs([])}
              style={{ fontSize: 11, color: 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', borderRadius: 4 }}
            >
              Clear
            </button>
          )}
        </div>
        <div style={{
          height: 190, overflowY: 'auto',
          background: 'var(--color-bg-base)',
          border: '1px solid var(--color-border)',
          borderRadius: 2, padding: '8px 10px',
          fontFamily: 'monospace', fontSize: 12,
          color: 'var(--color-text-secondary)',
        }}>
          {logs.length === 0
            ? <span style={{ color: 'var(--color-text-muted)' }}>Logs will appear when the bot is started.</span>
            : logs.map((l, i) => (
              <div key={i} style={{
                lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                color: (l.startsWith('[ERR]') || l.startsWith('[ERROR]')) ? 'var(--color-error)'
                  : l.startsWith('>') ? 'var(--color-accent)'
                  : undefined,
              }}>{l}</div>
            ))
          }
          <div ref={logEndRef} />
        </div>
      </div>

    </div>
  )
}
