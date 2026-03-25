/**
 * CompareGraphCanvas — lightweight canvas graph for comparison view.
 *
 * Receives nodes/links via props and runs its own d3 simulation.
 * Read-only view with no interaction (no focus/selection).
 */
import { useEffect, useRef, useCallback } from 'react'
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
} from 'd3-force'
import type { GraphNode, GraphLink } from '@/types'

interface SimNode extends GraphNode {
  x: number; y: number; vx: number; vy: number
}
interface SimLink { source: SimNode | string; target: SimNode | string }

interface Props {
  nodes: GraphNode[]
  links: GraphLink[]
  label: string
  width: number
  height: number
}

function getCSSVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

export default function CompareGraphCanvas({ nodes, links, label, width, height }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const simNodesRef = useRef<SimNode[]>([])
  const simLinksRef = useRef<SimLink[]>([])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || width === 0 || height === 0) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, width, height)

    const bgColor = getCSSVar('--color-bg-primary', '#0f0f0f')
    ctx.fillStyle = bgColor
    ctx.fillRect(0, 0, width, height)

    const edgeColor = getCSSVar('--color-accent', '#60a5fa')
    const nodeColor = getCSSVar('--color-accent', '#60a5fa')
    const textColor = getCSSVar('--color-text-muted', '#888')

    // Draw edges
    ctx.strokeStyle = edgeColor + '40'
    ctx.lineWidth = 0.8
    for (const link of simLinksRef.current) {
      const s = link.source as SimNode
      const t = link.target as SimNode
      if (s.x == null || t.x == null) continue
      ctx.beginPath()
      ctx.moveTo(s.x, s.y)
      ctx.lineTo(t.x, t.y)
      ctx.stroke()
    }

    // Draw nodes
    for (const node of simNodesRef.current) {
      if (node.x == null) continue
      ctx.beginPath()
      ctx.arc(node.x, node.y, 3.5, 0, Math.PI * 2)
      ctx.fillStyle = nodeColor + 'cc'
      ctx.fill()
    }

    // Label
    ctx.fillStyle = textColor
    ctx.font = '11px sans-serif'
    ctx.fillText(label, 8, height - 8)
  }, [width, height, label])

  useEffect(() => {
    if (width === 0 || height === 0) return

    simNodesRef.current = nodes.map(n => ({
      ...n,
      x: width / 2 + (Math.random() - 0.5) * 200,
      y: height / 2 + (Math.random() - 0.5) * 200,
      vx: 0, vy: 0,
    }))
    simLinksRef.current = links.map(l => ({ ...l })) as SimLink[]

    const sim = forceSimulation<SimNode>(simNodesRef.current)
      .force('link', forceLink<SimNode, SimLink>(simLinksRef.current).id(d => d.id).strength(0.7).distance(50))
      .force('charge', forceManyBody<SimNode>().strength(-60))
      .force('center', forceCenter<SimNode>(width / 2, height / 2))

    sim.stop()
    // Run 200 ticks then draw
    const tid = setTimeout(() => {
      sim.tick(200)
      draw()
    }, 50)

    return () => {
      clearTimeout(tid)
      sim.stop()
    }
  }, [nodes, links, width, height, draw])

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ display: 'block', width: '100%', height: '100%' }}
    />
  )
}
