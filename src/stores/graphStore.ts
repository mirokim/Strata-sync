import { create } from 'zustand'
import type { GraphNode, GraphLink, PhysicsParams } from '@/types'
import { MOCK_NODES, MOCK_LINKS } from '@/data/mockGraph'

const DEFAULT_PHYSICS: PhysicsParams = {
  centerForce: 0.8,
  charge: -80,
  linkStrength: 0.7,
  linkDistance: 60,
  linkOpacity: 0.2,
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

/** Compute degreeMap, maxDegree, adjacencyByIndex from a links array in a single pass. */
function computeLinkMaps(links: GraphLink[]) {
  const degreeMap = new Map<string, number>()
  const adjacencyByIndex = new Map<string, Set<number>>()
  for (let i = 0; i < links.length; i++) {
    const link = links[i]
    const s = typeof link.source === 'string' ? link.source : (link.source as { id: string }).id
    const t = typeof link.target === 'string' ? link.target : (link.target as { id: string }).id
    degreeMap.set(s, (degreeMap.get(s) ?? 0) + 1)
    degreeMap.set(t, (degreeMap.get(t) ?? 0) + 1)
    if (!adjacencyByIndex.has(s)) adjacencyByIndex.set(s, new Set())
    if (!adjacencyByIndex.has(t)) adjacencyByIndex.set(t, new Set())
    adjacencyByIndex.get(s)!.add(i)
    adjacencyByIndex.get(t)!.add(i)
  }
  let maxDegree = 1
  for (const v of degreeMap.values()) { if (v > maxDegree) maxDegree = v }
  return { degreeMap, maxDegree, adjacencyByIndex }
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

  // Precomputed link maps (updated atomically with links in setLinks)
  /** nodeId -> link count — for Obsidian-style node sizing */
  degreeMap: Map<string, number>
  /** Maximum degree across all nodes (>=1) */
  maxDegree: number
  /** nodeId -> Set<linkIndex> — for O(1) neighbor lookup in hover/RAG */
  adjacencyByIndex: Map<string, Set<number>>

  /** Node ID to focus on via search — graph camera moves to this node */
  focusNodeId: string | null
  /** 3D cluster mode: tag/folder-based grouping force */
  clusterMode: 'none' | 'tag' | 'folder'
  /** Live simulation positions — written by Graph3D/2D on tick (throttled) */
  simPositions: Record<string, { x: number; y: number }>

  setSelectedNode: (id: string | null) => void
  setHoveredNode: (id: string | null) => void
  setAiHighlightNodes: (ids: string[]) => void
  setFocusNode: (id: string | null) => void
  setClusterMode: (mode: 'none' | 'tag' | 'folder') => void
  setSimPositions: (positions: Record<string, { x: number; y: number }>) => void
  updatePhysics: (params: Partial<PhysicsParams>) => void
  resetPhysics: () => void
  /** Phase 6: replace nodes/links with vault-derived data */
  setNodes: (nodes: GraphNode[]) => void
  setLinks: (links: GraphLink[]) => void
  /** Atomic batch update — avoids double scene rebuild from separate setNodes + setLinks calls */
  setGraph: (nodes: GraphNode[], links: GraphLink[]) => void
  /** Phase 6: restore original mock graph */
  resetToMock: () => void
  setGraphLayoutReady: (ready: boolean) => void
}

const { degreeMap: mockDegreeMap, maxDegree: mockMaxDegree, adjacencyByIndex: mockAdjacency } =
  computeLinkMaps(MOCK_LINKS)

export const useGraphStore = create<GraphState>()((set) => ({
  nodes: MOCK_NODES,
  links: MOCK_LINKS,
  selectedNodeId: null,
  hoveredNodeId: null,
  focusNodeId: null,
  clusterMode: 'none',
  simPositions: {},
  physics: { ...DEFAULT_PHYSICS },
  aiHighlightNodeIds: [],
  graphLayoutReady: false,
  degreeMap: mockDegreeMap,
  maxDegree: mockMaxDegree,
  adjacencyByIndex: mockAdjacency,

  setSelectedNode: (selectedNodeId) => set({ selectedNodeId }),
  setHoveredNode: (hoveredNodeId) => set({ hoveredNodeId }),
  setAiHighlightNodes: (aiHighlightNodeIds) => set({ aiHighlightNodeIds }),
  setFocusNode: (focusNodeId) => set({ focusNodeId }),
  setClusterMode: (clusterMode) => set({ clusterMode }),
  setSimPositions: (simPositions) => set({ simPositions }),
  updatePhysics: (params) =>
    set((state) => ({
      physics: { ...state.physics, ...clampPhysics(params) },
    })),
  resetPhysics: () => set({ physics: { ...DEFAULT_PHYSICS } }),
  // Reset layout-ready flag whenever nodes are replaced (new vault load)
  setNodes: (nodes) => set({ nodes, graphLayoutReady: false }),
  setLinks: (links) => set({ links, ...computeLinkMaps(links) }),
  setGraph: (nodes, links) => set({ nodes, graphLayoutReady: false, links, ...computeLinkMaps(links) }),
  resetToMock: () => set({
    nodes: MOCK_NODES,
    links: MOCK_LINKS,
    graphLayoutReady: false,
    degreeMap: mockDegreeMap,
    maxDegree: mockMaxDegree,
    adjacencyByIndex: mockAdjacency,
  }),
  setGraphLayoutReady: (graphLayoutReady) => set({ graphLayoutReady }),
}))

export { DEFAULT_PHYSICS, PHYSICS_BOUNDS }
