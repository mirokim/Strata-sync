import { useMemo } from 'react'
import { useVaultStore } from '@/stores/vaultStore'
import { useGraphStore } from '@/stores/graphStore'
import { SPEAKER_CONFIG } from '@/lib/speakerConfig'
import type { SpeakerId } from '@/types'

// ── Small horizontal bar ────────────────────────────────────────────────────

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div style={{ height: 4, background: 'var(--color-border)', borderRadius: 2, width: '100%' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.3s' }} />
    </div>
  )
}

// ── Summary card ────────────────────────────────────────────────────────────

function Card({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div style={{
      background: 'var(--color-bg-active)',
      border: '1px solid var(--color-border)',
      borderRadius: 8,
      padding: '10px 14px',
      flex: 1,
      minWidth: 0,
    }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-text-primary)', lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 4 }}>{label}</div>
      {sub && <div style={{ fontSize: 9, color: 'var(--color-text-muted)', opacity: 0.6, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

// ── Section title ─────────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      fontSize: 10,
      fontWeight: 600,
      color: 'var(--color-text-secondary)',
      textTransform: 'uppercase',
      letterSpacing: '0.07em',
      marginBottom: 8,
    }}>
      {children}
    </p>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function StatsTab() {
  const docs = useVaultStore(s => s.loadedDocuments)
  const vaultPath = useVaultStore(s => s.vaultPath)
  const { nodes, links } = useGraphStore()

  const stats = useMemo(() => {
    if (!docs || docs.length === 0) return null

    // Speaker distribution
    const speakerCounts: Record<string, number> = {}
    for (const d of docs) {
      speakerCounts[d.speaker] = (speakerCounts[d.speaker] ?? 0) + 1
    }

    // Tag aggregation
    const tagMap: Record<string, number> = {}
    for (const d of docs) {
      for (const t of d.tags) tagMap[t] = (tagMap[t] ?? 0) + 1
    }
    const topTags = Object.entries(tagMap).sort((a, b) => b[1] - a[1]).slice(0, 10)

    // Link aggregation
    const linkCounts = docs.map(d => d.links.length)
    const totalLinks = linkCounts.reduce((a, b) => a + b, 0)
    const avgLinks = docs.length > 0 ? (totalLinks / docs.length).toFixed(1) : '0'
    const orphanCount = docs.filter(d => d.links.length === 0).length
    const topLinked = [...docs].sort((a, b) => b.links.length - a.links.length).slice(0, 8)

    // Date range
    const dates = docs.map(d => d.date).filter(Boolean).sort()
    const dateRange = dates.length >= 2 ? `${dates[0]} ~ ${dates[dates.length - 1]}` : dates[0] ?? '-'

    // Image refs
    const totalImages = docs.reduce((acc, d) => acc + (d.imageRefs?.length ?? 0), 0)

    // Total characters (sum of rawContent)
    const totalChars = docs.reduce((acc, d) => acc + (d.rawContent?.length ?? 0), 0)
    const charLabel = totalChars > 1000
      ? `${(totalChars / 1000).toFixed(1)}K`
      : String(totalChars)

    return {
      docCount: docs.length,
      nodeCount: nodes.length,
      linkCount: links.length,
      speakerCounts,
      topTags,
      totalTagTypes: Object.keys(tagMap).length,
      avgLinks,
      orphanCount,
      topLinked,
      dateRange,
      totalImages,
      charLabel,
    }
  }, [docs, nodes, links])

  if (!vaultPath) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-16 gap-2">
        <span style={{ fontSize: 28, opacity: 0.2 }}>📂</span>
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Please load a vault first</p>
      </div>
    )
  }

  if (!stats) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-16 gap-2">
        <span style={{ fontSize: 28, opacity: 0.2 }}>📊</span>
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>No documents</p>
      </div>
    )
  }

  const row: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '4px 0',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
    fontSize: 11,
    gap: 8,
  }

  return (
    <div className="flex flex-col gap-6">

      {/* Summary cards */}
      <div style={{ display: 'flex', gap: 8 }}>
        <Card label="Total Docs" value={stats.docCount} />
        <Card label="Nodes" value={stats.nodeCount} />
        <Card label="Wires" value={stats.linkCount} />
        <Card label="Image Refs" value={stats.totalImages} />
        <Card label="Total Chars" value={stats.charLabel} />
      </div>

      {/* Date · Link overview */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <SectionTitle>Overview</SectionTitle>
        {[
          ['Date Range', stats.dateRange],
          ['Avg Links', `${stats.avgLinks} / doc`],
          ['Isolated Docs (no links)', `${stats.orphanCount}`],
          ['Unique Tag Count', `${stats.totalTagTypes}`],
        ].map(([k, v]) => (
          <div key={k} style={row}>
            <span style={{ color: 'var(--color-text-secondary)' }}>{k}</span>
            <span style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>{v}</span>
          </div>
        ))}
      </div>

      {/* Speaker distribution */}
      <div>
        <SectionTitle>Speaker Distribution</SectionTitle>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {Object.entries(stats.speakerCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([speaker, count]) => {
              const meta = SPEAKER_CONFIG[speaker as SpeakerId]
              return (
                <div key={speaker} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    fontSize: 10,
                    color: meta?.color ?? '#888',
                    minWidth: 46,
                    fontWeight: 600,
                  }}>
                    {meta?.label ?? speaker}
                  </span>
                  <div style={{ flex: 1 }}>
                    <MiniBar value={count} max={stats.docCount} color={meta?.color ?? '#888'} />
                  </div>
                  <span style={{ fontSize: 10, color: 'var(--color-text-muted)', minWidth: 30, textAlign: 'right' }}>
                    {count}
                  </span>
                </div>
              )
            })}
        </div>
      </div>

      {/* Top linked documents */}
      <div>
        <SectionTitle>Top Linked Documents</SectionTitle>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {stats.topLinked.map((doc, i) => (
            <div key={doc.id} style={row}>
              <span style={{ color: 'var(--color-text-muted)', fontSize: 10, minWidth: 16 }}>{i + 1}</span>
              <span style={{ color: 'var(--color-text-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {doc.filename}
              </span>
              <span style={{ color: 'var(--color-text-primary)', fontWeight: 600, minWidth: 30, textAlign: 'right' }}>
                {doc.links.length}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Top tags */}
      {stats.topTags.length > 0 && (
        <div>
          <SectionTitle>Top Tags</SectionTitle>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {stats.topTags.map(([tag, count]) => (
              <span
                key={tag}
                style={{
                  fontSize: 10,
                  padding: '2px 7px',
                  borderRadius: 4,
                  background: 'var(--color-bg-active)',
                  color: 'var(--color-text-secondary)',
                  border: '1px solid var(--color-border)',
                }}
              >
                {tag} <span style={{ opacity: 0.6 }}>{count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

    </div>
  )
}
