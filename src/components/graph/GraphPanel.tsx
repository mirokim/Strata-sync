import { useRef, useState, useEffect, useCallback, useMemo } from 'react'
import { useUIStore } from '@/stores/uiStore'
import { useGraphStore } from '@/stores/graphStore'
import { useVaultStore } from '@/stores/vaultStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { Palette, Sparkles, X, Loader2, Lightbulb, Search, Columns } from 'lucide-react'
import Graph2D from './Graph2D'
import Graph2DCanvas from './Graph2DCanvas'
import Graph3D from './Graph3D'
import CompareGraphCanvas from './CompareGraphCanvas'
import InsightsPanel from './InsightsPanel'
import GraphMinimap from './GraphMinimap'
import type { NodeColorMode } from '@/types'
import { buildGraph } from '@/lib/graphBuilder'
import {
  buildDeepGraphContextFromDocId,
  buildGlobalGraphContext,
  getBfsContextDocIds,
  getGlobalContextDocIds,
} from '@/lib/graphRAG'
import { streamMessage } from '@/services/llmClient'

const COLOR_MODES: { mode: NodeColorMode; label: string }[] = [
  { mode: 'document', label: '문서' },
  { mode: 'auto',     label: '자동' },
  { mode: 'speaker',  label: '역할' },
  { mode: 'folder',   label: '폴더' },
  { mode: 'tag',      label: '태그' },
  { mode: 'topic',    label: '주제' },
]


interface AnalysisState {
  nodeName: string
  content: string
  loading: boolean
  phase?: '탐색 중' | '분석 중'
}

const FLOAT_BTN_STYLE: React.CSSProperties = { background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', borderRadius: 2, padding: '5px 7px', cursor: 'pointer', lineHeight: 1, transition: 'color 0.15s' }

export default function GraphPanel() {
  const { graphMode, nodeColorMode, setNodeColorMode, compareVaultId, setCompareVault } = useUIStore()
  const { selectedNodeId, setAiHighlightNodes, nodes, setFocusNode, setSelectedNode } = useGraphStore()
  const { loadedDocuments, vaults, activeVaultId, vaultDocsCache } = useVaultStore()
  const { personaModels } = useSettingsStore()
  const isFast = useSettingsStore(s => s.paragraphRenderQuality === 'fast')

  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [showInsights, setShowInsights] = useState(false)
  const [analysis, setAnalysis] = useState<AnalysisState | null>(null)
  const analysisRef = useRef(analysis)
  analysisRef.current = analysis
  const abortRef = useRef<(() => void) | null>(null)
  const [showRagPreview, setShowRagPreview] = useState(false)

  // ── 노드 검색 ──────────────────────────────────────────────────────────────
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  // 검색어 기반 후보 노드 (label 기준, 최대 8개)
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return []
    return nodes
      .filter(n => !n.id.startsWith('_phantom_') && !n.id.startsWith('gallery:'))
      .filter(n => n.label.toLowerCase().includes(q))
      .slice(0, 8)
  }, [searchQuery, nodes])

  // 검색창 열릴 때 포커스
  useEffect(() => {
    if (showSearch) {
      const t = setTimeout(() => searchInputRef.current?.focus(), 50)
      return () => clearTimeout(t)
    } else {
      setSearchQuery('')
    }
  }, [showSearch])

  // Ctrl+F / Cmd+F 단축키
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        const active = document.activeElement
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return
        e.preventDefault()
        setShowSearch(v => !v)
      }
      if (e.key === 'Escape') setShowSearch(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const handleSelectSearchNode = useCallback((nodeId: string) => {
    setSelectedNode(nodeId)
    setFocusNode(nodeId)
    setShowSearch(false)
    setSearchQuery('')
  }, [setSelectedNode, setFocusNode])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let rafId = 0
    const ro = new ResizeObserver(entries => {
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        const e = entries[entries.length - 1]
        if (e) setSize({ width: e.contentRect.width, height: e.contentRect.height })
      })
    })
    ro.observe(el)
    setSize({ width: el.clientWidth, height: el.clientHeight })
    return () => { ro.disconnect(); cancelAnimationFrame(rafId) }
  }, [])

  const handleAnalyze = useCallback(async () => {
    // 이미 로딩 중이면 중복 실행 방지
    if (analysisRef.current?.loading) return
    // 진행 중인 분석 중단 + 이전 하이라이트 클리어
    abortRef.current?.()
    setAiHighlightNodes([])

    // 노드 선택 O: 해당 노드 중심 BFS / 노드 선택 X: 허브 기반 전체 탐색
    let context: string
    let nodeName: string

    if (selectedNodeId) {
      const doc = loadedDocuments?.find(d => d.id === selectedNodeId)
      nodeName = doc?.filename.replace(/\.md$/i, '') ?? selectedNodeId
      context = await buildDeepGraphContextFromDocId(selectedNodeId)
      setAiHighlightNodes(getBfsContextDocIds(selectedNodeId))
    } else {
      nodeName = '전체 프로젝트'
      context = await buildGlobalGraphContext(35, 4)
      setAiHighlightNodes(getGlobalContextDocIds(35, 4))
    }

    if (!context) {
      setAiHighlightNodes([])
      setAnalysis({ nodeName, content: '볼트가 로드되었는지 확인하세요. 문서가 없거나 연결이 없습니다.', loading: false })
      return
    }

    // Phase 1: 그래프 탐색 완료 표시 (BFS는 동기 즉시 완료됨)
    setAnalysis({ nodeName, content: '', loading: true, phase: '탐색 중' })

    let aborted = false
    abortRef.current = () => { aborted = true }

    // 짧은 딜레이로 "탐색 중" 상태를 UI에 한 프레임 렌더링
    await new Promise<void>(r => setTimeout(r, 60))
    if (aborted) return

    // Phase 2: LLM 인사이트 생성
    setAnalysis(prev => prev ? { ...prev, phase: '분석 중' } : null)

    // 페르소나에서 기본 디렉터 선택 (첫 번째 설정된 것)
    const persona = (Object.keys(personaModels)[0] ?? 'chief_director') as Parameters<typeof streamMessage>[0]
    const prompt = selectedNodeId
      ? `"${nodeName}" 문서와 WikiLink로 연결된 모든 관련 노드들을 검토하고, 핵심 인사이트와 개선 포인트를 구체적으로 분석해주세요.`
      : `볼트 전체 문서 구조와 연결 관계를 검토하고, 프로젝트 전반의 핵심 인사이트, 공백 영역, 개선 방향을 구체적으로 분석해주세요.`

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
        setAnalysis(prev => {
          if (!prev) return null
          // 청크 수신 전 에러라면 content가 빈 문자열일 수 있음 — append 대신 직접 설정
          const msg = '[오류가 발생했습니다]'
          return { ...prev, content: prev.content ? prev.content + '\n\n' + msg : msg, loading: false, phase: undefined }
        })
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

  // 선택 노드가 바뀌면 이전 분석 닫기
  useEffect(() => {
    if (analysis && analysis.nodeName) closeAnalysis()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeId])

  const selectedDoc = selectedNodeId
    ? loadedDocuments?.find(d => d.id === selectedNodeId)
    : null
  const selectedName = selectedDoc?.filename.replace(/\.md$/i, '') ?? selectedNodeId

  // 비교 볼트 그래프 데이터
  const compareGraph = useMemo(() => {
    if (!compareVaultId) return null
    const docs = vaultDocsCache[compareVaultId]
    if (!docs || docs.length === 0) return null
    return buildGraph(docs)
  }, [compareVaultId, vaultDocsCache])

  const compareLabel = compareVaultId
    ? (vaults[compareVaultId]?.label || vaults[compareVaultId]?.path.split(/[/\\]/).pop() || compareVaultId)
    : ''
  const activeLabel = activeVaultId
    ? (vaults[activeVaultId]?.label || vaults[activeVaultId]?.path.split(/[/\\]/).pop() || '')
    : ''

  // 비교 볼트 선택 목록 (현재 활성 볼트 제외)
  const compareOptions = Object.entries(vaults).filter(([id]) => id !== activeVaultId)

  const halfWidth = compareVaultId ? Math.floor(size.width / 2) : size.width

  return (
    <div ref={containerRef} className="relative overflow-hidden h-full" data-testid="graph-panel">
      {size.width > 0 && size.height > 0 && (
        compareVaultId && compareGraph ? (
          <div style={{ display: 'flex', width: '100%', height: '100%' }}>
            {/* 왼쪽: 현재 활성 볼트 */}
            <div style={{ flex: 1, position: 'relative', borderRight: '1px solid var(--color-border)' }}>
              {isFast
                ? <Graph2DCanvas width={halfWidth} height={size.height} />
                : graphMode === '3d'
                  ? <Graph3D width={halfWidth} height={size.height} />
                  : <Graph2DCanvas width={halfWidth} height={size.height} />
              }
              <div style={{ position: 'absolute', top: 8, left: 8, fontSize: 10, color: 'var(--color-text-muted)', background: 'var(--color-bg-secondary)', padding: '2px 8px', borderRadius: 3, border: '1px solid var(--color-border)', pointerEvents: 'none' }}>
                {activeLabel}
              </div>
            </div>
            {/* 오른쪽: 비교 볼트 */}
            <div style={{ flex: 1, position: 'relative' }}>
              <CompareGraphCanvas
                nodes={compareGraph.nodes}
                links={compareGraph.links}
                label={compareLabel}
                width={halfWidth}
                height={size.height}
              />
              <div style={{ position: 'absolute', top: 8, left: 8, fontSize: 10, color: 'var(--color-text-muted)', background: 'var(--color-bg-secondary)', padding: '2px 8px', borderRadius: 3, border: '1px solid var(--color-border)', pointerEvents: 'none' }}>
                {compareLabel}
              </div>
            </div>
          </div>
        ) : (
          isFast
            ? <Graph2DCanvas width={size.width} height={size.height} />
            : graphMode === '3d'
              ? <Graph3D width={size.width} height={size.height} />
              : <Graph2DCanvas width={size.width} height={size.height} />
        )
      )}

      {/* Bottom-left buttons */}
      <div style={{ position: 'absolute', bottom: 12, left: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
        {/* Color mode toggle */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowColorPicker(v => !v)}
            style={{
              ...FLOAT_BTN_STYLE,
              color: nodeColorMode !== 'speaker' ? 'var(--color-accent)' : 'var(--color-text-muted)',
            }}
            title={`노드 색상: ${COLOR_MODES.find(m => m.mode === nodeColorMode)?.label}`}
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
                background: 'var(--color-bg-secondary)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 2,
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
                    borderRadius: 2,
                    padding: '5px 10px',
                    fontSize: 11,
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'background 0.1s',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {label}별 색상
                </button>
              ))}
            </div>
          )}
        </div>

        {/* AI 분석 버튼 — 항상 표시 (노드 선택 O: 노드 중심 / X: 전체 프로젝트) */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={handleAnalyze}
            onMouseEnter={() => setShowRagPreview(true)}
            onMouseLeave={() => setShowRagPreview(false)}
            disabled={analysis?.loading}
            style={{
              ...FLOAT_BTN_STYLE,
              color: selectedNodeId ? 'var(--color-accent)' : 'var(--color-text-secondary)',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
              padding: '5px 10px',
              opacity: analysis?.loading ? 0.6 : 1,
            }}
            title={selectedNodeId
              ? `"${selectedName}" 노드와 연결된 문서를 AI로 분석`
              : '전체 프로젝트 문서를 AI로 분석 (허브 노드 기반)'
            }
          >
            {analysis?.loading
              ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} />
              : <Sparkles size={11} />
            }
            {selectedNodeId ? 'AI 분석' : 'AI 전체 분석'}
          </button>

          {/* RAG 컨텍스트 미리보기 */}
          {showRagPreview && !analysis?.loading && (() => {
            const previewIds = selectedNodeId
              ? getBfsContextDocIds(selectedNodeId)
              : getGlobalContextDocIds(35, 4)
            const previewDocs = previewIds
              .map(id => loadedDocuments?.find(d => d.id === id))
              .filter(Boolean)
            if (previewDocs.length === 0) return null
            return (
              <div style={{
                position: 'absolute', bottom: '100%', left: 0, marginBottom: 4,
                background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)',
                borderRadius: 4, padding: '6px 8px', zIndex: 60,
                boxShadow: '0 4px 16px rgba(0,0,0,0.4)', minWidth: 200, maxWidth: 280,
                pointerEvents: 'none',
              }}>
                <div style={{ fontSize: 9, color: 'var(--color-text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  RAG 컨텍스트 ({previewDocs.length}개)
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 180, overflowY: 'auto' }}>
                  {previewDocs.map(d => (
                    <div key={d!.id} style={{ fontSize: 10, color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {d!.filename.replace(/\.md$/i, '')}
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}
        </div>

        {/* 볼트 인사이트 버튼 */}
        <button
          onClick={() => setShowInsights(v => !v)}
          style={{
            ...FLOAT_BTN_STYLE,
            color: showInsights ? 'var(--color-accent)' : 'var(--color-text-muted)',
            display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, padding: '5px 10px',
          }}
          title="볼트 그래프 인사이트 — 허브, 고립, 빈틈, 클러스터 분석"
        >
          <Lightbulb size={11} />
          인사이트
        </button>

        {/* 노드 검색 버튼 */}
        <button
          onClick={() => setShowSearch(v => !v)}
          style={{
            ...FLOAT_BTN_STYLE,
            color: showSearch ? 'var(--color-accent)' : 'var(--color-text-muted)',
            display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, padding: '5px 10px',
          }}
          title="노드 검색 (Ctrl+F)"
        >
          <Search size={11} />
          검색
        </button>

        {/* 비교 뷰 버튼 — 등록된 볼트 2개 이상일 때 표시 */}
        {compareOptions.length > 0 && (
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => compareVaultId ? setCompareVault(null) : setCompareVault(compareOptions[0][0])}
              style={{
                ...FLOAT_BTN_STYLE,
                color: compareVaultId ? 'var(--color-accent)' : 'var(--color-text-muted)',
                display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, padding: '5px 10px',
              }}
              title={compareVaultId ? '비교 뷰 닫기' : '볼트 비교 뷰'}
            >
              <Columns size={11} />
              비교
            </button>
            {compareOptions.length > 1 && compareVaultId && (
              <div style={{
                position: 'absolute', bottom: '100%', left: 0, marginBottom: 4,
                background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)',
                borderRadius: 2, minWidth: 140, zIndex: 50, overflow: 'hidden',
              }}>
                {compareOptions.map(([id, entry]) => {
                  const lbl = entry.label || entry.path.split(/[/\\]/).pop() || id
                  return (
                    <button
                      key={id}
                      onClick={() => setCompareVault(id)}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: '5px 10px', background: compareVaultId === id ? 'var(--color-bg-active)' : 'transparent',
                        color: compareVaultId === id ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                        border: 'none', cursor: 'pointer', fontSize: 11, whiteSpace: 'nowrap',
                        overflow: 'hidden', textOverflow: 'ellipsis',
                      }}
                    >
                      {lbl}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 노드 검색 패널 */}
      {showSearch && (
        <div style={{
          position: 'absolute',
          top: 12,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 280,
          background: 'var(--color-bg-secondary)',
          border: '1px solid var(--color-border)',
          borderRadius: 4,
          zIndex: 50,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          overflow: 'hidden',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', padding: '6px 10px', gap: 6, borderBottom: searchResults.length > 0 ? '1px solid var(--color-border)' : 'none' }}>
            <Search size={12} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="노드 이름 검색…"
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                fontSize: 12,
                color: 'var(--color-text-primary)',
              }}
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: 0, lineHeight: 1 }}>
                <X size={11} />
              </button>
            )}
          </div>
          {searchResults.length > 0 && (
            <div style={{ maxHeight: 240, overflowY: 'auto' }}>
              {searchResults.map(node => (
                <button
                  key={node.id}
                  onClick={() => handleSelectSearchNode(node.id)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '7px 12px',
                    background: 'transparent',
                    border: 'none',
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                    cursor: 'pointer',
                    fontSize: 12,
                    color: 'var(--color-text-primary)',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--color-bg-active)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                >
                  {node.label}
                </button>
              ))}
            </div>
          )}
          {searchQuery.trim() && searchResults.length === 0 && (
            <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--color-text-muted)' }}>
              결과 없음
            </div>
          )}
        </div>
      )}

      {/* Insights 패널 */}
      {showInsights && <InsightsPanel onClose={() => setShowInsights(false)} />}
      {!isFast && <GraphMinimap />}

      {/* AI 분석 결과 패널 */}
      {analysis && (
        <div
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            width: 320,
            maxHeight: 'calc(100% - 24px)',
            background: 'var(--color-bg-secondary)',
            border: '1px solid var(--color-border)',
            borderRadius: 2,
            display: 'flex',
            flexDirection: 'column',
            zIndex: 40,
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          }}
        >
          {/* 패널 헤더 */}
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
              <span style={{ fontSize: 10, color: analysis.phase === '탐색 중' ? 'var(--color-text-secondary)' : 'var(--color-text-muted)' }}>
                {analysis.phase ?? '분석 중'}…
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

          {/* 분석 내용 */}
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
            {analysis.content || (analysis.loading ? '' : '분석 내용 없음')}
            {analysis.loading && !analysis.content && (
              <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                노드 연결을 탐색 중입니다…
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
