/**
 * GraphMinimap — compact 2D overview of the graph.
 * Reads live simulation positions (simPositions) from graphStore.
 * Click a dot to focus that node.
 */
import { useRef, useEffect, useCallback } from 'react'
import { useGraphStore } from '@/stores/graphStore'
import { buildNodeColorMap } from '@/lib/nodeColors'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import type { NodeColorMode } from '@/types'

const W = 160
const H = 110
const PADDING = 12
const DOT_R = 2.5
const DOT_R_SEL = 4.5

type SimPos = Record<string, { x: number; y: number }>

/** Compute canvas-space projection from sim-space positions. Returns null if empty. */
function computeMinimapTransform(simPositions: SimPos): {
  toCanvasX: (x: number) => number
  toCanvasY: (y: number) => number
} | null {
  const keys = Object.keys(simPositions)
  if (keys.length === 0) return null

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const id of keys) {
    const p = simPositions[id]
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  const rangeX = maxX - minX || 1
  const rangeY = maxY - minY || 1
  const drawW = W - PADDING * 2
  const drawH = H - PADDING * 2
  return {
    toCanvasX: (x: number) => PADDING + ((x - minX) / rangeX) * drawW,
    toCanvasY: (y: number) => PADDING + ((y - minY) / rangeY) * drawH,
  }
}

export default function GraphMinimap() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const nodes          = useGraphStore(s => s.nodes)
  const simPositions   = useGraphStore(s => s.simPositions)
  const selectedNodeId = useGraphStore(s => s.selectedNodeId)
  const setSelectedNode = useGraphStore(s => s.setSelectedNode)
  const setFocusNode    = useGraphStore(s => s.setFocusNode)
  const nodeColorMode   = useUIStore(s => s.nodeColorMode) as NodeColorMode
  const tagColors       = useSettingsStore(s => s.tagColors)
  const folderColors    = useSettingsStore(s => s.folderColors)

  const colorMap = buildNodeColorMap(nodes, nodeColorMode, tagColors, folderColors)

  // Draw whenever positions or selection changes
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const transform = computeMinimapTransform(simPositions)
    if (!transform) return
    const { toCanvasX, toCanvasY } = transform

    ctx.clearRect(0, 0, W, H)

    // Draw nodes
    for (const node of nodes) {
      const p = simPositions[node.id]
      if (!p) continue
      const cx = toCanvasX(p.x)
      const cy = toCanvasY(p.y)
      const isSelected = node.id === selectedNodeId
      const r = isSelected ? DOT_R_SEL : DOT_R
      const color = colorMap.get(node.id) ?? '#64748b'

      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.fillStyle = isSelected ? '#fff' : color
      ctx.globalAlpha = isSelected ? 1 : 0.75
      ctx.fill()

      if (isSelected) {
        ctx.beginPath()
        ctx.arc(cx, cy, r + 2, 0, Math.PI * 2)
        ctx.strokeStyle = color
        ctx.lineWidth = 1.5
        ctx.globalAlpha = 0.8
        ctx.stroke()
      }
    }
    ctx.globalAlpha = 1
  }, [simPositions, selectedNodeId, nodes, colorMap])

  // Click to select + focus node
  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mx = (e.clientX - rect.left) * (W / rect.width)
    const my = (e.clientY - rect.top) * (H / rect.height)

    const transform = computeMinimapTransform(simPositions)
    if (!transform) return
    const { toCanvasX, toCanvasY } = transform

    let closest: string | null = null
    let closestDist = 12
    for (const node of nodes) {
      const p = simPositions[node.id]
      if (!p) continue
      const dx = mx - toCanvasX(p.x)
      const dy = my - toCanvasY(p.y)
      const d = Math.sqrt(dx * dx + dy * dy)
      if (d < closestDist) { closestDist = d; closest = node.id }
    }
    if (closest) {
      setSelectedNode(closest)
      setFocusNode(closest)
    }
  }, [simPositions, nodes, setSelectedNode, setFocusNode])

  if (Object.keys(simPositions).length === 0) return null

  return (
    <div style={{
      position: 'absolute',
      bottom: 52,
      left: 12,
      zIndex: 5,
      pointerEvents: 'auto',
      borderRadius: 8,
      overflow: 'hidden',
      border: '1px solid rgba(255,255,255,0.1)',
      background: 'rgba(10,15,30,0.7)',
      backdropFilter: 'blur(4px)',
      boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
    }}>
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        onClick={handleClick}
        style={{ display: 'block', cursor: 'crosshair', width: W, height: H }}
        title="Minimap — click to focus node"
      />
    </div>
  )
}
