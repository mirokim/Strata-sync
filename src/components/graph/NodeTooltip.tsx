import { useMemo } from 'react'
import { useGraphStore } from '@/stores/graphStore'
import { useVaultStore } from '@/stores/vaultStore'
import { MOCK_DOCUMENTS } from '@/data/mockDocuments'
import { SPEAKER_CONFIG } from '@/lib/speakerConfig'

interface NodeTooltipProps {
  nodeId: string
  /** Viewport X coordinate (from mousemove/event) */
  x: number
  /** Viewport Y coordinate */
  y: number
}

export default function NodeTooltip({ nodeId, x, y }: NodeTooltipProps) {
  const { nodes } = useGraphStore()
  const { vaultPath, loadedDocuments } = useVaultStore()

  // Use vault documents if loaded, otherwise fall back to mock
  const allDocuments = (vaultPath && loadedDocuments) ? loadedDocuments : MOCK_DOCUMENTS

  const info = useMemo(() => {
    const node = nodes.find(n => n.id === nodeId)
    if (!node) return null
    // node.id === doc.id (document-level nodes since Phase 7)
    const doc = allDocuments.find(d => d.id === node.docId)
    return { node, doc }
  }, [nodeId, nodes, allDocuments])

  if (!info) return null
  const { node, doc } = info
  const { color } = SPEAKER_CONFIG[node.speaker]

  const offsetX = x + 16
  const offsetY = y - 10

  return (
    <div
      role="tooltip"
      style={{
        position: 'fixed',
        left: offsetX,
        top: offsetY,
        zIndex: 9999,
        background: 'var(--color-bg-surface)',
        border: `1px solid ${color}`,
        borderRadius: 6,
        padding: '8px 10px',
        minWidth: 180,
        maxWidth: 280,
        pointerEvents: 'none',
        boxShadow: `0 4px 12px rgba(0,0,0,0.4), 0 0 0 1px ${color}22`,
      }}
    >
      {/* Speaker label */}
      <div className="text-[10px] font-semibold tracking-wider uppercase mb-1" style={{ color }}>
        {SPEAKER_CONFIG[node.speaker].label}
      </div>
      {/* Document name */}
      <div className="text-xs font-medium mb-1" style={{ color: 'var(--color-text-primary)' }}>
        {node.label}
      </div>
      {/* Doc filename */}
      {doc && (
        <div className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
          {doc.filename}
        </div>
      )}
      {/* Tags */}
      {doc && doc.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {doc.tags.slice(0, 3).map(tag => (
            <span
              key={tag}
              className="text-[9px] px-1.5 py-0.5 rounded"
              style={{ background: `${color}22`, color }}
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
