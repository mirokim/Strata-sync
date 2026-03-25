/**
 * Bottom status bar — shows real-time token usage and estimated USD cost.
 * Always visible; shows live counts even at zero.
 */
import { useUsageStore } from '@/stores/usageStore'
import { useEditAgentStore } from '@/stores/editAgentStore'
import { formatTokens, formatCost } from '@/lib/formatUtils'
import { RotateCcw, Zap, Coins } from 'lucide-react'

export default function StatusBar() {
  const totalInputTokens  = useUsageStore(s => s.totalInputTokens)
  const totalOutputTokens = useUsageStore(s => s.totalOutputTokens)
  const totalCostUsd      = useUsageStore(s => s.totalCostUsd)
  const resetSession      = useUsageStore(s => s.resetSession)
  const isAgentRunning    = useEditAgentStore(s => s.isRunning)

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 0,
      padding: '0 12px',
      background: 'var(--color-bg-secondary)',
      borderTop: '1px solid var(--color-border)',
      fontSize: 11,
      color: 'var(--color-text-muted)',
      userSelect: 'none',
      height: 26,
      flexShrink: 0,
    }}>
      {/* Edit agent indicator */}
      {isAgentRunning && (
        <span style={{
          display: 'flex', alignItems: 'center', gap: 4,
          color: 'var(--color-success)',
          paddingRight: 12,
          borderRight: '1px solid rgba(255,255,255,0.07)',
          marginRight: 12,
        }}>
          <Zap size={10} />
          Edit Agent Running
        </span>
      )}

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Token + cost summary */}
      <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {/* Input tokens */}
        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }} title="Input tokens">
          <span style={{ opacity: 0.45, fontSize: 10 }}>IN</span>
          <span style={{ color: totalInputTokens > 0 ? '#94a3b8' : 'rgba(148,163,184,0.35)' }}>
            {formatTokens(totalInputTokens)}
          </span>
        </span>

        <span style={{ opacity: 0.2 }}>·</span>

        {/* Output tokens */}
        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }} title="Output tokens">
          <span style={{ opacity: 0.45, fontSize: 10 }}>OUT</span>
          <span style={{ color: totalOutputTokens > 0 ? '#94a3b8' : 'rgba(148,163,184,0.35)' }}>
            {formatTokens(totalOutputTokens)}
          </span>
        </span>

        <span style={{ opacity: 0.2 }}>·</span>

        {/* Cost */}
        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }} title="Estimated cost (USD)">
          <Coins size={10} style={{ opacity: 0.45 }} />
          <span style={{
            color: totalCostUsd > 0 ? '#f59e0b' : 'rgba(245,158,11,0.35)',
            fontWeight: totalCostUsd > 0 ? 600 : 400,
          }}>
            {formatCost(totalCostUsd)}
          </span>
        </span>

        {/* Reset */}
        {(totalInputTokens > 0 || totalOutputTokens > 0) && (
          <button
            onClick={resetSession}
            title="Reset session tokens"
            style={{
              display: 'flex', alignItems: 'center',
              padding: '1px 4px', borderRadius: 3, border: 'none',
              background: 'transparent',
              color: 'rgba(148,163,184,0.4)',
              cursor: 'pointer', fontSize: 10,
              transition: 'color 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = '#94a3b8')}
            onMouseLeave={e => (e.currentTarget.style.color = 'rgba(148,163,184,0.4)')}
          >
            <RotateCcw size={9} />
          </button>
        )}
      </span>
    </div>
  )
}
