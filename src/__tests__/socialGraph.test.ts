import { describe, it, expect } from 'vitest'
import { SocialGraph } from '@/services/mirofish/socialGraph'

// ── SocialGraph.generate() ────────────────────────────────────────────────────

describe('SocialGraph.generate()', () => {
  it('creates a graph with all agent IDs', () => {
    const ids = ['a', 'b', 'c', 'd', 'e']
    const graph = SocialGraph.generate(ids)
    expect(graph.allAgentIds()).toEqual(ids)
  })

  it('returns empty graph for single agent', () => {
    const graph = SocialGraph.generate(['solo'])
    expect(graph.allAgentIds()).toEqual(['solo'])
    expect(graph.getFollowing('solo')).toHaveLength(0)
    expect(graph.getFollowers('solo')).toHaveLength(0)
  })

  it('creates edges in the initial clique', () => {
    const ids = ['a', 'b', 'c']
    const graph = SocialGraph.generate(ids, 2)
    // With m=2 and 3 agents, initial clique is all 3 => all follow each other
    expect(graph.getFollowing('a')).toContain('b')
    expect(graph.getFollowing('a')).toContain('c')
    expect(graph.getFollowers('a')).toContain('b')
    expect(graph.getFollowers('a')).toContain('c')
  })

  it('every non-initial node follows at least 1 node', () => {
    const ids = Array.from({ length: 10 }, (_, i) => `agent-${i}`)
    const graph = SocialGraph.generate(ids, 2)
    // Nodes beyond the initial clique (first m+1=3) should each follow at least 1
    for (const id of ids.slice(3)) {
      expect(graph.getFollowing(id).length).toBeGreaterThanOrEqual(1)
    }
  })

  it('generates a graph with reasonable edge count', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `n${i}`)
    const graph = SocialGraph.generate(ids, 2)
    let totalEdges = 0
    for (const id of ids) {
      totalEdges += graph.getFollowing(id).length
    }
    // Initial clique (3 nodes, 6 directed edges) + remaining 17 nodes * ~2 edges each
    expect(totalEdges).toBeGreaterThanOrEqual(6 + 17)
  })
})

// ── follow() / unfollow() ─────────────────────────────────────────────────────

describe('SocialGraph — follow() / unfollow()', () => {
  it('follow creates a directed edge', () => {
    const graph = new SocialGraph(['a', 'b'])
    graph.follow('a', 'b')
    expect(graph.getFollowing('a')).toContain('b')
    expect(graph.getFollowers('b')).toContain('a')
  })

  it('follow is not bidirectional', () => {
    const graph = new SocialGraph(['a', 'b'])
    graph.follow('a', 'b')
    expect(graph.getFollowing('b')).not.toContain('a')
    expect(graph.getFollowers('a')).not.toContain('b')
  })

  it('unfollow removes the edge', () => {
    const graph = new SocialGraph(['a', 'b'])
    graph.follow('a', 'b')
    graph.unfollow('a', 'b')
    expect(graph.getFollowing('a')).not.toContain('b')
    expect(graph.getFollowers('b')).not.toContain('a')
  })

  it('follow is idempotent (no duplicate edges)', () => {
    const graph = new SocialGraph(['a', 'b'])
    graph.follow('a', 'b')
    graph.follow('a', 'b')
    expect(graph.getFollowing('a')).toHaveLength(1)
    expect(graph.getFollowers('b')).toHaveLength(1)
  })
})

// ── getFollowers() / getFollowing() ─────────────────────────────────────────

describe('SocialGraph — getFollowers() / getFollowing()', () => {
  it('getFollowers returns all followers', () => {
    const graph = new SocialGraph(['a', 'b', 'c'])
    graph.follow('b', 'a')
    graph.follow('c', 'a')
    const followers = graph.getFollowers('a')
    expect(followers).toContain('b')
    expect(followers).toContain('c')
    expect(followers).toHaveLength(2)
  })

  it('getFollowing returns all followed agents', () => {
    const graph = new SocialGraph(['a', 'b', 'c'])
    graph.follow('a', 'b')
    graph.follow('a', 'c')
    const following = graph.getFollowing('a')
    expect(following).toContain('b')
    expect(following).toContain('c')
    expect(following).toHaveLength(2)
  })

  it('getFollowers returns empty array for unknown agent', () => {
    const graph = new SocialGraph(['a'])
    expect(graph.getFollowers('unknown')).toHaveLength(0)
  })

  it('getFollowing returns empty array for unknown agent', () => {
    const graph = new SocialGraph(['a'])
    expect(graph.getFollowing('unknown')).toHaveLength(0)
  })
})

// ── followerCount() ─────────────────────────────────────────────────────────

describe('SocialGraph — followerCount()', () => {
  it('returns correct follower count', () => {
    const graph = new SocialGraph(['a', 'b', 'c', 'd'])
    graph.follow('b', 'a')
    graph.follow('c', 'a')
    graph.follow('d', 'a')
    expect(graph.followerCount('a')).toBe(3)
    expect(graph.followerCount('b')).toBe(0)
  })

  it('returns 0 for unknown agent', () => {
    const graph = new SocialGraph(['a'])
    expect(graph.followerCount('unknown')).toBe(0)
  })
})
