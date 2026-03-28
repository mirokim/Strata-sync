import { useRef, useEffect, useCallback, useMemo, useState } from 'react'
import { useGraphStore } from '@/stores/graphStore'
import { useUIStore } from '@/stores/uiStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useGraphSimulation, type SimNode, type SimLink } from '@/hooks/useGraphSimulation'
import { buildNodeColorMap, getNodeColor, lightenColor, degreeScaleFactor, degreeSize, DEGREE_LIGHT_MAX } from '@/lib/nodeColors'
import { LABEL_MIN_GAP, GRAPH_VIEW_PADDING } from '@/lib/constants'
import type { GraphNode } from '@/types'
import NodeTooltip from './NodeTooltip'

interface Props {
  width: number
  height: number
}

function getCSSVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

/**
 * Canvas-based 2D graph renderer for fast mode.
 * Single DOM element regardless of node count — no per-node React reconciliation.
 * Renders once after simulation completes; redraws only on view/selection changes.
 */
export default function Graph2DCanvas({ width, height }: Props) {
  const { nodes, links, selectedNodeId, focusNodeId, setFocusNode, physics, setSelectedNode, setGraphLayoutReady, degreeMap, maxDegree } = useGraphStore()
  const { nodeColorMode, setSelectedDoc, openInEditor } = useUIStore()
  const showNodeLabels = useSettingsStore(s => s.showNodeLabels)
  const tagColors = useSettingsStore(s => s.tagColors)
  const folderColors = useSettingsStore(s => s.folderColors)

  const nodeColorMap = useMemo(
    () => buildNodeColorMap(nodes, nodeColorMode, tagColors, folderColors),
    [nodes, nodeColorMode, tagColors, folderColors]
  )

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewRef = useRef({ x: 0, y: 0, scale: 1 })
  const cachedSimNodesRef = useRef<SimNode[]>([])
  const cachedSimLinksRef = useRef<SimLink[]>([])
  const isPanningRef = useRef(false)
  const panStartRef = useRef({ mx: 0, my: 0, tx: 0, ty: 0 })
  const [tooltip, setTooltip] = useState<{ nodeId: string; x: number; y: number } | null>(null)

  // Stable refs for reactive values (keeps drawCanvas stable across re-renders)
  const selectedNodeIdRef = useRef(selectedNodeId)
  selectedNodeIdRef.current = selectedNodeId
  const showNodeLabelsRef = useRef(showNodeLabels)
  showNodeLabelsRef.current = showNodeLabels
  const nodeColorModeRef = useRef(nodeColorMode)
  nodeColorModeRef.current = nodeColorMode
  const nodeColorMapRef = useRef(nodeColorMap)
  nodeColorMapRef.current = nodeColorMap
  const physicsRef = useRef(physics)
  physicsRef.current = physics

  // O(1) node lookup — rebuilt when nodes change
  const nodeMapRef = useRef<Map<string, GraphNode>>(new Map())
  useEffect(() => {
    nodeMapRef.current = new Map(nodes.map(n => [n.id, n]))
  }, [nodes])

  // Degree map — sourced from graphStore (computed atomically in setLinks)
  const degreeMapRef = useRef(degreeMap)
  degreeMapRef.current = degreeMap
  const maxDegreeRef = useRef(maxDegree)
  maxDegreeRef.current = maxDegree

  // ── Draw everything to canvas ───────────────────────────────────────────────
  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const simNodes = cachedSimNodesRef.current
    const simLinks = cachedSimLinksRef.current
    if (simNodes.length === 0) return

    const { x: tx, y: ty, scale } = viewRef.current
    const nodeMap = nodeMapRef.current
    const selId = selectedNodeIdRef.current
    const colorMode = nodeColorModeRef.current
    const colorMap = nodeColorMapRef.current

    ctx.clearRect(0, 0, width, height)
    ctx.save()
    ctx.translate(tx, ty)
    ctx.scale(scale, scale)

    // ── Links (batched by strength bucket: weak / medium / strong) ──────────
    const linkBase = physicsRef.current.linkOpacity
    const edgeColor = getCSSVar('--color-border', '#333')
    const BUCKETS = [
      { maxStrength: 0.35, lineWidth: 0.6 / scale, alpha: linkBase * 0.55 },
      { maxStrength: 0.7,  lineWidth: 1.0 / scale, alpha: linkBase * 0.85 },
      { maxStrength: 1.01, lineWidth: 1.8 / scale, alpha: linkBase * 1.0  },
    ]
    for (const bucket of BUCKETS) {
      ctx.strokeStyle = edgeColor
      ctx.lineWidth = bucket.lineWidth
      ctx.globalAlpha = Math.min(1, bucket.alpha)
      ctx.beginPath()
      for (const link of simLinks) {
        const s = (link.strength ?? 0.5)
        if (bucket === BUCKETS[0] && s >= 0.35) continue
        if (bucket === BUCKETS[1] && (s < 0.35 || s >= 0.7)) continue
        if (bucket === BUCKETS[2] && s < 0.7) continue
        const src = link.source as SimNode
        const tgt = link.target as SimNode
        if (src?.x == null || tgt?.x == null) continue
        ctx.moveTo(src.x, src.y)
        ctx.lineTo(tgt.x, tgt.y)
      }
      ctx.stroke()
    }

    // ── Nodes ───────────────────────────────────────────────────────────────
    const degreeMap = degreeMapRef.current
    const maxDeg = maxDegreeRef.current
    for (const simNode of simNodes) {
      const nodeData = nodeMap.get(simNode.id)
      if (!nodeData) continue
      const color = getNodeColor(nodeData, colorMode, colorMap)
      const isSelected = simNode.id === selId

      // Obsidian-style: radius scales with sqrt(degree+1)
      const deg = degreeMap.get(simNode.id) ?? 0
      const baseNr = physicsRef.current.nodeRadius
      const sf = degreeScaleFactor(deg, maxDeg)
      const nr = baseNr * degreeSize(sf)
      const lightFactor = isSelected ? 0 : (1 - sf) * DEGREE_LIGHT_MAX
      ctx.globalAlpha = isSelected ? 1 : 0.9
      ctx.fillStyle = lightFactor > 0.01 ? lightenColor(color, lightFactor) : color

      if (nodeData.isImage) {
        // 이미지 노드: 다이아몬드(마름모) 형태
        const r = isSelected ? nr + 2 : Math.max(nr - 1, 2)
        ctx.save()
        ctx.translate(simNode.x, simNode.y)
        ctx.rotate(Math.PI / 4)
        ctx.beginPath()
        ctx.rect(-r / 1.41, -r / 1.41, r * 1.41, r * 1.41)
        ctx.fill()
        ctx.restore()
      } else {
        ctx.beginPath()
        ctx.arc(simNode.x, simNode.y, isSelected ? nr + 3 : nr, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    // ── Selection ring (on top of nodes) ────────────────────────────────────
    if (selId) {
      const selNode = simNodes.find(n => n.id === selId)
      if (selNode) {
        const nodeData = nodeMap.get(selId)
        const color = nodeData ? getNodeColor(nodeData, colorMode, colorMap) : '#60a5fa'
        ctx.globalAlpha = 0.8
        ctx.strokeStyle = color
        ctx.lineWidth = 1.5 / scale
        ctx.setLineDash([4 / scale, 3 / scale])
        ctx.beginPath()
        const selDeg = degreeMapRef.current.get(selId) ?? 0
        const selSf = degreeScaleFactor(selDeg, maxDegreeRef.current)
        const selNr = physicsRef.current.nodeRadius * degreeSize(selSf)
        ctx.arc(selNode.x, selNode.y, (selNr + 8) / scale, 0, Math.PI * 2)
        ctx.stroke()
        ctx.setLineDash([])
      }
    }

    // ── Labels ──────────────────────────────────────────────────────────────
    if (showNodeLabelsRef.current) {
      const textColor = getCSSVar('--color-text-secondary', '#888')
      ctx.fillStyle = textColor
      ctx.textAlign = 'center'
      // Font size in graph-space so screen size stays ~9px regardless of zoom
      ctx.font = `${9 / scale}px ui-monospace, monospace`

      // Density-aware culling: minimum screen-space gap between label centers
      // At low zoom, only draw labels for selected node + high-degree hubs
      const MIN_SCREEN_GAP = LABEL_MIN_GAP  // px between label positions on screen
      const drawnScreenPos: Array<{ sx: number; sy: number }> = []
      const maxDeg = maxDegreeRef.current

      // Sort: selected node first, then by degree descending (hubs get priority)
      const sorted = [...simNodes].sort((a, b) => {
        if (a.id === selId) return -1
        if (b.id === selId) return 1
        return (degreeMapRef.current.get(b.id) ?? 0) - (degreeMapRef.current.get(a.id) ?? 0)
      })

      for (const simNode of sorted) {
        const nodeData = nodeMap.get(simNode.id)
        if (!nodeData) continue

        const deg = degreeMapRef.current.get(simNode.id) ?? 0
        const isSelected = simNode.id === selId

        // At low zoom (< 0.4), only show selected + top-tier hubs (top 15% degree)
        if (!isSelected && scale < 0.4 && deg < maxDeg * 0.15) continue

        // Screen-space position
        const sx = simNode.x * scale + tx
        const sy = simNode.y * scale + ty

        // Skip if too close to an already-drawn label (overlap prevention)
        const tooClose = !isSelected && drawnScreenPos.some(
          p => Math.abs(p.sx - sx) < MIN_SCREEN_GAP && Math.abs(p.sy - sy) < MIN_SCREEN_GAP
        )
        if (tooClose) continue

        drawnScreenPos.push({ sx, sy })
        const label = nodeData.label.length > 16 ? nodeData.label.slice(0, 15) + '…' : nodeData.label
        ctx.globalAlpha = isSelected ? 0.95 : 0.7
        ctx.fillText(label, simNode.x, simNode.y + 16 / scale)
      }
    }

    ctx.restore()
  }, [width, height])

  // ── Fit bounding box into viewport ──────────────────────────────────────────
  const fitView = useCallback((simNodes: SimNode[]) => {
    if (simNodes.length === 0) return
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const n of simNodes) {
      if (n.x < minX) minX = n.x; if (n.x > maxX) maxX = n.x
      if (n.y < minY) minY = n.y; if (n.y > maxY) maxY = n.y
    }
    const graphW = Math.max(maxX - minX, 100)
    const graphH = Math.max(maxY - minY, 100)
    const padding = GRAPH_VIEW_PADDING
    const scale = Math.min((width - padding * 2) / graphW, (height - padding * 2) / graphH, 2)
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    viewRef.current = { x: width / 2 - cx * scale, y: height / 2 - cy * scale, scale }
  }, [width, height])

  // ── Simulation ──────────────────────────────────────────────────────────────
  const handleTick = useCallback((sn: SimNode[], sl: SimLink[]) => {
    cachedSimNodesRef.current = sn
    cachedSimLinksRef.current = sl
  }, [])

  const handleComplete = useCallback((simNodes: SimNode[]) => {
    fitView(simNodes)
    drawCanvas()
    setGraphLayoutReady(true)
  }, [fitView, drawCanvas, setGraphLayoutReady])

  useGraphSimulation({ width, height, onTick: handleTick, onComplete: handleComplete })

  // ── Redraw when selection or color settings change ───────────────────────────
  useEffect(() => {
    if (cachedSimNodesRef.current.length > 0) drawCanvas()
    // drawCanvas is stable (only changes with width/height), listed deps are the triggers
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeId, showNodeLabels, nodeColorMode, nodeColorMap, physics.nodeRadius, links])

  // ── Focus node: pan + zoom to the target node ───────────────────────────────
  useEffect(() => {
    if (!focusNodeId) return
    const target = cachedSimNodesRef.current.find(n => n.id === focusNodeId)
    if (!target || target.x == null || target.y == null) return
    const targetScale = Math.min(Math.max(viewRef.current.scale, 1.5), 3)
    viewRef.current = {
      x: width / 2 - target.x * targetScale,
      y: height / 2 - target.y * targetScale,
      scale: targetScale,
    }
    drawCanvas()
    setFocusNode(null)  // 소비 후 리셋
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNodeId])

  // ── Wheel zoom ───────────────────────────────────────────────────────────────
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault()
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const view = viewRef.current
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
    drawCanvas()
  }, [drawCanvas])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.addEventListener('wheel', handleWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  // ── Hit test: find node at screen coords ────────────────────────────────────
  const hitTest = useCallback((clientX: number, clientY: number): SimNode | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const { x, y, scale } = viewRef.current
    const gx = (clientX - rect.left - x) / scale
    const gy = (clientY - rect.top - y) / scale
    const hitRadius = 12 / scale  // 12 screen-px in graph space
    let closest: SimNode | null = null
    let closestDist = hitRadius
    for (const node of cachedSimNodesRef.current) {
      const d = Math.sqrt((node.x - gx) ** 2 + (node.y - gy) ** 2)
      if (d < closestDist) { closestDist = d; closest = node }
    }
    return closest
  }, [])

  // ── Mouse / pan interactions ─────────────────────────────────────────────────
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    isPanningRef.current = true
    panStartRef.current = { mx: e.clientX, my: e.clientY, tx: viewRef.current.x, ty: viewRef.current.y }
  }, [])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isPanningRef.current) return
    const dx = e.clientX - panStartRef.current.mx
    const dy = e.clientY - panStartRef.current.my
    viewRef.current = { ...viewRef.current, x: panStartRef.current.tx + dx, y: panStartRef.current.ty + dy }
    drawCanvas()
  }, [drawCanvas])

  const handleMouseUp = useCallback(() => { isPanningRef.current = false }, [])

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    // Ignore if this was a drag (not a true click)
    if (Math.abs(e.clientX - panStartRef.current.mx) > 3 ||
        Math.abs(e.clientY - panStartRef.current.my) > 3) return
    const node = hitTest(e.clientX, e.clientY)
    if (node) {
      setSelectedNode(node.id)
      // 노드의 시뮬레이션 좌표 → 화면 좌표로 변환 (pan/zoom 적용)
      const canvas = canvasRef.current
      const rect = canvas?.getBoundingClientRect()
      const { x: tx, y: ty, scale } = viewRef.current
      const screenX = rect ? rect.left + node.x * scale + tx : e.clientX
      const screenY = rect ? rect.top  + node.y * scale + ty : e.clientY
      setTooltip({ nodeId: node.id, x: screenX, y: screenY })
    } else {
      setTooltip(null)
    }
  }, [hitTest, setSelectedNode])

  const handleDoubleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const node = hitTest(e.clientX, e.clientY)
    if (!node) return
    const nodeData = nodeMapRef.current.get(node.id)
    if (!nodeData) return
    setSelectedNode(node.id)
    setSelectedDoc(nodeData.docId)
    if (!nodeData.docId.startsWith('_phantom_')) openInEditor(nodeData.docId)
  }, [hitTest, setSelectedNode, setSelectedDoc, openInEditor])

  return (
    <div style={{ position: 'relative', width, height }} data-testid="graph-2d">
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{ display: 'block', cursor: 'grab' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      />
      {tooltip && <NodeTooltip nodeId={tooltip.nodeId} x={tooltip.x} y={tooltip.y} />}
    </div>
  )
}
