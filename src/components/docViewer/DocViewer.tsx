import { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronLeft, FileText, AlertTriangle, ArrowUp, ArrowDown } from 'lucide-react'
import { useUIStore } from '@/stores/uiStore'
import { useVaultStore } from '@/stores/vaultStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { MOCK_DOCUMENTS } from '@/data/mockDocuments'
import { SPEAKER_CONFIG } from '@/lib/speakerConfig'
import { cn } from '@/lib/utils'
import FrontmatterBlock from './FrontmatterBlock'
import ParagraphBlock from './ParagraphBlock'
import type { SpeakerId } from '@/types'

// Speaker authority order: lower index = higher authority
const SPEAKER_PRIORITY: Record<SpeakerId, number> = {
  chief_director: 0,
  art_director:   1,
  plan_director:  2,
  level_director: 3,
  prog_director:  4,
  unknown:        5,
}

export default function DocViewer() {
  const { selectedDocId, setCenterTab } = useUIStore()
  const { vaultPath, loadedDocuments } = useVaultStore()
  const isFast = useSettingsStore(s => s.paragraphRenderQuality === 'fast')
  const scrollRef = useRef<HTMLDivElement>(null)

  // Mock fallback: if no vault loaded, use MOCK_DOCUMENTS
  const allDocuments = (vaultPath && loadedDocuments) ? loadedDocuments : MOCK_DOCUMENTS
  const doc = allDocuments.find(d => d.id === selectedDocId)

  // Fast mode: lower threshold so almost all docs are virtualized (SVG skeletons are compact).
  // Normal mode: only virtualize large docs to keep tests and small-doc render simple.
  const VIRTUALIZE_THRESHOLD = isFast ? 3 : 15
  const sectionCount = doc?.sections.length ?? 0
  const shouldVirtualize = sectionCount >= VIRTUALIZE_THRESHOLD

  const virtualizer = useVirtualizer({
    count: shouldVirtualize ? sectionCount : 0,
    getScrollElement: () => scrollRef.current,
    // SVG skeleton sections are compact (~60px); normal rendered paragraphs average ~120px
    estimateSize: () => isFast ? 60 : 120,
    overscan: isFast ? 2 : 4,
    initialRect: { width: 0, height: 2000 },
  })

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar — matches GraphPanel style (height: 34) */}
      <div
        className="flex items-center shrink-0 px-2"
        style={{ borderBottom: '1px solid var(--color-border)', height: 34, background: 'var(--color-bg-secondary)' }}
      >
        <button
          onClick={() => setCenterTab('graph')}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1 text-xs rounded transition-colors',
            'hover:bg-[var(--color-bg-hover)]'
          )}
          style={{ color: 'var(--color-text-muted)' }}
          aria-label="Back to graph"
        >
          <ChevronLeft size={12} />
          Graph
        </button>
        <span
          className="flex items-center gap-1.5 px-3 py-1 text-xs rounded"
          style={{ background: 'var(--color-bg-hover)', color: 'var(--color-text-primary)' }}
        >
          <FileText size={12} />
          Document
        </span>
      </div>

      {/* Empty state */}
      {!doc && (
        <div
          className="flex-1 flex flex-col items-center justify-center"
          style={{ color: 'var(--color-text-muted)', fontSize: 12 }}
          data-testid="doc-viewer-empty"
        >
          <div style={{ marginBottom: 8 }}>← Select a document from the file tree</div>
          <div style={{ fontSize: 11, opacity: 0.5 }}>or click a node in the graph</div>
        </div>
      )}

      {/* Document content */}
      {doc && (() => {
        const speakerMeta = SPEAKER_CONFIG[doc.speaker]
        return (
          <div className="flex flex-col flex-1 min-h-0" data-testid="doc-viewer">
            {/* Document header */}
            <div
              className="shrink-0 px-6 pt-5 pb-3"
              style={{ borderBottom: '1px solid var(--color-border)' }}
            >
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="text-xs px-1.5 py-0.5 rounded"
                  style={{
                    background: speakerMeta.darkBg,
                    color: speakerMeta.color,
                    fontFamily: 'monospace',
                  }}
                >
                  {speakerMeta.label}
                </span>
                <span style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>{doc.date}</span>
              </div>
              <h1
                className="text-sm font-semibold"
                style={{ color: 'var(--color-text-primary)', fontFamily: 'monospace' }}
                data-testid="doc-filename"
              >
                {doc.filename}
              </h1>
              {doc.tags.length > 0 && (
                <div className="flex gap-1 mt-2 flex-wrap">
                  {doc.tags.map(tag => (
                    <span
                      key={tag}
                      className="text-xs px-1.5 py-0.5 rounded"
                      style={{
                        background: 'var(--color-bg-secondary)',
                        color: 'var(--color-text-muted)',
                        border: '1px solid var(--color-border)',
                      }}
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Scrollable content */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-5" data-testid="doc-content">
              <FrontmatterBlock doc={doc} />
              {/* Sections list — virtualized for large documents, direct render for small ones */}
              {shouldVirtualize ? (
                <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
                  {virtualizer.getVirtualItems().map(vItem => (
                    <div
                      key={vItem.key}
                      data-index={vItem.index}
                      ref={virtualizer.measureElement}
                      style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vItem.start}px)` }}
                    >
                      <ParagraphBlock section={doc.sections[vItem.index]} speaker={doc.speaker} />
                    </div>
                  ))}
                </div>
              ) : (
                doc.sections.map(section => (
                  <ParagraphBlock key={section.id} section={section} speaker={doc.speaker} />
                ))
              )}

              {/* Conflict / priority reference */}
              {(() => {
                if (!doc.tags.length) return null
                const myPriority = SPEAKER_PRIORITY[doc.speaker]
                const related = allDocuments
                  .filter(d => d.id !== doc.id && d.tags.some(t => doc.tags.includes(t)))
                  .sort((a, b) => SPEAKER_PRIORITY[a.speaker] - SPEAKER_PRIORITY[b.speaker])
                if (!related.length) return null

                const higherPriority = related.filter(d => SPEAKER_PRIORITY[d.speaker] < myPriority)

                return (
                  <div
                    className="mt-8 pt-5"
                    style={{ borderTop: '1px solid var(--color-border)' }}
                    data-testid="conflict-priority-section"
                  >
                    <div className="flex items-center gap-2 mb-3">
                      {higherPriority.length > 0 && (
                        <AlertTriangle size={12} style={{ color: '#f59e0b' }} />
                      )}
                      <span
                        className="text-xs font-semibold tracking-wide"
                        style={{ color: 'var(--color-text-muted)' }}
                      >
                        Priority Reference
                      </span>
                      {higherPriority.length > 0 && (
                        <span
                          className="text-xs px-1.5 py-0.5 rounded"
                          style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}
                        >
                          {higherPriority.length} higher-priority doc{higherPriority.length !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      {related.slice(0, 6).map(d => {
                        const cfg = SPEAKER_CONFIG[d.speaker]
                        const dPriority = SPEAKER_PRIORITY[d.speaker]
                        const isHigher = dPriority < myPriority
                        const isLower  = dPriority > myPriority
                        return (
                          <div
                            key={d.id}
                            className="flex items-center gap-2 text-xs py-1 px-2 rounded"
                            style={{
                              background: isHigher
                                ? 'rgba(245,158,11,0.06)'
                                : 'var(--color-bg-surface)',
                            }}
                          >
                            <span
                              className="shrink-0 px-1 py-0.5 rounded text-[10px] font-mono"
                              style={{ background: cfg.darkBg, color: cfg.color }}
                            >
                              {cfg.label}
                            </span>
                            <span
                              className="flex-1 truncate"
                              style={{ color: 'var(--color-text-secondary)' }}
                            >
                              {d.filename}
                            </span>
                            {isHigher && (
                              <span className="shrink-0 flex items-center gap-0.5" style={{ color: '#f59e0b' }}>
                                <ArrowUp size={10} />
                                <span>Higher</span>
                              </span>
                            )}
                            {isLower && (
                              <span className="shrink-0 flex items-center gap-0.5" style={{ color: 'var(--color-text-muted)' }}>
                                <ArrowDown size={10} />
                                <span>Lower</span>
                              </span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}
            </div>
          </div>
        )
      })()}
    </div>
  )
}
