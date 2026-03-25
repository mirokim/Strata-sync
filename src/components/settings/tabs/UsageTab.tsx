/**
 * Settings tab for session token usage + cost tracking.
 */
import { useUsageStore, MODEL_PRICING } from '@/stores/usageStore'
import { formatTokens, formatCost } from '@/lib/formatUtils'
import { RotateCcw } from 'lucide-react'

export default function UsageTab() {
  const totalInputTokens  = useUsageStore(s => s.totalInputTokens)
  const totalOutputTokens = useUsageStore(s => s.totalOutputTokens)
  const totalCostUsd      = useUsageStore(s => s.totalCostUsd)
  const resetSession      = useUsageStore(s => s.resetSession)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Session summary */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12,
      }}>
        {[
          { label: 'Input Tokens', value: formatTokens(totalInputTokens), color: '#94a3b8' },
          { label: 'Output Tokens', value: formatTokens(totalOutputTokens), color: '#94a3b8' },
          { label: 'Estimated Cost', value: formatCost(totalCostUsd), color: '#f59e0b' },
        ].map(item => (
          <div key={item.label} style={{
            padding: '14px 16px',
            background: 'rgba(255,255,255,0.04)',
            borderRadius: 8,
            border: '1px solid var(--color-bg-tertiary)',
          }}>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4 }}>{item.label}</div>
            <div style={{ fontSize: 20, fontWeight: 600, color: item.color }}>{item.value}</div>
          </div>
        ))}
      </div>

      {/* Reset button */}
      <button
        onClick={resetSession}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
          padding: '7px 14px', borderRadius: 6, border: 'none',
          background: 'var(--color-bg-tertiary)',
          color: 'var(--color-text-muted)',
          cursor: 'pointer', fontSize: 12,
        }}
      >
        <RotateCcw size={12} />
        Reset Session
      </button>

      {/* Pricing reference table */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)', marginBottom: 10 }}>
          Model Pricing (USD / 1M tokens)
        </div>
        <div style={{
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 8,
          overflow: 'hidden',
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                {['Model', 'Input', 'Output'].map(h => (
                  <th key={h} style={{
                    textAlign: 'left', padding: '8px 12px',
                    color: 'var(--color-text-muted)',
                    fontWeight: 500, borderBottom: '1px solid var(--color-bg-tertiary)',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(MODEL_PRICING).map(([id, pricing], idx) => (
                <tr key={id} style={{ background: idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                  <td style={{ padding: '6px 12px', color: 'var(--color-text-primary)', fontFamily: 'monospace', fontSize: 11 }}>{id}</td>
                  <td style={{ padding: '6px 12px', color: '#94a3b8' }}>${pricing.input.toFixed(3)}</td>
                  <td style={{ padding: '6px 12px', color: '#94a3b8' }}>${pricing.output.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 8 }}>
          * Prices are approximate and may differ from actual billing amounts
        </div>
      </div>
    </div>
  )
}
