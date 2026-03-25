/**
 * socialGraph.ts — OASIS social network graph
 *
 * Generates a realistic follow network using the Barabasi-Albert
 * preferential attachment model.
 * TypeScript reimplementation of OASIS social_graph.py.
 */

export class SocialGraph {
  private following = new Map<string, Set<string>>()  // agentId -> set of IDs being followed
  private followers = new Map<string, Set<string>>()  // agentId -> set of follower IDs

  constructor(agentIds: string[]) {
    for (const id of agentIds) {
      this.following.set(id, new Set())
      this.followers.set(id, new Set())
    }
  }

  /**
   * Generate a social graph using the Barabasi-Albert model.
   * m: number of existing nodes a new node connects to (default 2).
   * Nodes with more followers have higher probability of receiving new follows.
   */
  static generate(agentIds: string[], m = 2): SocialGraph {
    const graph = new SocialGraph(agentIds)
    if (agentIds.length < 2) return graph

    const initial = agentIds.slice(0, Math.min(m + 1, agentIds.length))
    for (const a of initial) {
      for (const b of initial) {
        if (a !== b) graph.follow(a, b)
      }
    }

    for (const newNode of agentIds.slice(initial.length)) {
      for (const target of graph._preferentialAttachment(newNode, m)) {
        graph.follow(newNode, target)
      }
    }

    return graph
  }

  private _preferentialAttachment(exclude: string, m: number): string[] {
    const pool: string[] = []
    for (const [id, fset] of this.followers) {
      if (id === exclude) continue
      const weight = fset.size + 1
      for (let i = 0; i < weight; i++) pool.push(id)
    }
    // Fisher-Yates shuffle (Math.random().sort() has distribution bias)
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[pool[i], pool[j]] = [pool[j], pool[i]]
    }
    const targets = new Set<string>()
    for (const c of pool) {
      if (targets.size >= m) break
      targets.add(c)
    }
    return [...targets]
  }

  follow(from: string, to: string): void {
    this.following.get(from)?.add(to)
    this.followers.get(to)?.add(from)
  }

  unfollow(from: string, to: string): void {
    this.following.get(from)?.delete(to)
    this.followers.get(to)?.delete(from)
  }

  getFollowing(agentId: string): string[] {
    return [...(this.following.get(agentId) ?? [])]
  }

  getFollowers(agentId: string): string[] {
    return [...(this.followers.get(agentId) ?? [])]
  }

  followerCount(agentId: string): number {
    return this.followers.get(agentId)?.size ?? 0
  }

  allAgentIds(): string[] {
    return [...this.following.keys()]
  }
}
