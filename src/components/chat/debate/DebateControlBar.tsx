/**
 * DebateControlBar — Status, round counter, pacing controls.
 * Adapted from Onion_flow's DebateControlBar.tsx.
 */
import { Pause, Play, Square, SkipForward, Plus } from 'lucide-react'
import { useDebateStore } from '@/stores/debateStore'
import { DEBATE_PROVIDER_LABELS, DEBATE_PROVIDER_COLORS } from '@/services/debateRoles'

const STATUS_LABELS: Record<string, string> = {
  running: 'Running',
  paused: 'Paused',
  completed: 'Completed',
  stopped: 'Stopped',
}

const STATUS_BG: Record<string, string> = {
  running: 'rgba(76,175,80,0.15)',
  paused: 'rgba(255,152,0,0.15)',
  completed: 'rgba(82,156,202,0.15)',
  stopped: 'rgba(244,67,54,0.15)',
}

const STATUS_COLOR: Record<string, string> = {
  running: '#4caf50',
  paused: '#ff9800',
  completed: '#529cca',
  stopped: '#f44336',
}

export function DebateControlBar() {
  const status = useDebateStore((s) => s.status)
  const config = useDebateStore((s) => s.config)
  const currentRound = useDebateStore((s) => s.currentRound)
  const loadingProvider = useDebateStore((s) => s.loadingProvider)
  const countdown = useDebateStore((s) => s.countdown)
  const waitingForNext = useDebateStore((s) => s.waitingForNext)
  const pauseDebate = useDebateStore((s) => s.pauseDebate)
  const resumeDebate = useDebateStore((s) => s.resumeDebate)
  const stopDebate = useDebateStore((s) => s.stopDebate)
  const nextTurn = useDebateStore((s) => s.nextTurn)
  const reset = useDebateStore((s) => s.reset)

  const maxRounds = config?.maxRounds || 3
  const isFinished = status === 'completed' || status === 'stopped'

  return (
    <div
      className="flex items-center justify-between px-3 py-2 shrink-0"
      style={{
        borderBottom: '1px solid var(--color-border)',
        background: 'var(--color-bg-secondary)',
      }}
    >
      {/* Left: status info */}
      <div className="flex items-center gap-2 text-xs flex-wrap">
        {/* Status badge */}
        <span
          className="px-2 py-0.5 rounded text-[10px] font-semibold"
          style={{
            background: STATUS_BG[status] || 'var(--color-bg-surface)',
            color: STATUS_COLOR[status] || 'var(--color-text-muted)',
          }}
        >
          {STATUS_LABELS[status] || status}
        </span>

        {/* Round counter */}
        <span style={{ color: 'var(--color-text-muted)', fontWeight: 500 }}>
          R<span style={{ color: 'var(--color-text-secondary)' }}>{currentRound}</span>/{maxRounds}
        </span>

        {/* Provider dots */}
        {config && (
          <div className="flex items-center gap-1">
            {config.participants.map((p: string) => {
              const isJudge = config.mode === 'battle' && config.judgeProvider === p
              return (
                <div
                  key={p}
                  className="w-2 h-2 rounded-full transition-all"
                  style={{
                    backgroundColor: DEBATE_PROVIDER_COLORS[p] || '#888',
                    boxShadow:
                      loadingProvider === p
                        ? `0 0 0 2px var(--color-bg-secondary), 0 0 0 4px ${DEBATE_PROVIDER_COLORS[p] || '#888'}`
                        : isJudge
                        ? `0 0 0 1px #ff9800`
                        : undefined,
                    animation: loadingProvider === p ? 'pulse 1s infinite' : undefined,
                  }}
                  title={`${DEBATE_PROVIDER_LABELS[p] || p}${isJudge ? ' (Judge)' : ''}`}
                />
              )
            })}
          </div>
        )}

        {/* Loading provider label */}
        {loadingProvider && (
          <span className="flex items-center gap-1 text-[11px]">
            <span style={{ color: DEBATE_PROVIDER_COLORS[loadingProvider] || '#888', fontWeight: 600 }}>
              {DEBATE_PROVIDER_LABELS[loadingProvider] || loadingProvider}
            </span>
            <span style={{ color: 'var(--color-text-muted)' }}>responding</span>
          </span>
        )}

        {/* Countdown */}
        {countdown > 0 && (
          <span
            className="text-[11px] font-mono tabular-nums px-1.5 py-0.5 rounded"
            style={{ color: '#ff9800', background: 'rgba(255,152,0,0.1)' }}
          >
            {countdown}s
          </span>
        )}

        {/* Manual next turn button */}
        {waitingForNext && (
          <button
            onClick={nextTurn}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg transition"
            style={{
              color: 'var(--color-accent)',
              background: 'rgba(82,156,202,0.1)',
              animation: 'pulse 1.5s infinite',
            }}
          >
            <SkipForward className="w-3.5 h-3.5" />
            Next Turn
          </button>
        )}
      </div>

      {/* Right: control buttons */}
      <div className="flex items-center gap-0.5">
        {status === 'running' && (
          <button
            onClick={pauseDebate}
            className="p-1.5 rounded-lg transition"
            style={{ color: 'var(--color-text-secondary)' }}
            title="Pause"
          >
            <Pause className="w-3.5 h-3.5" />
          </button>
        )}
        {status === 'paused' && (
          <button
            onClick={resumeDebate}
            className="p-1.5 rounded-lg transition"
            style={{ color: '#4caf50' }}
            title="Resume"
          >
            <Play className="w-3.5 h-3.5" />
          </button>
        )}
        {(status === 'running' || status === 'paused') && (
          <button
            onClick={stopDebate}
            className="p-1.5 rounded-lg transition"
            style={{ color: 'var(--color-text-muted)' }}
            title="Stop"
          >
            <Square className="w-3.5 h-3.5" />
          </button>
        )}
        {isFinished && (
          <button
            onClick={reset}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg transition"
            style={{ color: 'var(--color-accent)', background: 'rgba(82,156,202,0.1)' }}
          >
            <Plus className="w-3 h-3" />
            New Debate
          </button>
        )}
      </div>
    </div>
  )
}
