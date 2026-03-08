import { useEffect, useRef } from 'react'
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  type Simulation,
} from 'd3-force'
import type { GraphNode, GraphLink } from '@/types'
import { useGraphStore } from '@/stores/graphStore'
import { useSettingsStore } from '@/stores/settingsStore'

export interface SimNode extends GraphNode {
  x: number
  y: number
  vx: number
  vy: number
}

export interface SimLink {
  source: SimNode | string
  target: SimNode | string
  strength?: number
}

interface Options {
  width: number
  height: number
  onTick: (simNodes: SimNode[], simLinks: SimLink[]) => void
  /** Called once when the initial layout settles (fast: after tick(300); normal: when alpha < 0.3) */
  onComplete?: (simNodes: SimNode[]) => void
}

/**
 * Shared 2D force simulation hook.
 * Reads nodes/links from graphStore so vault data is reflected automatically.
 * Reinitializes whenever the node/link dataset changes (vault load or clear).
 * Reheats separately when physics params change.
 */
export function useGraphSimulation({ width, height, onTick, onComplete }: Options) {
  const { nodes, links, physics } = useGraphStore()
  const isFast = useSettingsStore(s => s.paragraphRenderQuality === 'fast')
  const isFastRef = useRef(isFast)
  isFastRef.current = isFast

  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null)
  const simNodesRef = useRef<SimNode[]>([])
  const simLinksRef = useRef<SimLink[]>([])
  const onTickRef = useRef(onTick)
  onTickRef.current = onTick
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete
  // Skip reheat on initial mount — init effect handles first-run tick scheduling
  const reheatMountedRef = useRef(false)

  // Initialize (or reinitialize) simulation when nodes/links dataset changes
  useEffect(() => {
    simNodesRef.current = nodes.map(n => ({
      ...n,
      x: width / 2 + (Math.random() - 0.5) * 200,
      y: height / 2 + (Math.random() - 0.5) * 200,
      vx: 0,
      vy: 0,
    }))
    simLinksRef.current = links.map(l => ({ ...l })) as SimLink[]

    const sim = forceSimulation<SimNode>(simNodesRef.current)
      .force(
        'link',
        forceLink<SimNode, SimLink>(simLinksRef.current)
          .id(d => d.id)
          .strength(physics.linkStrength)
          .distance(physics.linkDistance)
      )
      .force('charge', forceManyBody<SimNode>().strength(physics.charge))
      .force('center', forceCenter<SimNode>(width / 2, height / 2).strength(physics.centerForce))

    if (isFastRef.current) {
      // Fast mode: stop D3's auto-timer, then run 150 ticks synchronously after React
      // has had one frame to render the initial SVG elements (so positions are applied).
      sim.stop()
      const tid = setTimeout(() => {
        sim.tick(150)
        onTickRef.current(simNodesRef.current, simLinksRef.current)
        onCompleteRef.current?.(simNodesRef.current)
      }, 50)
      simRef.current = sim
      return () => { clearTimeout(tid); simRef.current = null }
    }

    // Normal mode: animated RAF loop; call onComplete once when alpha drops below 0.3
    let completedCallback = false
    sim.on('tick', () => {
      onTickRef.current(simNodesRef.current, simLinksRef.current)
      if (!completedCallback && sim.alpha() < 0.3) {
        completedCallback = true
        onCompleteRef.current?.(simNodesRef.current)
      }
    })

    simRef.current = sim
    return () => {
      sim.stop()
      simRef.current = null
    }
    // physics is intentionally excluded: reheating is handled in the effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, nodes, links])

  // Reheat when physics params or quality mode change
  // Skip initial mount: init effect already schedules ticks; reheat must not prematurely stop the sim
  useEffect(() => {
    if (!reheatMountedRef.current) { reheatMountedRef.current = true; return }
    const sim = simRef.current
    if (!sim) return
    ;(sim.force('link') as ReturnType<typeof forceLink<SimNode, SimLink>> | null)
      ?.strength(physics.linkStrength)
      .distance(physics.linkDistance)
    ;(sim.force('charge') as ReturnType<typeof forceManyBody<SimNode>> | null)
      ?.strength(physics.charge)
    ;(sim.force('center') as ReturnType<typeof forceCenter<SimNode>> | null)
      ?.strength(physics.centerForce)
    if (isFast) {
      sim.stop()
    } else {
      // Re-attach tick handler in case it was missing (e.g. switched from fast mode)
      sim.on('tick', () => onTickRef.current(simNodesRef.current, simLinksRef.current))
      sim.alpha(0.3).restart()
    }
  }, [physics, isFast])

  return { simRef, simNodesRef, simLinksRef }
}
