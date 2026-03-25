/**
 * pprWorker.ts — Personalized PageRank (PPR) calculation off the main thread
 *
 * Message protocol:
 *   IN  { type: 'ppr', requestId, seedIds, links, alpha, iterations }
 *         -> Power Iteration -> { type: 'done', requestId, scores: [string, number][] }
 *   OUT { type: 'error', requestId, message }
 */

interface PPRLink {
  source: string
  target: string
  strength: number
}

type InMsg = {
  type: 'ppr'
  requestId: string
  seedIds: string[]
  links: PPRLink[]
  alpha: number
  iterations: number
}

type OutMsg =
  | { type: 'done';  requestId: string; scores: [string, number][] }
  | { type: 'error'; requestId: string; message: string }

self.onmessage = (e: MessageEvent<InMsg>) => {
  const { requestId, seedIds, links, alpha, iterations } = e.data
  try {
    const scores = runPPR(seedIds, links, alpha, iterations)
    self.postMessage({ type: 'done', requestId, scores: [...scores.entries()] } satisfies OutMsg)
  } catch (err) {
    self.postMessage({ type: 'error', requestId, message: String(err) } satisfies OutMsg)
  }
}

function runPPR(
  seedIds: string[],
  links: PPRLink[],
  alpha: number,
  iterations: number,
): Map<string, number> {
  if (seedIds.length === 0 || links.length === 0) return new Map()

  // Build weighted adjacency list (undirected graph)
  const outWeightSum = new Map<string, number>()
  const inEdges = new Map<string, { from: string; w: number }[]>()

  for (const link of links) {
    const { source: src, target: tgt, strength: w } = link

    outWeightSum.set(src, (outWeightSum.get(src) ?? 0) + w)
    outWeightSum.set(tgt, (outWeightSum.get(tgt) ?? 0) + w)

    if (!inEdges.has(tgt)) inEdges.set(tgt, [])
    if (!inEdges.has(src)) inEdges.set(src, [])
    inEdges.get(tgt)!.push({ from: src, w })
    inEdges.get(src)!.push({ from: tgt, w })
  }

  const allNodes = new Set<string>([...outWeightSum.keys(), ...inEdges.keys()])
  for (const id of seedIds) allNodes.add(id)

  const seedSet = new Set(seedIds)
  const seedVal = 1 / seedIds.length

  // Double buffer — swap two Maps each iteration instead of creating new Map
  let scores = new Map<string, number>()
  let next = new Map<string, number>()
  for (const id of allNodes) {
    scores.set(id, seedSet.has(id) ? seedVal : 0)
    next.set(id, 0)
  }

  for (let iter = 0; iter < iterations; iter++) {
    for (const id of allNodes) {
      let s = seedSet.has(id) ? alpha * seedVal : 0
      for (const { from, w } of inEdges.get(id) ?? []) {
        const totalW = outWeightSum.get(from) ?? 1
        s += (1 - alpha) * (scores.get(from) ?? 0) * w / totalW
      }
      next.set(id, s)
    }
    // Buffer swap
    const tmp = scores; scores = next; next = tmp
  }

  return scores
}
