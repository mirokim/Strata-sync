/**
 * Settings tab for session token usage + cost tracking + call log.
 */
import { useState } from 'react'
import { useUsageStore, MODEL_PRICING, type UsageLogEntry } from '@/stores/usageStore'
import { formatTokens, formatCost } from '@/lib/formatUtils'
import { RotateCcw, Trash2, ChevronDown, ChevronUp, Download } from 'lucide-react'

const CALLER_LABEL: Record<string, string> = {
  chat: '채팅',
  editAgent: '편집 에이전트',
  debate: '토론',
  graphInsight: '그래프 인사이트',
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function shortModel(id: string): string {
  return id
    .replace('claude-', 'c-')
    .replace('gemini-', 'g-')
    .replace('grok-', 'gk-')
    .replace('gpt-', '')
}

/** 로그를 CSV로 내보내기 */
function exportLogCsv(log: UsageLogEntry[]) {
  const header = 'timestamp,model,caller,input_tokens,output_tokens,cost_usd'
  const rows = log.map(e =>
    `${e.timestamp},${e.modelId},${e.caller},${e.inputTokens},${e.outputTokens},${e.costUsd.toFixed(6)}`
  )
  const blob = new Blob([header + '\n' + rows.join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `strata-sync-usage-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

/** 날짜별로 그룹화해서 일별 요약 생성 */
function getDailySummary(log: UsageLogEntry[]) {
  const map = new Map<string, { input: number; output: number; cost: number; calls: number }>()
  for (const e of log) {
    const date = e.timestamp.slice(0, 10)
    const prev = map.get(date) ?? { input: 0, output: 0, cost: 0, calls: 0 }
    prev.input += e.inputTokens
    prev.output += e.outputTokens
    prev.cost += e.costUsd
    prev.calls += 1
    map.set(date, prev)
  }
  return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]))
}

export default function UsageTab() {
  const totalInputTokens  = useUsageStore(s => s.totalInputTokens)
  const totalOutputTokens = useUsageStore(s => s.totalOutputTokens)
  const totalCostUsd      = useUsageStore(s => s.totalCostUsd)
  const log               = useUsageStore(s => s.log)
  const resetSession      = useUsageStore(s => s.resetSession)
  const clearLog          = useUsageStore(s => s.clearLog)

  const [showLog, setShowLog] = useState(false)
  const [showPricing, setShowPricing] = useState(false)

  const dailySummary = getDailySummary(log)
  const logCostTotal = log.reduce((s, e) => s + e.costUsd, 0)

  const btnStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px',
    borderRadius: 6, border: 'none', background: 'var(--color-bg-tertiary)',
    color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 12,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Session summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {[
          { label: '입력 토큰', value: formatTokens(totalInputTokens), color: '#94a3b8' },
          { label: '출력 토큰', value: formatTokens(totalOutputTokens), color: '#94a3b8' },
          { label: '예상 비용', value: formatCost(totalCostUsd), color: '#f59e0b' },
        ].map(item => (
          <div key={item.label} style={{
            padding: '14px 16px', background: 'rgba(255,255,255,0.04)',
            borderRadius: 8, border: '1px solid var(--color-bg-tertiary)',
          }}>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4 }}>{item.label}</div>
            <div style={{ fontSize: 20, fontWeight: 600, color: item.color }}>{item.value}</div>
          </div>
        ))}
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={resetSession} style={btnStyle}>
          <RotateCcw size={12} /> 세션 초기화
        </button>
        {log.length > 0 && (
          <>
            <button onClick={() => exportLogCsv(log)} style={btnStyle}>
              <Download size={12} /> CSV 내보내기
            </button>
            <button onClick={() => { if (confirm('전체 사용 로그를 삭제합니다.')) clearLog() }} style={btnStyle}>
              <Trash2 size={12} /> 로그 삭제
            </button>
          </>
        )}
      </div>

      {/* Daily summary */}
      {dailySummary.length > 0 && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)', marginBottom: 10 }}>
            일별 사용량 (누적 {formatCost(logCostTotal)})
          </div>
          <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                  {['날짜', '호출', '입력', '출력', '비용'].map(h => (
                    <th key={h} style={{
                      textAlign: 'left', padding: '8px 12px', color: 'var(--color-text-muted)',
                      fontWeight: 500, borderBottom: '1px solid var(--color-bg-tertiary)',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dailySummary.slice(0, 14).map(([date, s], idx) => (
                  <tr key={date} style={{ background: idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                    <td style={{ padding: '6px 12px', color: 'var(--color-text-primary)', fontFamily: 'monospace', fontSize: 11 }}>{date}</td>
                    <td style={{ padding: '6px 12px', color: '#94a3b8' }}>{s.calls}</td>
                    <td style={{ padding: '6px 12px', color: '#94a3b8' }}>{formatTokens(s.input)}</td>
                    <td style={{ padding: '6px 12px', color: '#94a3b8' }}>{formatTokens(s.output)}</td>
                    <td style={{ padding: '6px 12px', color: '#f59e0b', fontFamily: 'monospace' }}>{formatCost(s.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Call log (collapsible) */}
      {log.length > 0 && (
        <div>
          <button
            onClick={() => setShowLog(v => !v)}
            style={{ ...btnStyle, background: 'transparent', padding: '4px 0', color: 'var(--color-text-primary)', fontWeight: 500, fontSize: 13 }}
          >
            {showLog ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            호출 로그 ({log.length}건)
          </button>
          {showLog && (
            <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, overflow: 'hidden', marginTop: 8, maxHeight: 400, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.04)', position: 'sticky', top: 0 }}>
                    {['시간', '모델', '기능', 'IN', 'OUT', '비용'].map(h => (
                      <th key={h} style={{
                        textAlign: 'left', padding: '6px 8px', color: 'var(--color-text-muted)',
                        fontWeight: 500, borderBottom: '1px solid var(--color-bg-tertiary)',
                        background: 'rgba(255,255,255,0.04)',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...log].reverse().map((e, idx) => (
                    <tr key={idx} style={{ background: idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                      <td style={{ padding: '4px 8px', color: 'var(--color-text-muted)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{formatTime(e.timestamp)}</td>
                      <td style={{ padding: '4px 8px', color: 'var(--color-text-primary)', fontFamily: 'monospace' }}>{shortModel(e.modelId)}</td>
                      <td style={{ padding: '4px 8px', color: '#94a3b8' }}>{CALLER_LABEL[e.caller] ?? e.caller}</td>
                      <td style={{ padding: '4px 8px', color: '#94a3b8', fontFamily: 'monospace' }}>{formatTokens(e.inputTokens)}</td>
                      <td style={{ padding: '4px 8px', color: '#94a3b8', fontFamily: 'monospace' }}>{formatTokens(e.outputTokens)}</td>
                      <td style={{ padding: '4px 8px', color: '#f59e0b', fontFamily: 'monospace' }}>{formatCost(e.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Pricing reference table (collapsible) */}
      <div>
        <button
          onClick={() => setShowPricing(v => !v)}
          style={{ ...btnStyle, background: 'transparent', padding: '4px 0', color: 'var(--color-text-primary)', fontWeight: 500, fontSize: 13 }}
        >
          {showPricing ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          모델 가격표
        </button>
        {showPricing && (
          <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, overflow: 'hidden', marginTop: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                  {['모델', '입력', '출력'].map(h => (
                    <th key={h} style={{
                      textAlign: 'left', padding: '8px 12px', color: 'var(--color-text-muted)',
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
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', padding: '8px 12px' }}>
              * USD / 1M 토큰 기준, 근사치
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
