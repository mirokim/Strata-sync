/**
 * oasisEnvironment.ts — OASIS environment (post store + recommendation engine + action decisions)
 *
 * TypeScript reimplementation of OASIS environment.py + recommendation_system.py + action_space.py.
 */

import type { SocialGraph } from './socialGraph'

export interface OASISPost {
  id: string
  authorId: string
  authorName: string
  stance: string
  content: string
  round: number
  timestamp: number
  likes: Set<string>      // agent IDs that liked this post
  reposts: Set<string>    // agent IDs that reposted this
  originalPostId?: string // original post ID if this is a repost
  /** Author's community influence (0.1–1.0) — reflected in recommendation weight */
  influenceWeight: number
}

export type ActionType = 'post' | 'repost' | 'like' | 'follow' | 'do_nothing'

export interface AgentDecision {
  action: ActionType
  targetPostId?: string
  targetAgentId?: string
}

// Default weights per action type (corresponds to OASIS action_space)
const ACTION_WEIGHTS: Record<ActionType, number> = {
  post:       0.75,
  repost:     0.15,
  like:       0.05,
  follow:     0.03,
  do_nothing: 0.02,
}

export class OASISEnvironment {
  posts: OASISPost[] = []
  private counter = 0

  constructor(private graph: SocialGraph) {}

  // ── Post management ─────────────────────────────────────────────────────────

  addPost(
    authorId: string, authorName: string, stance: string,
    content: string, round: number, originalPostId?: string,
    influenceWeight = 0.5,
  ): OASISPost {
    const post: OASISPost = {
      id: `post_${++this.counter}`,
      authorId, authorName, stance, content, round,
      timestamp: Date.now(),
      likes: new Set(),
      reposts: new Set(),
      originalPostId,
      influenceWeight,
    }
    this.posts.push(post)
    return post
  }

  likePost(agentId: string, postId: string): void {
    this.posts.find(p => p.id === postId)?.likes.add(agentId)
  }

  getPost(postId: string): OASISPost | undefined {
    return this.posts.find(p => p.id === postId)
  }

  // ── Recommendation engine (corresponds to OASIS recommendation_system.py) ──

  getRecommendedPosts(agentId: string, limit = 15): OASISPost[] {
    const following = new Set(this.graph.getFollowing(agentId))

    const fromFollowing = this.posts
      .filter(p => following.has(p.authorId) && p.authorId !== agentId)
      .slice(-20)

    // Trending: sum of likes + reposts + author influence weight
    const trending = [...this.posts]
      .sort((a, b) => {
        const scoreA = (a.likes.size + a.reposts.size) + a.influenceWeight * 3
        const scoreB = (b.likes.size + b.reposts.size) + b.influenceWeight * 3
        return scoreB - scoreA
      })
      .slice(0, 10)

    const seen = new Set<string>()
    const merged: OASISPost[] = []
    for (const p of [...fromFollowing, ...trending]) {
      if (!seen.has(p.id)) { seen.add(p.id); merged.push(p) }
    }
    return merged.slice(0, limit)
  }

  // ── Action decision (corresponds to OASIS action_space.py) ──────────────────

  decideAction(agentId: string): AgentDecision {
    const hasPosts = this.posts.length > 0
    const following = this.graph.getFollowing(agentId)
    const allIds = this.graph.allAgentIds()
    const notFollowing = allIds.filter(id => id !== agentId && !following.includes(id))

    const weights = { ...ACTION_WEIGHTS }
    if (!hasPosts) {
      weights.post += (weights.repost ?? 0) + (weights.like ?? 0)
      weights.repost = 0
      weights.like = 0
    }
    if (!notFollowing.length) {
      weights.post += weights.follow ?? 0
      weights.follow = 0
    }

    const entries = Object.entries(weights) as [ActionType, number][]
    const total = entries.reduce((s, [, w]) => s + w, 0)
    let rng = Math.random() * total
    let action: ActionType = 'post'
    for (const [act, w] of entries) {
      rng -= w
      if (rng <= 0) { action = act; break }
    }

    if ((action === 'repost' || action === 'like') && hasPosts) {
      const pool = [...this.posts]
        .sort((a, b) => (b.likes.size + b.reposts.size) - (a.likes.size + a.reposts.size))
        .slice(0, 5)
      if (!pool.length) return { action: 'post' }
      const target = pool[Math.floor(Math.random() * pool.length)]
      return { action, targetPostId: target.id }
    }

    if (action === 'follow' && notFollowing.length) {
      const target = notFollowing[Math.floor(Math.random() * notFollowing.length)]
      return { action, targetAgentId: target }
    }

    return { action }
  }
}
