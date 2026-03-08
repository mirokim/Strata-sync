import { create } from 'zustand'
import type { GraphNode, GraphLink, PhysicsParams } from '@/types'
import { MOCK_NODES, MOCK_LINKS } from '@/data/mockGraph'

const DEFAULT_PHYSICS: PhysicsParams = {
  centerForce: 0.8,
  charge: -80,
  linkStrength: 0.7,
  linkDistance: 60,
  linkOpacity: 0.4,
  nodeRadius: 7,
}

const PHYSICS_BOUNDS = {
  centerForce: { min: 0, max: 1 },
  charge: { min: -1000, max: 0 },
  linkStrength: { min: 0, max: 2 },
  linkDistance: { min: 20, max: 300 },
  linkOpacity: { min: 0, max: 1 },
  nodeRadius: { min: 2, max: 20 },
}

function clampPhysics(params: Partial<PhysicsParams>): Partial<PhysicsParams> {
  const clamped: Partial<PhysicsParams> = {}
  for (const [k, v] of Object.entries(params) as [keyof PhysicsParams, number][]) {
    const { min, max } = PHYSICS_BOUNDS[k]
    clamped[k] = Math.min(max, Math.max(min, v))
  }
  return clamped
}

interface GraphState {
  nodes: GraphNode[]
  links: GraphLink[]
  selectedNodeId: string | null
  hoveredNodeId: string | null
  physics: PhysicsParams
  /** Node IDs to highlight while AI is scanning/analyzing */
  aiHighlightNodeIds: string[]
  /** True after the initial graph layout (fit-to-view) has been applied */
  graphLayoutReady: boolean

  setSelectedNode: (id: string | null) => void
  setHoveredNode: (id: string | null) => void
  setAiHighlightNodes: (ids: string[]) => void
  updatePhysics: (params: Partial<PhysicsParams>) => void
  resetPhysics: () => void
  /** Phase 6: replace nodes/links with vault-derived data */
  setNodes: (nodes: GraphNode[]) => void
  setLinks: (links: GraphLink[]) => void
  /** Phase 6: restore original mock graph */
  resetToMock: () => void
  setGraphLayoutReady: (ready: boolean) => void
}

export const useGraphStore = create<GraphState>()((set) => ({
  nodes: MOCK_NODES,
  links: MOCK_LINKS,
  selectedNodeId: null,
  hoveredNodeId: null,
  physics: { ...DEFAULT_PHYSICS },
  aiHighlightNodeIds: [],
  graphLayoutReady: false,

  setSelectedNode: (selectedNodeId) => set({ selectedNodeId }),
  setHoveredNode: (hoveredNodeId) => set({ hoveredNodeId }),
  setAiHighlightNodes: (aiHighlightNodeIds) => set({ aiHighlightNodeIds }),
  updatePhysics: (params) =>
    set((state) => ({
      physics: { ...state.physics, ...clampPhysics(params) },
    })),
  resetPhysics: () => set({ physics: { ...DEFAULT_PHYSICS } }),
  // Reset layout-ready flag whenever nodes are replaced (new vault load)
  setNodes: (nodes) => set({ nodes, graphLayoutReady: false }),
  setLinks: (links) => set({ links }),
  resetToMock: () => set({ nodes: MOCK_NODES, links: MOCK_LINKS, graphLayoutReady: false }),
  setGraphLayoutReady: (graphLayoutReady) => set({ graphLayoutReady }),
}))

export { DEFAULT_PHYSICS, PHYSICS_BOUNDS }
