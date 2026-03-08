import { useEffect, useRef } from 'react'
import { useGraphStore } from '@/stores/graphStore'
import { useSettingsStore } from '@/stores/settingsStore'
import type { GraphNode } from '@/types'

export interface SimNode3D extends GraphNode {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
}

export interface SimLink3D {
  source: SimNode3D | string
  target: SimNode3D | string
  strength?: number
}

interface Options {
  onTick: (nodes: SimNode3D[], links: SimLink3D[]) => void
}

/**
 * 3D force simulation hook using d3-force-3d.
 * Reads nodes/links from graphStore so vault data is reflected automatically.
 * Reinitializes whenever the node/link dataset changes (vault load or clear).
 *
 * NOTE: Uses a custom per-node gravity force instead of forceCenter.
 * forceCenter only translates the mean position of the entire graph — it
 * does NOT pull disconnected clusters toward each other.
 * The gravity force applies an individual spring-to-origin for every node,
 * so unconnected components all converge near (0,0,0).
 */
export function useGraphSimulation3D({ onTick }: Options) {
  const { nodes, links, physics } = useGraphStore()
  const isFast = useSettingsStore(s => s.paragraphRenderQuality === 'fast')
  const isFastRef = useRef(isFast)
  isFastRef.current = isFast

  const simRef = useRef<unknown>(null)
  const simNodesRef = useRef<SimNode3D[]>([])
  const simLinksRef = useRef<SimLink3D[]>([])
  const onTickRef = useRef(onTick)
  onTickRef.current = onTick

  // Shared mutable ref so the reheat effect can update gravity strength
  // without reinitialising the whole simulation.
  const gravityStrengthRef = useRef(physics.centerForce * 0.1)

  // Initialize (or reinitialize) simulation when nodes/links dataset changes
  useEffect(() => {
    let cancelled = false

    const spread = 80
    simNodesRef.current = nodes.map(n => ({
      ...n,
      x: (Math.random() - 0.5) * spread,
      y: (Math.random() - 0.5) * spread,
      z: (Math.random() - 0.5) * spread,
      vx: 0, vy: 0, vz: 0,
    }))
    simLinksRef.current = links.map(l => ({ ...l })) as SimLink3D[]

    // Capture stable reference for this simulation run
    const sNodes = simNodesRef.current

    // Dynamically import d3-force-3d so Vitest can easily mock it
    import('d3-force-3d').then(({
      forceSimulation,
      forceLink,
      forceManyBody,
    }) => {
      if (cancelled) return

      const sim = (forceSimulation as (nodes: SimNode3D[]) => any)(sNodes)
        .numDimensions(3)
        .force(
          'link',
          (forceLink as (links: SimLink3D[]) => any)(simLinksRef.current)
            .id((d: SimNode3D) => d.id)
            .strength(physics.linkStrength)
            .distance(physics.linkDistance),
        )
        .force('charge', (forceManyBody as () => any)().strength(physics.charge))
        // Per-node gravity: each node is pulled toward origin individually.
        // This brings disconnected clusters together, unlike forceCenter which
        // only translates the mean of the entire graph.
        .force('center', (alpha: number) => {
          const g = gravityStrengthRef.current
          for (const n of sNodes) {
            n.vx -= n.x * g * alpha
            n.vy -= n.y * g * alpha
            n.vz -= n.z * g * alpha
          }
        })

      // Fast mode: stop after fewer ticks (runs via RAF, not sync — avoids main-thread block
      // and ensures scene meshes are built before the first onTick fires)
      const MAX_TICKS_FAST = 80
      let ticksDone = 0
      sim.on('tick', () => {
        onTickRef.current(simNodesRef.current, simLinksRef.current)
        if (isFastRef.current && ++ticksDone >= MAX_TICKS_FAST) sim.stop()
      })

      simRef.current = sim
    })

    return () => {
      cancelled = true
      if (simRef.current) {
        (simRef.current as any).stop?.()
        simRef.current = null
      }
    }
    // physics is intentionally excluded: reheating is handled in the effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, links])

  // Reheat when physics params or quality mode change
  useEffect(() => {
    gravityStrengthRef.current = physics.centerForce * 0.1
    const sim = simRef.current as any
    if (!sim) return
    sim.force('link')?.strength(physics.linkStrength).distance(physics.linkDistance)
    sim.force('charge')?.strength(physics.charge)
    if (isFast) {
      sim.stop()
    } else {
      // Re-attach tick handler in case it was missing (e.g. switched from fast mode)
      sim.on('tick', () => onTickRef.current(simNodesRef.current, simLinksRef.current))
      // 'center' is a closure that reads gravityStrengthRef.current — no re-registration needed
      sim.alpha(0.3).restart()
    }
  }, [physics, isFast])

  return { simRef, simNodesRef, simLinksRef }
}
