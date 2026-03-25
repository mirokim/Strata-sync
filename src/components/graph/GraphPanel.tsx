import { useRef, useState, useEffect, useCallback } from 'react'
import { useUIStore } from '@/stores/uiStore'
import { useGraphStore } from '@/stores/graphStore'
import { useVaultStore } from '@/stores/vaultStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { Palette, Sparkles, X, Loader2 } from 'lucide-react'
import Graph2D from './Graph2D'
import Graph2DCanvas from './Graph2DCanvas'
import Graph3D from './Graph3D'
import type { NodeColorMode } from '@/types'
import {
  buildDeepGraphContextFromDocId,
  buildGlobalGraphContext,
  getBfsContextDocIds,
  getGlobalContextDocIds,
} from '@/lib/graphRAG'
import { streamMessage } from '@/services/llmClient'

const COLOR_MODES: { mode: NodeColorMode; label: string }[] = [
  { mode: 'document', label: 'Document' },
  { mode: 'auto',     label: 'Auto' },
  { mode: 'speaker',  label: 'Role' },
  { mode: 'folder',   label: 'Folder' },
  { mode: 'tag',      label: 'Tag' },
  { mode: 'topic',    label: 'Topic' },
]


interface AnalysisState {
  nodeName: string
  content: string
  loading: boolean
  phase?: 'Traversing' | 'Analyzing'
}

export default function GraphPanel() {
  const { graphMode, nodeColorMode, setNodeColorMode } = useUIStore()
  const { selectedNodeId, setAiHighlightNodes } = useGraphStore()
  const { loadedDocuments } = useVaultStore()
  const { personaModels } = useSettingsStore()
  const isFast = useSettingsStore(s => s.paragraphRenderQuality === 'fast')

  const floatBtnStyle: React.CSSProperties = isFast
    ? { background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', borderRadius: 6, padding: '5px 7px', cursor: 'pointer', lineHeight: 1 }
    : { background: 'var(--color-bg-overlay)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 6, padding: '5px 7px', cursor: 'pointer', lineHeight: 1, transition: 'color 0.15s' }

  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [analysis, setAnalysis] = useState<AnalysisState | null>(null)
  const abortRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        setSize({ width: e.contentRect.width, height: e.contentRect.height })
      }
    })
    ro.observe(el)
    setSize({ width: el.clientWidth, height: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const handleAnalyze = useCallback(async () => {
    // Abort any in-progress analysis + clear previous highlights
    abortRef.current?.()
    setAiHighlightNodes([])

    // Node selected: BFS from that node / No node selected: hub-based global traversal
    let context: string
    let nodeName: string

    if (selectedNodeId) {
      const doc = loadedDocuments?.find(d => d.id === selectedNodeId)
      nodeName = doc?.filename.replace(/\.md$/i, '') ?? selectedNodeId
      context = await buildDeepGraphContextFromDocId(selectedNodeId)
      setAiHighlightNodes(getBfsContextDocIds(selectedNodeId))
    } else {
      nodeName = 'Entire Project'
      context = await buildGlobalGraphContext(35, 4)
      setAiHighlightNodes(getGlobalContextDocIds(35, 4))
    }

    if (!context) {
      setAiHighlightNodes([])
      setAnalysis({ nodeName, content: 'Please check that the vault is loaded. No documents or connections found.', loading: false })
      return
    }

    // Phase 1: Mark graph traversal complete (BFS completes synchronously)
    setAnalysis({ nodeName, content: '', loading: true, phase: 'Traversing' })

    let aborted = false
    abortRef.current = () => { aborted = true }

    // Short delay to render the "Traversing" state for one UI frame
    await new Promise<void>(r => setTimeout(r, 60))
    if (aborted) return

    // Phase 2: Generate LLM insights
    setAnalysis(prev => prev ? { ...prev, phase: 'Analyzing' } : null)

    // Select the default director from personas (first configured one)
    const persona = (Object.keys(personaModels)[0] ?? 'chief_director') as Parameters<typeof streamMessage>[0]
    const prompt = selectedNodeId
      ? `Review all related nodes connected to the "${nodeName}" document via WikiLinks, and provide a specific analysis of key insights and areas for improvement.`
      : `Review the entire vault document structure and connections, and provide a specific analysis of key insights, gaps, and improvement directions across the project.`

    try {
      await streamMessage(
        persona,
        prompt,
        [],
        (chunk) => {
          if (aborted) return
          setAnalysis(prev => prev ? { ...prev, content: prev.content + chunk } : null)
        },
        undefined,
        context,
      )
    } catch {
      if (!aborted) {
        setAnalysis(prev => prev ? { ...prev, content: prev.content + '\n\n[An error occurred]', loading: false, phase: undefined } : null)
        setAiHighlightNodes([])
        return
      }
    }

    if (!aborted) {
      setAnalysis(prev => prev ? { ...prev, loading: false, phase: undefined } : null)
      setAiHighlightNodes([])
    }
  }, [selectedNodeId, loadedDocuments, personaModels, setAiHighlightNodes])

  const closeAnalysis = useCallback(() => {
    abortRef.current?.()
    setAiHighlightNodes([])
    setAnalysis(null)
  }, [setAiHighlightNodes])

  // Close previous analysis when selected node changes
  useEffect(() => {
    if (analysis && analysis.nodeName) closeAnalysis()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeId])

  const selectedDoc = selectedNodeId
    ? loadedDocuments?.find(d => d.id === selectedNodeId)
    : null
  const selectedName = selectedDoc?.filename.replace(/\.md$/i, '') ?? selectedNodeId

  return (
    <div ref={containerRef} className="relative overflow-hidden h-full" data-testid="graph-panel">
      {size.width > 0 && size.height > 0 && (
        isFast
          ? <Graph2DCanvas width={size.width} height={size.height} />
          : graphMode === '3d'
            ? <Graph3D width={size.width} height={size.height} />
            : <Graph2D width={size.width} height={size.height} />
      )}

      {/* Bottom-left buttons */}
      <div style={{ position: 'absolute', bottom: 12, left: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
        {/* Color mode toggle */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowColorPicker(v => !v)}
            style={{
              ...floatBtnStyle,
              color: nodeColorMode !== 'speaker' ? 'var(--color-accent)' : 'var(--color-text-muted)',
            }}
            title={`Node color: ${COLOR_MODES.find(m => m.mode === nodeColorMode)?.label}`}
            aria-label="Node color mode"
          >
            <Palette size={12} />
          </button>

          {showColorPicker && (
            <div
              style={{
                position: 'absolute',
                bottom: '100%',
                left: 0,
                marginBottom: 6,
                background: 'var(--color-bg-overlay)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 8,
                padding: '4px',
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                minWidth: 80,
                zIndex: 50,
              }}
            >
              {COLOR_MODES.map(({ mode, label }) => (
                <button
                  key={mode}
                  onClick={() => { setNodeColorMode(mode); setShowColorPicker(false) }}
                  style={{
                    background: nodeColorMode === mode ? 'var(--color-bg-active)' : 'transparent',
                    color: nodeColorMode === mode ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                    border: 'none',
                    borderRadius: 5,
                    padding: '5px 10px',
                    fontSize: 11,
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'background 0.1s',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Color by {label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* AI analysis button — always visible (node selected: node-centric / none: entire project) */}
        <button
          onClick={handleAnalyze}
          disabled={analysis?.loading}
          style={{
            ...floatBtnStyle,
            color: selectedNodeId ? 'var(--color-accent)' : 'var(--color-text-secondary)',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 11,
            padding: '5px 10px',
            opacity: analysis?.loading ? 0.6 : 1,
          }}
          title={selectedNodeId
            ? `Analyze documents connected to "${selectedName}" node with AI`
            : 'Analyze entire project documents with AI (hub node based)'
          }
        >
          {analysis?.loading
            ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} />
            : <Sparkles size={11} />
          }
          {selectedNodeId ? 'AI Analyze' : 'AI Analyze All'}
        </button>
      </div>

      {/* AI analysis result panel */}
      {analysis && (
        <div
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            width: 320,
            maxHeight: 'calc(100% - 24px)',
            background: isFast ? 'var(--color-bg-secondary)' : 'var(--color-bg-overlay)',
            ...(isFast ? {} : { backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)' }),
            border: isFast ? '1px solid var(--color-border)' : '1px solid rgba(255,255,255,0.1)',
            borderRadius: 10,
            display: 'flex',
            flexDirection: 'column',
            zIndex: 40,
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          }}
        >
          {/* Panel header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 10px',
            borderBottom: '1px solid rgba(255,255,255,0.07)',
            flexShrink: 0,
          }}>
            <Sparkles size={12} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
            <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {analysis.nodeName}
            </span>
            {analysis.loading && (
              <span style={{ fontSize: 10, color: analysis.phase === 'Traversing' ? 'var(--color-text-secondary)' : 'var(--color-text-muted)' }}>
                {analysis.phase ?? 'Analyzing'}…
              </span>
            )}
            <button
              onClick={closeAnalysis}
              style={{ background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: 2, display: 'flex', borderRadius: 3, transition: 'color 0.1s' }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-text-primary)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
            >
              <X size={13} />
            </button>
          </div>

          {/* Analysis content */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: '10px 12px',
            fontSize: 12,
            lineHeight: 1.7,
            color: 'var(--color-text-secondary)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}>
            {analysis.content || (analysis.loading ? '' : 'No analysis content')}
            {analysis.loading && !analysis.content && (
              <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                Traversing node connections…
              </span>
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
