import { describe, it, expect, beforeEach } from 'vitest'
import { useGraphStore, DEFAULT_PHYSICS, PHYSICS_BOUNDS } from '@/stores/graphStore'
import { MOCK_NODES, MOCK_LINKS } from '@/data/mockGraph'

beforeEach(() => {
  useGraphStore.setState({
    nodes: MOCK_NODES,
    links: MOCK_LINKS,
    selectedNodeId: null,
    hoveredNodeId: null,
    aiHighlightNodeIds: [],
    physics: { ...DEFAULT_PHYSICS },
  })
})

describe('useGraphStore — initial state', () => {
  it('is initialized with MOCK_NODES', () => {
    expect(useGraphStore.getState().nodes).toHaveLength(MOCK_NODES.length)
  })

  it('is initialized with MOCK_LINKS', () => {
    expect(useGraphStore.getState().links).toHaveLength(MOCK_LINKS.length)
  })

  it('selectedNodeId defaults to null', () => {
    expect(useGraphStore.getState().selectedNodeId).toBeNull()
  })

  it('hoveredNodeId defaults to null', () => {
    expect(useGraphStore.getState().hoveredNodeId).toBeNull()
  })

  it('physics defaults match DEFAULT_PHYSICS', () => {
    expect(useGraphStore.getState().physics).toEqual(DEFAULT_PHYSICS)
  })
})

describe('useGraphStore — setSelectedNode()', () => {
  it('sets a node ID', () => {
    const firstNodeId = MOCK_NODES[0].id
    useGraphStore.getState().setSelectedNode(firstNodeId)
    expect(useGraphStore.getState().selectedNodeId).toBe(firstNodeId)
  })

  it('clears to null', () => {
    useGraphStore.getState().setSelectedNode(MOCK_NODES[0].id)
    useGraphStore.getState().setSelectedNode(null)
    expect(useGraphStore.getState().selectedNodeId).toBeNull()
  })
})

describe('useGraphStore — setHoveredNode()', () => {
  it('sets a hovered node ID', () => {
    useGraphStore.getState().setHoveredNode('some_node')
    expect(useGraphStore.getState().hoveredNodeId).toBe('some_node')
  })

  it('clears to null', () => {
    useGraphStore.getState().setHoveredNode('some_node')
    useGraphStore.getState().setHoveredNode(null)
    expect(useGraphStore.getState().hoveredNodeId).toBeNull()
  })
})

describe('useGraphStore — updatePhysics()', () => {
  it('updates a single physics param', () => {
    useGraphStore.getState().updatePhysics({ centerForce: 0.5 })
    expect(useGraphStore.getState().physics.centerForce).toBe(0.5)
  })

  it('preserves other physics params when partially updating', () => {
    useGraphStore.getState().updatePhysics({ charge: -200 })
    const { physics } = useGraphStore.getState()
    expect(physics.charge).toBe(-200)
    expect(physics.centerForce).toBe(DEFAULT_PHYSICS.centerForce)
    expect(physics.linkStrength).toBe(DEFAULT_PHYSICS.linkStrength)
    expect(physics.linkDistance).toBe(DEFAULT_PHYSICS.linkDistance)
  })

  it('clamps centerForce to [0, 1]', () => {
    useGraphStore.getState().updatePhysics({ centerForce: 5 })
    expect(useGraphStore.getState().physics.centerForce).toBe(PHYSICS_BOUNDS.centerForce.max)

    useGraphStore.getState().updatePhysics({ centerForce: -1 })
    expect(useGraphStore.getState().physics.centerForce).toBe(PHYSICS_BOUNDS.centerForce.min)
  })

  it('clamps charge to [-1000, 0]', () => {
    useGraphStore.getState().updatePhysics({ charge: -2000 })
    expect(useGraphStore.getState().physics.charge).toBe(PHYSICS_BOUNDS.charge.min)

    useGraphStore.getState().updatePhysics({ charge: 100 })
    expect(useGraphStore.getState().physics.charge).toBe(PHYSICS_BOUNDS.charge.max)
  })

  it('clamps linkDistance to [20, 300]', () => {
    useGraphStore.getState().updatePhysics({ linkDistance: 1000 })
    expect(useGraphStore.getState().physics.linkDistance).toBe(PHYSICS_BOUNDS.linkDistance.max)

    useGraphStore.getState().updatePhysics({ linkDistance: 1 })
    expect(useGraphStore.getState().physics.linkDistance).toBe(PHYSICS_BOUNDS.linkDistance.min)
  })
})

describe('useGraphStore — resetPhysics()', () => {
  it('restores DEFAULT_PHYSICS after modifications', () => {
    useGraphStore.getState().updatePhysics({ centerForce: 0.9, charge: -100, linkDistance: 200 })
    useGraphStore.getState().resetPhysics()
    expect(useGraphStore.getState().physics).toEqual(DEFAULT_PHYSICS)
  })
})

describe('useGraphStore — setAiHighlightNodes()', () => {
  it('defaults to empty array', () => {
    expect(useGraphStore.getState().aiHighlightNodeIds).toEqual([])
  })

  it('sets a list of node IDs', () => {
    useGraphStore.getState().setAiHighlightNodes(['node_a', 'node_b'])
    expect(useGraphStore.getState().aiHighlightNodeIds).toEqual(['node_a', 'node_b'])
  })

  it('clears to empty array', () => {
    useGraphStore.getState().setAiHighlightNodes(['node_a'])
    useGraphStore.getState().setAiHighlightNodes([])
    expect(useGraphStore.getState().aiHighlightNodeIds).toEqual([])
  })

  it('replaces previous list entirely', () => {
    useGraphStore.getState().setAiHighlightNodes(['node_a', 'node_b'])
    useGraphStore.getState().setAiHighlightNodes(['node_c'])
    expect(useGraphStore.getState().aiHighlightNodeIds).toEqual(['node_c'])
  })

  it('does not affect other store fields', () => {
    const firstNodeId = MOCK_NODES[0].id
    useGraphStore.getState().setSelectedNode(firstNodeId)
    useGraphStore.getState().setAiHighlightNodes(['node_x'])
    expect(useGraphStore.getState().selectedNodeId).toBe(firstNodeId)
    expect(useGraphStore.getState().hoveredNodeId).toBeNull()
  })
})
