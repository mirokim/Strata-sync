import { useRef, useState, useCallback, useEffect, useLayoutEffect, useMemo, type CSSProperties } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useGraphStore } from '@/stores/graphStore'
import { useUIStore } from '@/stores/uiStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useGraphSimulation, type SimNode, type SimLink } from '@/hooks/useGraphSimulation'
import { SPEAKER_CONFIG } from '@/lib/speakerConfig'
import { LABEL_MIN_GAP, GRAPH_VIEW_PADDING } from '@/lib/constants'
import { buildNodeColorMap, getNodeColor, lightenColor, degreeScaleFactor, degreeSize, DEGREE_LIGHT_MAX } from '@/lib/nodeColors'
import type { GraphNode, GraphLink } from '@/types'
import NodeTooltip from './NodeTooltip'

interface Props {
  width: number
  height: number
}

const LABEL_Y_OFFSET = 16  // px below node center

export default function Graph2D({ width, height }: Props) {
  const { nodes, links, selectedNodeId, hoveredNodeId, aiHighlightNodeIds, setSelectedNode, setHoveredNode, physics, setGraphLayoutReady, degreeMap, maxDegree, adjacencyByIndex } = useGraphStore(
    useShallow(s => ({
      nodes: s.nodes,
      links: s.links,
      selectedNodeId: s.selectedNodeId,
      hoveredNodeId: s.hoveredNodeId,
      aiHighlightNodeIds: s.aiHighlightNodeIds,
      setSelectedNode: s.setSelectedNode,
      setHoveredNode: s.setHoveredNode,
      physics: s.physics,
      setGraphLayoutReady: s.setGraphLayoutReady,
      degreeMap: s.degreeMap,
      maxDegree: s.maxDegree,
      adjacencyByIndex: s.adjacencyByIndex,
    }))
  )
  const { setSelectedDoc, setCenterTab, centerTab, nodeColorMode, openInEditor } = useUIStore()
  const showNodeLabels = useSettingsStore(s => s.showNodeLabels)
  const isFast = useSettingsStore(s => s.paragraphRenderQuality === 'fast')
  const isFastRef = useRef(isFast)
  isFastRef.current = isFast
  const tagColors = useSettingsStore(s => s.tagColors)
  const folderColors = useSettingsStore(s => s.folderColors)

  const nodeColorMap = useMemo(
    () => buildNodeColorMap(nodes, nodeColorMode, tagColors, folderColors),
    [nodes, nodeColorMode, tagColors, folderColors]
  )

  // degreeMap, maxDegree, adjacencyByIndex — precomputed in graphStore.setLinks()
  // (no local useMemo needed — avoids O(|E|) rebuild per render)

  // DOM refs — updated imperatively in simulation tick (avoids React re-render per frame)
  // SVGCircleElement (doc nodes) or SVGRectElement (image nodes)
  const nodeEls = useRef<Map<string, SVGCircleElement | SVGRectElement>>(new Map())
  const labelEls = useRef<Map<string, SVGTextElement>>(new Map())
  const linkEls = useRef<Map<number, SVGLineElement>>(new Map())
  const selRingEl = useRef<SVGCircleElement | null>(null)

  // Ref-based selected ID — keeps handleTick stable (no deps on selectedNodeId)
  const selectedNodeIdRef = useRef(selectedNodeId)
  selectedNodeIdRef.current = selectedNodeId

  // Degree map refs — stable access from tick/zoom callbacks (no stale closure)
  const degreeMapRef = useRef(degreeMap)
  degreeMapRef.current = degreeMap
  const maxDegreeRef = useRef(maxDegree)
  maxDegreeRef.current = maxDegree
  const showNodeLabelsRef = useRef(showNodeLabels)
  showNodeLabelsRef.current = showNodeLabels

  // Last sim nodes for culling after zoom
  const lastSimNodesRef = useRef<SimNode[]>([])
  // Throttle counter — cull every N ticks only
  const cullTickCountRef = useRef(0)

  /** Screen-space overlap culling for SVG labels.
   *  Hides labels that are too close to higher-priority (hub) labels.
   *  Also counter-scales font size so labels stay ~11px on screen. */
  const cullSVGLabels = useCallback((simNodes: SimNode[]) => {
    if (!showNodeLabelsRef.current) return
    const { scale, x: tx, y: ty } = viewRef.current
    const MIN_GAP = LABEL_MIN_GAP
    const labelMap = labelEls.current
    const dMap = degreeMapRef.current
    const maxDeg = maxDegreeRef.current
    const selId = selectedNodeIdRef.current

    const sorted = [...simNodes].sort((a, b) => {
      if (a.id === selId) return -1
      if (b.id === selId) return 1
      return (dMap.get(b.id) ?? 0) - (dMap.get(a.id) ?? 0)
    })

    const fontSize = `${9 / scale}px`
    // Grid-based spatial bucketing: O(1) per label instead of O(n) scan
    // Each cell = MIN_GAP px; check 3×3 neighbourhood ≈ original MIN_GAP bounding-box check
    const occupied = new Set<number>()
    const cellOf = (v: number) => Math.floor(v / MIN_GAP)
    // Numeric key encoding: avoids string concat/hashing in hot path
    // Offset by 5000 to handle negative coords; width = 10001
    const KEY_W = 10001
    const KEY_OFF = 5000
    const cellKey = (cx: number, cy: number) => (cx + KEY_OFF) * KEY_W + (cy + KEY_OFF)

    for (const node of sorted) {
      const lEl = labelMap.get(node.id)
      if (!lEl) continue
      const isSelected = node.id === selId
      const deg = dMap.get(node.id) ?? 0

      if (!isSelected && scale < 0.4 && deg < maxDeg * 0.15) {
        lEl.setAttribute('opacity', '0')
        continue
      }

      const sx = node.x * scale + tx
      const sy = node.y * scale + ty
      const gcx = cellOf(sx)
      const gcy = cellOf(sy)

      let tooClose = false
      if (!isSelected) {
        outer: for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            if (occupied.has(cellKey(gcx + dx, gcy + dy))) { tooClose = true; break outer }
          }
        }
      }
      if (tooClose) {
        lEl.setAttribute('opacity', '0')
      } else {
        occupied.add(cellKey(gcx, gcy))
        lEl.setAttribute('opacity', isSelected ? '0.95' : '0.7')
        lEl.style.fontSize = fontSize
      }
    }
  }, [])  // stable — all data accessed via refs

  // Pan/zoom refs — using refs (not state) to avoid re-renders that would reset imperative cx/cy
  const svgRef = useRef<SVGSVGElement>(null)
  const graphGroupRef = useRef<SVGGElement>(null)
  const labelGroupRef = useRef<SVGGElement>(null)
  const viewRef = useRef({ x: 0, y: 0, scale: 1 })
  const isPanningRef = useRef(false)
  const panStartRef = useRef({ mx: 0, my: 0, tx: 0, ty: 0 })
  // true while wheel-zooming — suppresses hover effects during scroll
  const isScrollingRef = useRef(false)
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Drag state — which node is being dragged
  const draggingNodeRef = useRef<string | null>(null)
  const isDraggedRef = useRef(false)          // true only after drag threshold exceeded
  const mouseDownPosRef = useRef({ x: 0, y: 0 })

  // Adjacency map: nodeId → Set<linkIndex> (built from graphStore links)
  const adjacencyRef = useRef<Map<string, Set<number>>>(new Map())
  // Node ID → node data map for O(1) lookups in hover effect
  const nodeDataMapRef = useRef<Map<string, GraphNode>>(new Map())
  // Track previously highlighted nodes/links for delta-only hover updates
  const prevHighlightedNodeIds = useRef<Set<string>>(new Set())
  const prevHighlightedLinkIdxs = useRef<Set<number>>(new Set())

  const [tooltip, setTooltip] = useState<{ nodeId: string; x: number; y: number } | null>(null)

  // ── Simulation tick — direct DOM mutation, no React state ──────────────────
  const handleTick = useCallback((simNodes: SimNode[], simLinks: SimLink[]) => {
    lastSimNodesRef.current = simNodes
    const selId = selectedNodeIdRef.current
    let selNode: SimNode | undefined
    for (const node of simNodes) {
      if (node.id === selId) selNode = node  // O(1) capture during existing loop
      const el = nodeEls.current.get(node.id)
      if (el) {
        if (el.tagName.toLowerCase() === 'rect') {
          // Image node (rect): update x/y relative to center + rotate transform
          const halfW = parseFloat(el.getAttribute('width') ?? '12') / 2
          el.setAttribute('x', String(node.x - halfW))
          el.setAttribute('y', String(node.y - halfW))
          el.setAttribute('transform', `rotate(45, ${node.x}, ${node.y})`)
        } else {
          el.setAttribute('cx', String(node.x))
          el.setAttribute('cy', String(node.y))
        }
      }
      const lEl = labelEls.current.get(node.id)
      if (lEl) {
        lEl.setAttribute('x', String(node.x ?? 0))
        lEl.setAttribute('y', String((node.y ?? 0) + LABEL_Y_OFFSET))
      }
    }
    if (selRingEl.current && selNode) {
      selRingEl.current.setAttribute('cx', String(selNode.x))
      selRingEl.current.setAttribute('cy', String(selNode.y))
    }
    simLinks.forEach((link, i) => {
      const el = linkEls.current.get(i)
      if (!el) return
      const src = link.source as SimNode
      const tgt = link.target as SimNode
      el.setAttribute('x1', String(src.x ?? 0))
      el.setAttribute('y1', String(src.y ?? 0))
      el.setAttribute('x2', String(tgt.x ?? 0))
      el.setAttribute('y2', String(tgt.y ?? 0))
    })
    // Throttle label culling — every 8 ticks to avoid per-frame O(n²) cost
    cullTickCountRef.current++
    if (cullTickCountRef.current % 8 === 0) {
      cullSVGLabels(simNodes)
    }
  }, [cullSVGLabels])  // stable — reads everything else via refs

  // ── Fit all nodes into viewport ───────────────────────────────────────────
  const fitView = useCallback((simNodes: SimNode[]) => {
    if (simNodes.length === 0 || !graphGroupRef.current) return
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const n of simNodes) {
      if (n.x < minX) minX = n.x
      if (n.x > maxX) maxX = n.x
      if (n.y < minY) minY = n.y
      if (n.y > maxY) maxY = n.y
    }
    const graphW = Math.max(maxX - minX, 100)
    const graphH = Math.max(maxY - minY, 100)
    const padding = GRAPH_VIEW_PADDING
    const scaleX = (width - padding * 2) / graphW
    const scaleY = (height - padding * 2) / graphH
    const scale = Math.min(scaleX, scaleY, 2)
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    viewRef.current = { x: width / 2 - cx * scale, y: height / 2 - cy * scale, scale }
    graphGroupRef.current.setAttribute(
      'transform',
      `translate(${viewRef.current.x},${viewRef.current.y}) scale(${viewRef.current.scale})`
    )
    setGraphLayoutReady(true)
    // Apply label culling now that final scale is known
    cullSVGLabels(simNodes)
  }, [width, height, setGraphLayoutReady, cullSVGLabels])

  const { simRef, simNodesRef } = useGraphSimulation({ width, height, onTick: handleTick, onComplete: fitView })

  // ── Node data map: ID → GraphNode for O(1) hover lookups ─────────────────
  useEffect(() => {
    nodeDataMapRef.current = new Map(nodes.map(n => [n.id, n]))
  }, [nodes])

  // ── Sync adjacencyRef from store (precomputed in setLinks — no local rebuild) ──
  useEffect(() => { adjacencyRef.current = adjacencyByIndex }, [adjacencyByIndex])

  // ── Helper: client coords → graph (simulation) coords ─────────────────────
  const clientToGraph = useCallback((clientX: number, clientY: number) => {
    const el = svgRef.current
    if (!el) return { x: 0, y: 0 }
    const rect = el.getBoundingClientRect()
    const v = viewRef.current
    return {
      x: (clientX - rect.left - v.x) / v.scale,
      y: (clientY - rect.top - v.y) / v.scale,
    }
  }, [])

  // ── Pan/zoom: wheel zoom ──────────────────────────────────────────────────
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault()
    // Mark as scrolling — suppresses hover tooltip while zooming
    isScrollingRef.current = true
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current)
    scrollTimeoutRef.current = setTimeout(() => { isScrollingRef.current = false }, 300)

    const view = viewRef.current
    const el = svgRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top
    const zoomFactor = e.deltaY < 0 ? 1.12 : 1 / 1.12
    const newScale = Math.min(6, Math.max(0.15, view.scale * zoomFactor))
    const ratio = newScale / view.scale
    viewRef.current = {
      x: mouseX - ratio * (mouseX - view.x),
      y: mouseY - ratio * (mouseY - view.y),
      scale: newScale,
    }
    if (graphGroupRef.current) {
      const v = viewRef.current
      graphGroupRef.current.setAttribute('transform', `translate(${v.x},${v.y}) scale(${v.scale})`)
    }
    cullSVGLabels(lastSimNodesRef.current)
  }, [cullSVGLabels])

  // Register non-passive wheel listener (React synthetic events are passive by default)
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', handleWheel)
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current)
    }
  }, [handleWheel])

  // ── Global mouseup: release drag or pan even when mouse leaves SVG ─────────
  useEffect(() => {
    const handleGlobalUp = () => {
      if (draggingNodeRef.current) {
        const simNode = simNodesRef.current.find(n => n.id === draggingNodeRef.current)
        if (simNode) {
          simNode.fx = null
          simNode.fy = null
        }
        simRef.current?.alphaTarget(0)
        draggingNodeRef.current = null
        setHoveredNode(null)
        // Only remove tooltip for actual drag (clicks show tooltip via onClick)
        if (isDraggedRef.current) setTooltip(null)
        isDraggedRef.current = false
      }
      if (isPanningRef.current) {
        isPanningRef.current = false
        if (svgRef.current) svgRef.current.style.cursor = 'grab'
      }
    }
    window.addEventListener('mouseup', handleGlobalUp)
    return () => window.removeEventListener('mouseup', handleGlobalUp)
  }, [simNodesRef, simRef, setHoveredNode])

  // ── Pan/zoom: mouse drag (background only) ────────────────────────────────
  const handleSVGMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    // Only pan on background, not on interactive nodes/text
    const target = e.target as Element
    if (target.closest('circle') || target.closest('text')) return
    isPanningRef.current = true
    panStartRef.current = {
      mx: e.clientX,
      my: e.clientY,
      tx: viewRef.current.x,
      ty: viewRef.current.y,
    }
    if (svgRef.current) svgRef.current.style.cursor = 'grabbing'
  }, [])

  const handleSVGMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    // Node drag takes priority over background pan
    if (draggingNodeRef.current) {
      // Only classify as drag when exceeding 4px threshold
      if (!isDraggedRef.current) {
        const dx = e.clientX - mouseDownPosRef.current.x
        const dy = e.clientY - mouseDownPosRef.current.y
        if (dx * dx + dy * dy > 16) isDraggedRef.current = true
      }
      if (!isDraggedRef.current) return  // Below threshold — still treating as click
      setTooltip(null)  // Remove tooltip when drag is confirmed
      const { x, y } = clientToGraph(e.clientX, e.clientY)
      const simNode = simNodesRef.current.find(n => n.id === draggingNodeRef.current)
      if (simNode) {
        simNode.fx = x
        simNode.fy = y
        simRef.current?.alphaTarget(0.3).restart()
      }
      return
    }
    if (!isPanningRef.current) return
    const dx = e.clientX - panStartRef.current.mx
    const dy = e.clientY - panStartRef.current.my
    viewRef.current = {
      ...viewRef.current,
      x: panStartRef.current.tx + dx,
      y: panStartRef.current.ty + dy,
    }
    if (graphGroupRef.current) {
      const v = viewRef.current
      graphGroupRef.current.setAttribute('transform', `translate(${v.x},${v.y}) scale(${v.scale})`)
    }
  }, [clientToGraph, simNodesRef, simRef])

  const handleSVGMouseUp = useCallback(() => {
    if (draggingNodeRef.current) {
      const simNode = simNodesRef.current.find(n => n.id === draggingNodeRef.current)
      if (simNode) {
        simNode.fx = null
        simNode.fy = null
      }
      simRef.current?.alphaTarget(0)
      draggingNodeRef.current = null
      if (svgRef.current) svgRef.current.style.cursor = 'grab'
      return
    }
    isPanningRef.current = false
    if (svgRef.current) svgRef.current.style.cursor = 'grab'
  }, [simNodesRef, simRef])

  // ── Hide label group only when overlay panel is active (opacity controls per-label) ──
  useEffect(() => {
    if (!labelGroupRef.current) return
    labelGroupRef.current.style.display = centerTab === 'graph' ? '' : 'none'
  }, [centerTab])

  // ── Inject styles once on mount ───────────────────────────────────────────
  useEffect(() => {
    const style = document.createElement('style')
    style.textContent = `
      @keyframes aiScan {
        0%, 100% { opacity: 0.45; }
        50%       { opacity: 1; }
      }
      .graph-faded circle:not([data-hl]) { opacity: 0.12 !important; filter: none !important; }
      .graph-faded line:not([data-hl])   { opacity: 0.04 !important; stroke: var(--color-border) !important; stroke-width: 1px !important; }
      .graph-faded text:not([data-hl])   { opacity: 0 !important; }
      .graph-ai-faded circle:not([data-hl]) { opacity: 0.1 !important; filter: none !important; }
      .graph-ai-faded line  { opacity: 0.05 !important; }
      .graph-ai-faded text:not([data-hl])   { opacity: 0 !important; }
    `
    document.head.appendChild(style)
    return () => { style.remove() }
  }, [])

  // ── AI highlight: pulse + fade non-highlighted nodes ─────────────────────
  useLayoutEffect(() => {
    const nodeMap = nodeEls.current
    const graphGroup = graphGroupRef.current
    const clearHighlights = () => {
      graphGroup?.classList.remove('graph-ai-faded')
      nodeMap.forEach(el => {
        el.style.animation = ''
        el.removeAttribute('data-hl')
      })
    }
    if (aiHighlightNodeIds.length === 0) {
      clearHighlights()
      return
    }
    const highlightSet = new Set(aiHighlightNodeIds)
    graphGroup?.classList.add('graph-ai-faded')
    nodes.forEach(n => {
      const el = nodeMap.get(n.id)
      if (!el) return
      if (highlightSet.has(n.docId)) {
        el.setAttribute('data-hl', '1')
        el.style.animation = 'aiScan 1.4s ease-in-out infinite'
      } else {
        el.removeAttribute('data-hl')
        el.style.animation = ''
      }
    })
    return clearHighlights
  }, [aiHighlightNodeIds, nodes])

  // ── Node event handlers ───────────────────────────────────────────────────

  // Start dragging: pin node at current mouse position, activate highlight
  const handleNodeMouseDown = useCallback((nodeId: string, e: React.MouseEvent) => {
    e.stopPropagation()  // prevent SVG pan from starting
    draggingNodeRef.current = nodeId
    isDraggedRef.current = false
    mouseDownPosRef.current = { x: e.clientX, y: e.clientY }
    const { x, y } = clientToGraph(e.clientX, e.clientY)
    const simNode = simNodesRef.current.find(n => n.id === nodeId)
    if (simNode) {
      simNode.fx = x
      simNode.fy = y
      simRef.current?.alphaTarget(0.3).restart()
    }
    if (svgRef.current) svgRef.current.style.cursor = 'grabbing'
    setHoveredNode(nodeId)
  }, [clientToGraph, simNodesRef, simRef, setHoveredNode])

  // Single click: select node and show tooltip
  const handleNodeClick = useCallback((nodeId: string, e: React.MouseEvent) => {
    e.stopPropagation()  // Prevent bubbling to SVG empty space onClick
    setSelectedNode(nodeId)
    setTooltip({ nodeId, x: e.clientX, y: e.clientY })
  }, [setSelectedNode])

  // Double click: select + open editor (skip phantom nodes)
  const handleNodeDoubleClick = useCallback((nodeId: string, docId: string) => {
    setSelectedNode(nodeId)
    setSelectedDoc(docId)
    if (!docId.startsWith('_phantom_')) openInEditor(docId)
  }, [setSelectedNode, setSelectedDoc, openInEditor])

  // Hover: highlight only — tooltip appears on mousedown/click, not hover
  // Fast mode: skip hover entirely (no label reveal, no neighbor highlight)
  const handleMouseEnter = useCallback((nodeId: string) => {
    if (isFastRef.current) return
    if (isPanningRef.current || isScrollingRef.current) return
    setHoveredNode(nodeId)
  }, [setHoveredNode])

  const handleMouseLeave = useCallback(() => {
    // Don't clear hover while actively dragging this node
    if (draggingNodeRef.current) return
    isPanningRef.current = false
    setHoveredNode(null)
    // Tooltip is pinned by click, so it persists when mouse leaves the node
  }, [setHoveredNode])

  // ── Neighbor highlight — O(k) delta updates via CSS class + data-hl attr ───
  useLayoutEffect(() => {
    const nodeMap = nodeEls.current
    const labelMap = labelEls.current
    const linkMap = linkEls.current
    const graphGroup = graphGroupRef.current

    if (!hoveredNodeId) {
      // O(1): remove faded class → CSS restores all opacities
      graphGroup?.classList.remove('graph-faded')
      // O(k): restore only previously highlighted elements
      prevHighlightedNodeIds.current.forEach(nodeId => {
        const el = nodeMap.get(nodeId)
        if (el) { el.removeAttribute('data-hl'); el.style.filter = '' }
        const lEl = labelMap.get(nodeId)
        if (lEl) { lEl.removeAttribute('data-hl'); lEl.removeAttribute('opacity') }
      })
      prevHighlightedLinkIdxs.current.forEach(i => {
        const el = linkMap.get(i)
        if (el) { el.removeAttribute('data-hl'); el.style.stroke = ''; el.style.strokeWidth = '' }
      })
      prevHighlightedNodeIds.current = new Set()
      prevHighlightedLinkIdxs.current = new Set()
      return
    }

    // Resolve neighbor link indices and node IDs — O(k_links) only
    const neighborLinkIdxs = adjacencyRef.current.get(hoveredNodeId) ?? new Set<number>()
    const neighborIds = new Set<string>([hoveredNodeId])
    neighborLinkIdxs.forEach(i => {
      const link = links[i] as GraphLink | undefined
      if (!link) return
      neighborIds.add(typeof link.source === 'string' ? link.source : (link.source as GraphNode).id)
      neighborIds.add(typeof link.target === 'string' ? link.target : (link.target as GraphNode).id)
    })

    const hovNode = nodeDataMapRef.current.get(hoveredNodeId)
    const accentColor = hovNode ? SPEAKER_CONFIG[hovNode.speaker].color : '#ffffff'

    // O(1): fade everything via CSS class (no per-node loop needed)
    graphGroup?.classList.add('graph-faded')

    // O(prevK): clear data-hl from nodes/links no longer highlighted
    prevHighlightedNodeIds.current.forEach(nodeId => {
      if (!neighborIds.has(nodeId)) {
        const el = nodeMap.get(nodeId)
        if (el) { el.removeAttribute('data-hl'); el.style.filter = '' }
        const lEl = labelMap.get(nodeId)
        if (lEl) { lEl.removeAttribute('data-hl'); lEl.removeAttribute('opacity') }
      }
    })
    prevHighlightedLinkIdxs.current.forEach(i => {
      if (!neighborLinkIdxs.has(i)) {
        const el = linkMap.get(i)
        if (el) { el.removeAttribute('data-hl'); el.style.stroke = ''; el.style.strokeWidth = '' }
      }
    })

    // O(k): set data-hl + glow on highlighted nodes
    neighborIds.forEach(nodeId => {
      const el = nodeMap.get(nodeId)
      if (!el) return
      el.setAttribute('data-hl', '1')
      const nd = nodeDataMapRef.current.get(nodeId)
      el.style.filter = nodeId === hoveredNodeId
        ? `drop-shadow(0 0 10px ${accentColor}) drop-shadow(0 0 4px ${accentColor})`
        : nd ? `drop-shadow(0 0 5px ${SPEAKER_CONFIG[nd.speaker].color}99)` : ''
      // Only reveal the label for the directly hovered node, not its neighbors
      const lEl = labelMap.get(nodeId)
      if (lEl) {
        lEl.setAttribute('data-hl', '1')
        if (nodeId === hoveredNodeId) lEl.setAttribute('opacity', '1')
      }
    })
    // O(k): set data-hl + accent on highlighted links
    neighborLinkIdxs.forEach(i => {
      const el = linkMap.get(i)
      if (el) { el.setAttribute('data-hl', '1'); el.style.stroke = accentColor; el.style.strokeWidth = '2' }
    })

    prevHighlightedNodeIds.current = neighborIds
    prevHighlightedLinkIdxs.current = neighborLinkIdxs
  }, [hoveredNodeId, links])

  return (
    <div style={{ position: 'relative', width, height }} data-testid="graph-2d">
      <svg
        ref={svgRef}
        width={width}
        height={height}
        style={{ display: 'block', cursor: 'grab', overflow: 'visible' }}
        onMouseDown={handleSVGMouseDown}
        onMouseMove={handleSVGMouseMove}
        onMouseUp={handleSVGMouseUp}
        onMouseLeave={handleSVGMouseUp}
        onClick={() => setTooltip(null)}
      >
        {/* Single transform group — pan/zoom applied here, sim tick updates positions inside */}
        <g ref={graphGroupRef}>
          {/* Links */}
          <g data-testid="graph-links">
            {links.map((link: GraphLink, i: number) => {
              const src = typeof link.source === 'string' ? link.source : (link.source as GraphNode).id
              const tgt = typeof link.target === 'string' ? link.target : (link.target as GraphNode).id
              return (
                <line
                  key={`${src}-${tgt}-${i}`}
                  ref={el => { if (el) linkEls.current.set(i, el) }}
                  x1={width / 2} y1={height / 2}
                  x2={width / 2} y2={height / 2}
                  stroke="var(--color-border)"
                  strokeWidth={1}
                  strokeOpacity={physics.linkOpacity}
                  vectorEffect="non-scaling-stroke"
                />
              )
            })}
          </g>

          {/* Selection ring */}
          {selectedNodeId && (() => {
            const node = nodes.find(n => n.id === selectedNodeId)
            if (!node) return null
            const color = SPEAKER_CONFIG[node.speaker].color
            return (
              <circle
                ref={el => { selRingEl.current = el }}
                cx={width / 2} cy={height / 2}
                r={15}
                fill="none"
                stroke={color}
                strokeWidth={1.5}
                strokeDasharray="4 3"
                opacity={0.8}
                data-testid="selection-ring"
              />
            )
          })()}

          {/* Nodes */}
          <g data-testid="graph-nodes">
            {nodes.map(node => {
              const baseColor = getNodeColor(node, nodeColorMode, nodeColorMap)
              const isSelected = selectedNodeId === node.id

              // Degree-based size + brightness (Obsidian style)
              const deg = degreeMap.get(node.id) ?? 0
              const sf = degreeScaleFactor(deg, maxDegree)
              const nr = physics.nodeRadius * degreeSize(sf)
              const lightFactor = isSelected ? 0 : (1 - sf) * DEGREE_LIGHT_MAX
              const color = lightFactor > 0.01 ? lightenColor(baseColor, lightFactor) : baseColor

              const sharedProps = {
                fill: color,
                fillOpacity: isSelected ? 1 : 0.9,
                style: {
                  cursor: 'grab',
                  filter: isSelected ? `drop-shadow(0 0 6px ${baseColor})` : undefined,
                  transition: isFast ? undefined : 'r 0.15s, fill-opacity 0.15s',
                } as CSSProperties,
                onClick: (e: React.MouseEvent) => handleNodeClick(node.id, e),
                onDoubleClick: () => handleNodeDoubleClick(node.id, node.docId),
                onMouseDown: (e: React.MouseEvent) => handleNodeMouseDown(node.id, e),
                onMouseEnter: () => handleMouseEnter(node.id),
                onMouseLeave: handleMouseLeave,
                'data-node-id': node.id,
              }
              if (node.isImage) {
                // Image node: diamond shape — rect rotated 45 degrees
                const s = isSelected ? nr + 1.5 : Math.max(nr - 1, 2)
                return (
                  <rect
                    key={node.id}
                    ref={el => { if (el) nodeEls.current.set(node.id, el) }}
                    x={width / 2 - s} y={height / 2 - s}
                    width={s * 2} height={s * 2}
                    transform={`rotate(45, ${width / 2}, ${height / 2})`}
                    {...sharedProps}
                  />
                )
              }
              return (
                <circle
                  key={node.id}
                  ref={el => { if (el) nodeEls.current.set(node.id, el) }}
                  cx={width / 2} cy={height / 2}
                  r={isSelected ? nr + 3 : nr}
                  {...sharedProps}
                />
              )
            })}
          </g>

          {/* Labels group — hidden when overlay panel active; positions always live-updated by tick */}
          <g ref={labelGroupRef} data-testid="graph-labels">
            {nodes.map(node => (
              <text
                key={`label-${node.id}`}
                ref={el => { if (el) labelEls.current.set(node.id, el) }}
                x={width / 2}
                y={height / 2 + LABEL_Y_OFFSET}
                textAnchor="middle"
                fontSize={9}
                fontWeight="normal"
                fill="var(--color-text-secondary)"
                stroke="var(--color-bg-primary)"
                strokeWidth={3}
                strokeLinejoin="round"
                paintOrder="stroke"
                opacity={showNodeLabels ? 0.95 : 0}
                pointerEvents="none"
                style={{ userSelect: 'none' }}
                data-testid={`node-label-${node.id}`}
              >
                {node.label.length > 16 ? node.label.slice(0, 15) + '…' : node.label}
              </text>
            ))}
          </g>
        </g>
      </svg>

      {tooltip && <NodeTooltip nodeId={tooltip.nodeId} x={tooltip.x} y={tooltip.y} />}
    </div>
  )
}
