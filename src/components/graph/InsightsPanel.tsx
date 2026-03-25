/**
 * InsightsPanel — Vault graph insights panel
 *
 * Displays results from computeInsights():
 * - Bridge nodes: highly referenced hub documents
 * - Orphan documents: documents with no links at all
 * - Gap topics: topics referenced in multiple places but with no backing file
 * - Clusters: connected group summaries
 */

import { useMemo, useState } from 'react'
import { useVaultStore } from '@/stores/vaultStore'
import { computeInsights, type InsightResult } from '@/lib/graphAnalysis'
import { useGraphStore } from '@/stores/graphStore'
import { X, RefreshCw } from 'lucide-react'

interface Props {
  onClose: () => void
}

export default function InsightsPanel({ onClose }: Props) {
  const loadedDocuments = useVaultStore(s => s.loadedDocuments)
  const setAiHighlightNodes = useGraphStore(s => s.setAiHighlightNodes)
  const [tab, setTab] = useState<'bridge' | 'orphan' | 'gap' | 'cluster'>('bridge')
  const [rev, setRev] = useState(0)

  const insights: InsightResult = useMemo(() => {
    if (!loadedDocuments || loadedDocuments.length === 0) {
      return { bridgeNodes: [], orphanDocs: [], gapTopics: [], clusters: [] }
    }
    return computeInsights(loadedDocuments)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedDocuments, rev])

  const TABS = [
    { id: 'bridge',  label: 'Hub Nodes',       count: insights.bridgeNodes.length,  color: '#60a5fa' },
    { id: 'orphan',  label: 'Orphan Docs',     count: insights.orphanDocs.length,   color: 'var(--color-error)' },
    { id: 'gap',     label: 'Gap Topics',      count: insights.gapTopics.length,    color: '#fbbf24' },
    { id: 'cluster', label: 'Clusters',        count: insights.clusters.length,     color: '#a78bfa' },
  ] as const

  const highlightNode = (docId: string) => {
    setAiHighlightNodes([docId])
    setTimeout(() => setAiHighlightNodes([]), 3000)
  }

  return (
    <div
      style={{
        position: 'absolute', top: 8, right: 8, width: 320, maxHeight: 480,
        background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)',
        borderRadius: 8, display: 'flex', flexDirection: 'column', zIndex: 50,
        boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', padding: '8px 12px',
        borderBottom: '1px solid var(--color-border)',
      }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-primary)', flex: 1 }}>
          Vault Insights
        </span>
        <button
          onClick={() => setRev(r => r + 1)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: 4 }}
          title="Re-analyze"
        >
          <RefreshCw size={11} />
        </button>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: 4 }}
        >
          <X size={13} />
        </button>
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex', borderBottom: '1px solid var(--color-border)',
        padding: '0 8px',
      }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              flex: 1, padding: '6px 4px', fontSize: 10, fontWeight: 600,
              background: 'none', border: 'none', cursor: 'pointer',
              color: tab === t.id ? t.color : 'var(--color-text-muted)',
              borderBottom: tab === t.id ? `2px solid ${t.color}` : '2px solid transparent',
              transition: 'color 0.15s',
            }}
          >
            {t.label}
            <span style={{
              marginLeft: 4,
              background: tab === t.id ? `${t.color}22` : 'var(--color-bg-surface)',
              color: tab === t.id ? t.color : 'var(--color-text-muted)',
              borderRadius: 8, padding: '1px 5px', fontSize: 9,
            }}>
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {tab === 'bridge' && (
          <>
            {insights.bridgeNodes.length === 0 ? (
              <EmptyState msg="No hubs with 3+ inbound links" />
            ) : insights.bridgeNodes.map(n => (
              <InsightRow
                key={n.docId}
                label={n.filename.replace(/\.md$/i, '')}
                badge={`in:${n.inboundCount} out:${n.outboundCount}`}
                color="#60a5fa"
                onClick={() => highlightNode(n.docId)}
                tooltip="Highlight in graph"
              />
            ))}
          </>
        )}

        {tab === 'orphan' && (
          <>
            {insights.orphanDocs.length === 0 ? (
              <EmptyState msg="No orphan documents — all docs have links" isGood />
            ) : (
              <>
                <div style={{ padding: '0 12px 6px', fontSize: 11, color: 'var(--color-text-muted)' }}>
                  Documents with no inbound or outbound links
                </div>
                {insights.orphanDocs.map(n => (
                  <InsightRow
                    key={n.docId}
                    label={n.filename.replace(/\.md$/i, '')}
                    color="var(--color-error)"
                    onClick={() => highlightNode(n.docId)}
                    tooltip="Highlight in graph"
                  />
                ))}
              </>
            )}
          </>
        )}

        {tab === 'gap' && (
          <>
            {insights.gapTopics.length === 0 ? (
              <EmptyState msg="No gap topics found" isGood />
            ) : (
              <>
                <div style={{ padding: '0 12px 6px', fontSize: 11, color: 'var(--color-text-muted)' }}>
                  Topics referenced in multiple docs but with no backing file (consider creating them)
                </div>
                {insights.gapTopics.map(g => (
                  <InsightRow
                    key={g.topic}
                    label={g.topic}
                    badge={`${g.referenceCount} refs`}
                    color="#fbbf24"
                  />
                ))}
              </>
            )}
          </>
        )}

        {tab === 'cluster' && (
          <>
            {insights.clusters.length === 0 ? (
              <EmptyState msg="No separate clusters — vault is fully connected" isGood />
            ) : insights.clusters.map((c, i) => (
              <InsightRow
                key={c.clusterIdx}
                label={`Cluster ${i + 1}: ${c.representative.replace(/\.md$/i, '')}`}
                badge={`${c.size} docs`}
                color="#a78bfa"
              />
            ))}
          </>
        )}
      </div>
    </div>
  )
}

function InsightRow({
  label, badge, color, onClick, tooltip,
}: {
  label: string
  badge?: string
  color: string
  onClick?: () => void
  tooltip?: string
}) {
  return (
    <div
      onClick={onClick}
      title={tooltip}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '5px 12px',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'background 0.1s',
      }}
      onMouseEnter={e => { if (onClick) (e.currentTarget as HTMLElement).style.background = 'var(--color-bg-hover)' }}
      onMouseLeave={e => { if (onClick) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
    >
      <div style={{ width: 4, height: 4, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span style={{
        flex: 1, fontSize: 11, color: 'var(--color-text-primary)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {label}
      </span>
      {badge && (
        <span style={{
          fontSize: 10, color: color, background: `${color}18`,
          borderRadius: 4, padding: '1px 6px', flexShrink: 0,
          border: `1px solid ${color}33`,
        }}>
          {badge}
        </span>
      )}
    </div>
  )
}

function EmptyState({ msg, isGood }: { msg: string; isGood?: boolean }) {
  return (
    <div style={{
      padding: '20px 16px', textAlign: 'center', fontSize: 11,
      color: isGood ? 'var(--color-success)' : 'var(--color-text-muted)',
    }}>
      {msg}
    </div>
  )
}
