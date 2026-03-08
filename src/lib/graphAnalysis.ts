/**
 * graphAnalysis.ts
 *
 * Provides six analysis tools:
 *   A. TfIdfIndex      — Cosine similarity-based document search + implicit link discovery
 *   B. computePageRank — Document ranking by link importance (hub detection)
 *   C. detectClusters  — Union-Find connected components (topic cluster detection)
 *   D. detectBridgeNodes — Bridge node detection connecting multiple clusters
 *   E. getClusterTopics  — Top TF-IDF keyword extraction per cluster
 *   F. findImplicitLinks — Hidden semantically similar connections without WikiLinks
 */

import type { LoadedDocument } from '@/types'
import { logger } from '@/lib/logger'

// ── Shared tokenizer ─────────────────────────────────────────────────────────

const KO_SUFFIXES = [
  '이라는', '이라고', '에서는', '에게서', '한테서', '으로서', '으로써', '으로는',
  '에서의', '으로의', '에서도', '으로도',
  '이라', '에서', '에게', '한테', '까지', '부터', '처럼', '같은', '같이',
  '만큼', '으로', '이랑', '라는', '라고', '이란', '에는', '하고',
  '은', '는', '이', '가', '을', '를', '와', '과',
  '에', '도', '만', '의', '로',
]

function stemKorean(token: string): string[] {
  const results = [token]
  for (const suffix of KO_SUFFIXES) {
    if (token.endsWith(suffix) && token.length > suffix.length + 1) {
      results.push(token.slice(0, -suffix.length))
      break
    }
  }
  return [...new Set(results)]
}

export function tokenize(text: string): string[] {
  // Korean number+unit separation: "28일" → "28 일", "1월" → "1 월"
  // This ensures "28" from a query like "28일" matches "28" in a filename like "[2026.01.28]"
  const normalized = text.replace(/(\d+)(년|월|일|시|분|초|개|명|번|회|차)/g, '$1 $2')
  const raw = normalized
    .toLowerCase()
    .split(/[\s,.\-_?!;:()[\]{}'"《》「」【】]+/)
    .filter(t => t.length > 1)

  const stems: string[] = []
  for (const token of raw) {
    for (const stem of stemKorean(token)) {
      stems.push(stem)
    }
  }
  return [...new Set(stems)]
}

// ── A. TF-IDF Index ──────────────────────────────────────────────────────────

export interface TfIdfResult {
  docId: string
  filename: string
  speaker: string
  score: number
}

interface TfIdfDoc {
  docId: string
  filename: string
  speaker: string
  vector: Map<string, number>
  norm: number
}

export interface ImplicitLink {
  docAId: string
  docBId: string
  filenameA: string
  filenameB: string
  similarity: number
}

// Serialized form stored in IndexedDB (Maps → plain arrays for JSON compatibility)
export interface SerializedTfIdf {
  schemaVersion: 3
  fingerprint: string
  idf: [string, number][]
  docs: { docId: string; filename: string; speaker: string; vector: [string, number][]; norm: number }[]
}

export class TfIdfIndex {
  private docs: TfIdfDoc[] = []
  private idf: Map<string, number> = new Map()
  private built = false
  private _implicitLinks: ImplicitLink[] | null = null
  private _implicitAdjRef: Map<string, string[]> | null = null

  get isBuilt() { return this.built }
  get docCount() { return this.docs.length }

  /** Serialize index state to a plain object suitable for IndexedDB storage. */
  serialize(fingerprint: string): SerializedTfIdf {
    return {
      schemaVersion: 3,
      fingerprint,
      idf: [...this.idf.entries()],
      docs: this.docs.map(d => ({
        docId: d.docId,
        filename: d.filename,
        speaker: d.speaker,
        vector: [...d.vector.entries()],
        norm: d.norm,
      })),
    }
  }

  /** Restore index state from a previously serialized object. */
  restore(data: SerializedTfIdf): void {
    this.idf = new Map(data.idf)
    this.docs = data.docs.map(d => ({
      docId: d.docId,
      filename: d.filename,
      speaker: d.speaker,
      vector: new Map(d.vector),
      norm: d.norm,
    }))
    this._implicitLinks = null
    this._implicitAdjRef = null
    this.built = true
    logger.debug(`[graphAnalysis] TF-IDF index restored from cache: ${this.docs.length} documents`)
  }

  build(loadedDocuments: LoadedDocument[]): void {
    this.docs = []
    this.idf = new Map()
    this.built = false

    const docTerms: Map<string, Map<string, number>> = new Map()
    const docFreq: Map<string, number> = new Map()

    for (const doc of loadedDocuments) {
      // Combine filename + tags + speaker + all sections into a single text
      const allText = [
        doc.filename.replace(/\.md$/i, ''),
        doc.tags?.join(' ') ?? '',
        doc.speaker ?? '',
        ...doc.sections.map(s => `${s.heading} ${s.body}`),
        doc.rawContent ?? '',
      ].join(' ')

      const tokens = tokenize(allText)
      const termCount = new Map<string, number>()
      for (const token of tokens) {
        termCount.set(token, (termCount.get(token) ?? 0) + 1)
      }
      docTerms.set(doc.id, termCount)

      for (const term of termCount.keys()) {
        docFreq.set(term, (docFreq.get(term) ?? 0) + 1)
      }
    }

    const N = loadedDocuments.length

    // Smoothed IDF: log((N+1)/(df+1)) + 1
    for (const [term, df] of docFreq) {
      this.idf.set(term, Math.log((N + 1) / (df + 1)) + 1)
    }

    // TF-IDF vector + L2 norm calculation
    for (const doc of loadedDocuments) {
      const termCount = docTerms.get(doc.id)!
      const totalTerms = [...termCount.values()].reduce((a, b) => a + b, 0)

      const vector = new Map<string, number>()
      let normSq = 0
      for (const [term, count] of termCount) {
        const tf = count / totalTerms
        const idf = this.idf.get(term) ?? 1
        const tfidf = tf * idf
        vector.set(term, tfidf)
        normSq += tfidf * tfidf
      }

      this.docs.push({
        docId: doc.id,
        filename: doc.filename,
        speaker: doc.speaker ?? 'unknown',
        vector,
        norm: Math.sqrt(normSq),
      })
    }

    // Invalidate implicit link cache on rebuild
    this._implicitLinks = null
    this._implicitAdjRef = null

    this.built = true
    logger.debug(`[graphAnalysis] TF-IDF index built: ${this.docs.length} documents`)
  }

  search(query: string, topN: number = 8): TfIdfResult[] {
    if (!this.built || this.docs.length === 0) return []

    const queryTerms = tokenize(query)
    if (queryTerms.length === 0) return []

    // Query vector (TF=1/n for each term, IDF from corpus)
    const queryVec = new Map<string, number>()
    let queryNormSq = 0
    for (const term of queryTerms) {
      // OOV handling: use IDF=log(2) for words not in corpus
      const idf = this.idf.get(term) ?? Math.log(2)
      queryVec.set(term, idf)
      queryNormSq += idf * idf
    }
    const queryNorm = Math.sqrt(queryNormSq)
    if (queryNorm === 0) return []

    const scored: { doc: TfIdfDoc; score: number }[] = []
    for (const doc of this.docs) {
      if (doc.norm === 0) continue
      let dot = 0
      for (const [term, qScore] of queryVec) {
        const dScore = doc.vector.get(term) ?? 0
        dot += qScore * dScore
      }
      const cosine = dot / (queryNorm * doc.norm)
      if (cosine > 0.005) scored.push({ doc, score: cosine })
    }

    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, topN).map(s => ({
      docId: s.doc.docId,
      filename: s.doc.filename,
      speaker: s.doc.speaker,
      score: Math.min(1, s.score),
    }))
  }

  /**
   * Returns semantically similar document pairs not connected by WikiLinks.
   * Pairs with TF-IDF cosine similarity >= threshold are included.
   *
   * Returns cached results when adjacency reference hasn't changed (O(N²) computed once).
   *
   * @param adjacency  Existing WikiLink adjacency map (used to exclude already-connected pairs)
   * @param topN       Maximum number of pairs to return
   * @param threshold  Minimum cosine similarity (default 0.25)
   */
  findImplicitLinks(
    adjacency: Map<string, string[]>,
    topN: number = 6,
    threshold: number = 0.25
  ): ImplicitLink[] {
    if (!this.built || this.docs.length < 2) return []

    // Cache keyed on adjacency reference
    if (this._implicitLinks && this._implicitAdjRef === adjacency) {
      return this._implicitLinks.slice(0, topN)
    }

    // Build existing WikiLink pairs as a Set — O(1) lookup
    const existingLinks = new Set<string>()
    for (const [from, neighbors] of adjacency) {
      for (const to of neighbors) {
        const key = from < to ? `${from}|${to}` : `${to}|${from}`
        existingLinks.add(key)
      }
    }

    // Performance cap: O(N²) computation over max 250 documents
    const docs = this.docs.slice(0, 250)
    const pairs: ImplicitLink[] = []

    for (let i = 0; i < docs.length; i++) {
      for (let j = i + 1; j < docs.length; j++) {
        const a = docs[i], b = docs[j]
        if (a.norm === 0 || b.norm === 0) continue

        const key = a.docId < b.docId ? `${a.docId}|${b.docId}` : `${b.docId}|${a.docId}`
        if (existingLinks.has(key)) continue

        // Cosine similarity: compute only shared terms using a's vector as the base
        let dot = 0
        for (const [term, aScore] of a.vector) {
          const bScore = b.vector.get(term) ?? 0
          dot += aScore * bScore
        }
        const sim = dot / (a.norm * b.norm)
        if (sim >= threshold) {
          pairs.push({
            docAId: a.docId,
            docBId: b.docId,
            filenameA: a.filename,
            filenameB: b.filename,
            similarity: sim,
          })
        }
      }
    }

    pairs.sort((a, b) => b.similarity - a.similarity)
    this._implicitLinks = pairs
    this._implicitAdjRef = adjacency
    logger.debug(`[graphAnalysis] Implicit links found: ${pairs.length} pairs (threshold=${threshold})`)

    return pairs.slice(0, topN)
  }
}

/** TF-IDF singleton — call build() after vault load */
export const tfidfIndex = new TfIdfIndex()

// ── B. PageRank ───────────────────────────────────────────────────────────────

/**
 * Computes PageRank over the document graph.
 * Documents referenced by more documents receive a higher rank.
 *
 * @returns Map<docId, normalizedRank 0..1>
 */
export function computePageRank(
  adjacency: Map<string, string[]>,
  iterations: number = 25,
  damping: number = 0.85
): Map<string, number> {
  const nodes = [...adjacency.keys()]
  const N = nodes.length
  if (N === 0) return new Map()

  // Pre-compute reverse edges (in-edges) for O(N+M) traversal
  const inEdges = new Map<string, string[]>()
  for (const id of nodes) inEdges.set(id, [])
  for (const [from, neighbors] of adjacency) {
    for (const to of neighbors) {
      if (!inEdges.has(to)) inEdges.set(to, [])
      inEdges.get(to)!.push(from)
    }
  }

  const rank = new Map<string, number>()
  for (const id of nodes) rank.set(id, 1 / N)

  for (let iter = 0; iter < iterations; iter++) {
    // Sum of rank for nodes with no out-links (dangling nodes)
    const danglingSum = nodes
      .filter(id => (adjacency.get(id)?.length ?? 0) === 0)
      .reduce((sum, id) => sum + (rank.get(id) ?? 0), 0)

    const newRank = new Map<string, number>()
    for (const id of nodes) {
      const inSum = (inEdges.get(id) ?? []).reduce((sum, from) => {
        const outDegree = adjacency.get(from)?.length ?? 1
        return sum + (rank.get(from) ?? 0) / outDegree
      }, 0)
      newRank.set(id, (1 - damping) / N + damping * (inSum + danglingSum / N))
    }

    for (const [id, r] of newRank) rank.set(id, r)
  }

  // Normalize to 0..1
  const max = Math.max(1e-10, ...rank.values())
  for (const [id, r] of rank) rank.set(id, r / max)

  return rank
}

// ── C. Cluster Detection (Union-Find) ─────────────────────────────────────────

/**
 * Detects connected components (clusters) using Union-Find.
 * Documents connected in the same WikiLink network receive the same cluster ID.
 *
 * @returns Map<docId, clusterId> — clusterId 0 is the largest cluster
 */
export function detectClusters(
  adjacency: Map<string, string[]>
): Map<string, number> {
  const parent = new Map<string, string>()

  function find(x: string): string {
    if (!parent.has(x)) parent.set(x, x)
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!))
    return parent.get(x)!
  }

  function union(a: string, b: string) {
    const ra = find(a), rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }

  for (const [id, neighbors] of adjacency) {
    for (const nb of neighbors) union(id, nb)
  }

  // Group by root
  const groups = new Map<string, string[]>()
  for (const id of adjacency.keys()) {
    const root = find(id)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root)!.push(id)
  }

  // Sort descending by cluster size (0 = largest cluster)
  const sorted = [...groups.values()].sort((a, b) => b.length - a.length)
  const clusterMap = new Map<string, number>()
  sorted.forEach((members, idx) => {
    for (const id of members) clusterMap.set(id, idx)
  })

  return clusterMap
}

// ── Graph Metrics Cache ───────────────────────────────────────────────────────

export interface GraphMetrics {
  pageRank: Map<string, number>
  clusters: Map<string, number>
  clusterCount: number
}

let _metricsCache: GraphMetrics | null = null
let _metricsLinksRef: unknown = null

/**
 * Computes PageRank + clusters once and caches the result.
 * Automatically recomputes when the links array reference changes.
 */
export function getGraphMetrics(
  adjacency: Map<string, string[]>,
  linksRef: unknown
): GraphMetrics {
  if (_metricsCache && _metricsLinksRef === linksRef) return _metricsCache

  const pageRank = computePageRank(adjacency)
  const clusters = detectClusters(adjacency)
  const clusterCount = new Set(clusters.values()).size

  _metricsCache = { pageRank, clusters, clusterCount }
  _metricsLinksRef = linksRef
  return _metricsCache
}

// ── D. Bridge Node Detection ──────────────────────────────────────────────────

export interface BridgeNode {
  docId: string
  /** Number of distinct clusters this node connects to (including its own) */
  clusterCount: number
}

/**
 * Detects bridge nodes that have neighbors spanning multiple clusters.
 *
 * A bridge node is any node with at least one neighbor in a different cluster.
 * These nodes are architecturally central documents that link topic areas together.
 *
 * @returns Array sorted by clusterCount descending
 */
export function detectBridgeNodes(
  adjacency: Map<string, string[]>,
  clusters: Map<string, number>
): BridgeNode[] {
  const results: BridgeNode[] = []

  for (const [docId, neighbors] of adjacency) {
    const ownCluster = clusters.get(docId)
    if (ownCluster === undefined) continue

    const neighborClusters = new Set<number>([ownCluster])
    for (const nb of neighbors) {
      const nbCluster = clusters.get(nb)
      if (nbCluster !== undefined) neighborClusters.add(nbCluster)
    }

    if (neighborClusters.size >= 2) {
      results.push({ docId, clusterCount: neighborClusters.size })
    }
  }

  return results.sort((a, b) => b.clusterCount - a.clusterCount)
}

// ── E. Cluster Topic Keywords ─────────────────────────────────────────────────

/**
 * Extracts the top TF-IDF keywords for each cluster.
 *
 * Aggregates text from all documents in a cluster and returns the highest-frequency tokens.
 * Used in structure headers in the form "Cluster 1 [combat/skill/balance]".
 *
 * @param clusters  Map<docId, clusterId>
 * @param docs      Vault document array
 * @param topK      Number of keywords to return per cluster
 * @returns Map<clusterId, topKeywords[]>
 */
export function getClusterTopics(
  clusters: Map<string, number>,
  docs: LoadedDocument[],
  topK: number = 3
): Map<number, string[]> {
  const clusterTexts = new Map<number, string[]>()

  for (const doc of docs) {
    const cId = clusters.get(doc.id)
    if (cId === undefined) continue
    if (!clusterTexts.has(cId)) clusterTexts.set(cId, [])

    const text = [
      doc.filename.replace(/\.md$/i, ''),
      ...(doc.tags ?? []),
      ...doc.sections.map(s => `${s.heading} ${s.body}`),
    ].join(' ')
    clusterTexts.get(cId)!.push(text)
  }

  const result = new Map<number, string[]>()
  for (const [cId, texts] of clusterTexts) {
    const freq = new Map<string, number>()
    for (const text of texts) {
      for (const token of tokenize(text)) {
        freq.set(token, (freq.get(token) ?? 0) + 1)
      }
    }
    const keywords = [...freq.entries()]
      .filter(([t]) => t.length >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK)
      .map(([t]) => t)
    result.set(cId, keywords)
  }

  return result
}
