/**
 * graphAnalysis.ts
 *
 * Provides analysis tools:
 *   A. TfIdfIndex      — BM25 cosine similarity-based document search + implicit link discovery
 *   B. computePageRank — Document ranking by link importance (hub detection)
 *   C. detectClusters  — Union-Find connected components (topic cluster detection)
 *   D. detectBridgeNodes — Bridge node detection connecting multiple clusters
 *   E. getClusterTopics  — Top TF-IDF keyword extraction per cluster
 *   F. findImplicitLinks — Hidden semantically similar connections without WikiLinks
 *   G. computeInsights   — Comprehensive vault analysis (hubs, orphans, gaps, clusters)
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

const _stemCache = new Map<string, string[]>()
function stemKorean(token: string): string[] {
  const cached = _stemCache.get(token)
  if (cached) return cached
  const results = [token]
  for (const suffix of KO_SUFFIXES) {
    if (token.endsWith(suffix) && token.length > suffix.length + 1) {
      results.push(token.slice(0, -suffix.length))
      break
    }
  }
  const out = results.length === 1 ? results : [...new Set(results)]
  _stemCache.set(token, out)
  return out
}

export function tokenize(text: string): string[] {
  // Korean number+unit separation: "28일" → "28 일", "1월" → "1 월"
  // This ensures "28" from a query like "28일" matches "28" in a filename like "[2026.01.28]"
  const normalized = text.replace(/(\d+)(년|월|일|주|시간|시|분|초|개|명|번|회|차)/g, '$1 $2')
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
  return stems
}

// ── A. BM25 Index (upgraded from TF-IDF) ────────────────────────────────────

export interface TfIdfResult {
  docId: string
  filename: string
  speaker: string
  score: number
}

interface BM25Doc {
  docId: string
  filename: string
  speaker: string
  termFreqs: Map<string, number>  // Raw term frequencies
  docLen: number                   // Total tokens in document
  bm25Vec: Map<string, number>    // Normalized BM25 vector (for implicit link similarity)
  bm25Norm: number
}

export interface ImplicitLink {
  docAId: string
  docBId: string
  filenameA: string
  filenameB: string
  similarity: number
}

/** BM25 parameters */
const BM25_K1 = 1.5   // Term saturation coefficient — controls diminishing returns from frequency
const BM25_B  = 0.75  // Document length normalization coefficient

/** IndexedDB cache schema version — bump this to auto-invalidate cache on format change */
export const TFIDF_SCHEMA_VERSION = 4

export interface SerializedTfIdf {
  schemaVersion: typeof TFIDF_SCHEMA_VERSION
  fingerprint: string
  idf: [string, number][]
  avgdl: number
  docs: {
    docId: string
    filename: string
    speaker: string
    termFreqs: [string, number][]
    docLen: number
    bm25Vec: [string, number][]
    bm25Norm: number
  }[]
}

export class TfIdfIndex {
  private docs: BM25Doc[] = []
  private idf: Map<string, number> = new Map()
  private avgdl = 0
  private built = false
  private _implicitLinks: ImplicitLink[] | null = null
  private _implicitAdjRef: Map<string, string[]> | null = null

  get isBuilt() { return this.built }
  get docCount() { return this.docs.length }

  /** Inject pre-computed implicit links from a Worker (cache warmup) */
  setImplicitLinks(links: ImplicitLink[], adjacency: Map<string, string[]>): void {
    this._implicitLinks = links
    this._implicitAdjRef = adjacency
  }

  serialize(fingerprint: string): SerializedTfIdf {
    return {
      schemaVersion: TFIDF_SCHEMA_VERSION,
      fingerprint,
      idf: [...this.idf.entries()],
      avgdl: this.avgdl,
      docs: this.docs.map(d => ({
        docId: d.docId,
        filename: d.filename,
        speaker: d.speaker,
        termFreqs: [...d.termFreqs.entries()],
        docLen: d.docLen,
        bm25Vec: [...d.bm25Vec.entries()],
        bm25Norm: d.bm25Norm,
      })),
    }
  }

  restore(data: SerializedTfIdf): void {
    this.idf = new Map(data.idf)
    this.avgdl = data.avgdl
    this.docs = data.docs.map(d => ({
      docId: d.docId,
      filename: d.filename,
      speaker: d.speaker,
      termFreqs: new Map(d.termFreqs),
      docLen: d.docLen,
      bm25Vec: new Map(d.bm25Vec),
      bm25Norm: d.bm25Norm,
    }))
    this._implicitLinks = null
    this._implicitAdjRef = null
    this.built = true
    logger.debug(`[graphAnalysis] BM25 index restored from cache: ${this.docs.length} documents`)
  }

  build(loadedDocuments: LoadedDocument[]): void {
    this.docs = []
    this.idf = new Map()
    this.avgdl = 0
    this.built = false

    const rawTermFreqs = new Map<string, Map<string, number>>()
    const docLens = new Map<string, number>()
    const docFreq = new Map<string, number>()

    for (const doc of loadedDocuments) {
      const allText = [
        doc.filename.replace(/\.md$/i, ''),
        doc.tags?.join(' ') ?? '',
        doc.speaker ?? '',
        ...doc.sections.map(s => `${s.heading} ${s.body}`),
        doc.rawContent ?? '',
      ].join(' ')

      const tokens = tokenize(allText)
      const termFreq = new Map<string, number>()
      for (const token of tokens) {
        termFreq.set(token, (termFreq.get(token) ?? 0) + 1)
      }
      rawTermFreqs.set(doc.id, termFreq)
      docLens.set(doc.id, tokens.length)

      for (const term of termFreq.keys()) {
        docFreq.set(term, (docFreq.get(term) ?? 0) + 1)
      }
    }

    const N = loadedDocuments.length
    const totalLen = [...docLens.values()].reduce((a, b) => a + b, 0)
    this.avgdl = N > 0 ? totalLen / N : 1

    // BM25 IDF: log((N - df + 0.5) / (df + 0.5) + 1)
    for (const [term, df] of docFreq) {
      this.idf.set(term, Math.log((N - df + 0.5) / (df + 0.5) + 1))
    }

    // BM25 weight vector + L2 norm (for implicit link similarity)
    for (const doc of loadedDocuments) {
      const termFreq = rawTermFreqs.get(doc.id)!
      const docLen = docLens.get(doc.id)!
      const lenNorm = 1 - BM25_B + BM25_B * (docLen / this.avgdl)

      const bm25Vec = new Map<string, number>()
      let normSq = 0
      for (const [term, tf] of termFreq) {
        const idfVal = this.idf.get(term) ?? 0
        if (idfVal <= 0) continue
        const w = idfVal * (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * lenNorm)
        bm25Vec.set(term, w)
        normSq += w * w
      }

      this.docs.push({
        docId: doc.id,
        filename: doc.filename,
        speaker: doc.speaker ?? 'unknown',
        termFreqs: termFreq,
        docLen,
        bm25Vec,
        bm25Norm: Math.sqrt(normSq),
      })
    }

    this._implicitLinks = null
    this._implicitAdjRef = null
    this.built = true
    logger.debug(`[graphAnalysis] BM25 index built: ${this.docs.length} documents, avgdl=${this.avgdl.toFixed(1)}`)
  }

  /**
   * Single document incremental update — replaces one file without full rebuild.
   * IDF is reused from existing values (approximation). avgdl is recalculated.
   */
  updateDoc(doc: LoadedDocument): void {
    if (!this.built) return

    // Remove existing document
    const existingIdx = this.docs.findIndex(d => d.docId === doc.id)
    if (existingIdx !== -1) this.docs.splice(existingIdx, 1)

    // Tokenize new document
    const allText = [
      doc.filename.replace(/\.md$/i, ''),
      doc.tags?.join(' ') ?? '',
      doc.speaker ?? '',
      ...doc.sections.map(s => `${s.heading} ${s.body}`),
      doc.rawContent ?? '',
    ].join(' ')
    const tokens = tokenize(allText)
    const termFreq = new Map<string, number>()
    for (const t of tokens) termFreq.set(t, (termFreq.get(t) ?? 0) + 1)

    const docLen = tokens.length
    const totalLen = this.docs.reduce((a, d) => a + d.docLen, 0) + docLen
    this.avgdl = (this.docs.length + 1) > 0 ? totalLen / (this.docs.length + 1) : 1

    // BM25 vector computation (reuse existing IDF, approximate idf=1 for new terms)
    const lenNorm = 1 - BM25_B + BM25_B * (docLen / this.avgdl)
    const bm25Vec = new Map<string, number>()
    let normSq = 0
    for (const [term, tf] of termFreq) {
      const idfVal = this.idf.get(term) ?? 1
      const w = idfVal * (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * lenNorm)
      bm25Vec.set(term, w)
      normSq += w * w
    }

    this.docs.push({
      docId: doc.id,
      filename: doc.filename,
      speaker: doc.speaker ?? 'unknown',
      termFreqs: termFreq,
      docLen,
      bm25Vec,
      bm25Norm: Math.sqrt(normSq),
    })
    this._implicitLinks = null
  }

  search(query: string, topN: number = 8): TfIdfResult[] {
    if (!this.built || this.docs.length === 0) return []

    const queryTerms = tokenize(query)
    if (queryTerms.length === 0) return []

    // Deduplicate query terms
    const queryTermSet = new Set(queryTerms)

    const scored: { doc: BM25Doc; score: number }[] = []

    for (const doc of this.docs) {
      const lenNorm = 1 - BM25_B + BM25_B * (doc.docLen / this.avgdl)
      let score = 0

      for (const term of queryTermSet) {
        const idfVal = this.idf.get(term) ?? 0
        if (idfVal <= 0) continue
        const tf = doc.termFreqs.get(term) ?? 0
        if (tf === 0) continue
        score += idfVal * (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * lenNorm)
      }

      if (score > 0) scored.push({ doc, score })
    }

    scored.sort((a, b) => b.score - a.score)

    // Normalize to 0-1 based on highest score
    const maxScore = scored[0]?.score ?? 1
    return scored.slice(0, topN).map(s => ({
      docId: s.doc.docId,
      filename: s.doc.filename,
      speaker: s.doc.speaker,
      score: Math.min(1, s.score / maxScore),
    }))
  }

  /**
   * Returns semantically similar document pairs not connected by WikiLinks.
   * Pairs with BM25 weight vector cosine similarity >= threshold are included.
   *
   * Returns cached results when adjacency reference hasn't changed (O(N^2) computed once).
   */
  findImplicitLinks(
    adjacency: Map<string, string[]>,
    topN: number = 6,
    threshold: number = 0.25
  ): ImplicitLink[] {
    if (!this.built || this.docs.length < 2) return []

    if (this._implicitLinks && this._implicitAdjRef === adjacency) {
      return this._implicitLinks.slice(0, topN)
    }

    const docs = this.docs
    const n = docs.length

    const docIdxMap = new Map<string, number>()
    docs.forEach((d, idx) => docIdxMap.set(d.docId, idx))

    const existingLinks = new Set<number>()
    for (const [from, neighbors] of adjacency) {
      const fi = docIdxMap.get(from)
      if (fi === undefined) continue
      for (const to of neighbors) {
        const ti = docIdxMap.get(to)
        if (ti === undefined) continue
        existingLinks.add(fi < ti ? fi * n + ti : ti * n + fi)
      }
    }

    const pairs: ImplicitLink[] = []

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = docs[i], b = docs[j]
        if (a.bm25Norm === 0 || b.bm25Norm === 0) continue
        if (existingLinks.has(i * n + j)) continue

        // BM25 weight vector cosine similarity
        let dot = 0
        for (const [term, aW] of a.bm25Vec) {
          const bW = b.bm25Vec.get(term) ?? 0
          dot += aW * bW
        }
        const sim = dot / (a.bm25Norm * b.bm25Norm)
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
    logger.debug(`[graphAnalysis] Implicit links found: ${pairs.length} pairs (docs=${n}, threshold=${threshold})`)

    return pairs.slice(0, topN)
  }
}

/** BM25 index singleton — call build() after vault load */
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

/** Explicitly clear metrics cache when switching vaults. */
export function clearMetricsCache(): void {
  _metricsCache = null
  _metricsLinksRef = null
}

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
// Cluster topic cache — skip recomputation when clusters Map reference and topK match
let _cachedClusterTopicsResult: Map<number, string[]> | null = null
let _cachedClusterTopicsClusters: Map<string, number> | null = null
let _cachedClusterTopicsTopK = 0

export function getClusterTopics(
  clusters: Map<string, number>,
  docs: LoadedDocument[],
  topK: number = 3
): Map<number, string[]> {
  if (
    _cachedClusterTopicsResult !== null &&
    _cachedClusterTopicsClusters === clusters &&
    _cachedClusterTopicsTopK === topK
  ) {
    return _cachedClusterTopicsResult
  }
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

  _cachedClusterTopicsResult = result
  _cachedClusterTopicsClusters = clusters
  _cachedClusterTopicsTopK = topK
  return result
}

// ── G. Vault Insight Analysis ───────────────────────────────────────────────

export interface InsightResult {
  /** Hub documents referenced by many others */
  bridgeNodes: { docId: string; filename: string; inboundCount: number; outboundCount: number }[]
  /** Orphan documents with no inbound or outbound links */
  orphanDocs: { docId: string; filename: string }[]
  /** Topics referenced by multiple documents but with no actual file (need creation) */
  gapTopics: { topic: string; referenceCount: number }[]
  /** Connected component cluster summary */
  clusters: { size: number; representative: string; clusterIdx: number }[]
}

/**
 * Analyzes the entire vault to generate insights.
 * - Bridge nodes: hub documents with many references
 * - Orphan docs: documents with no links at all
 * - Gap topics: [[links]] referenced in multiple places but no corresponding file
 * - Clusters: connected component summary
 */
export function computeInsights(docs: LoadedDocument[]): InsightResult {
  if (docs.length === 0) return { bridgeNodes: [], orphanDocs: [], gapTopics: [], clusters: [] }

  const docIds = new Set(docs.map(d => d.id))
  // stem -> docId mapping (filename-based reverse lookup)
  const stemToId = new Map<string, string>()
  for (const doc of docs) {
    const stem = doc.filename.replace(/\.md$/i, '').toLowerCase()
    stemToId.set(stem, doc.id)
    stemToId.set(doc.id, doc.id)
  }

  const outbound = new Map<string, Set<string>>()
  const inbound  = new Map<string, number>()
  const phantom  = new Map<string, number>()

  for (const doc of docs) {
    outbound.set(doc.id, new Set())
    inbound.set(doc.id, 0)
  }

  for (const doc of docs) {
    const links = doc.sections.flatMap(s => s.wikiLinks ?? [])
    for (const raw of links) {
      const stem = raw.split('|')[0].trim().toLowerCase()
      const targetId = stemToId.get(stem)
      if (targetId && targetId !== doc.id && docIds.has(targetId)) {
        outbound.get(doc.id)!.add(targetId)
        inbound.set(targetId, (inbound.get(targetId) ?? 0) + 1)
      } else if (!targetId) {
        phantom.set(raw, (phantom.get(raw) ?? 0) + 1)
      }
    }
  }

  // Bridge nodes (high inbound)
  const bridgeNodes = docs
    .map(d => ({
      docId: d.id,
      filename: d.filename,
      inboundCount: inbound.get(d.id) ?? 0,
      outboundCount: outbound.get(d.id)?.size ?? 0,
    }))
    .filter(n => n.inboundCount >= 3)
    .sort((a, b) => b.inboundCount - a.inboundCount)
    .slice(0, 12)

  // Orphan docs (0 in + 0 out, not _index)
  const orphanDocs = docs
    .filter(d =>
      (inbound.get(d.id) ?? 0) === 0 &&
      (outbound.get(d.id)?.size ?? 0) === 0 &&
      !/_index|currentSituation/i.test(d.filename)
    )
    .map(d => ({ docId: d.id, filename: d.filename }))
    .slice(0, 20)

  // Gap topics (phantom links referenced >= 2 times)
  const gapTopics = [...phantom.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([topic, referenceCount]) => ({ topic, referenceCount }))

  // Clusters: BFS over bidirectional edges
  const edges = new Map<string, Set<string>>()
  for (const doc of docs) edges.set(doc.id, new Set())
  for (const [from, targets] of outbound) {
    for (const to of targets) {
      edges.get(from)!.add(to)
      if (edges.has(to)) edges.get(to)!.add(from)
    }
  }

  const visited = new Set<string>()
  const clusterList: { size: number; representative: string; clusterIdx: number }[] = []
  let clusterIdx = 0

  for (const doc of docs) {
    if (visited.has(doc.id)) continue
    const component: string[] = []
    const queue = [doc.id]
    let qi = 0
    while (qi < queue.length) {
      const cur = queue[qi++]
      if (visited.has(cur)) continue
      visited.add(cur)
      component.push(cur)
      for (const nb of (edges.get(cur) ?? [])) {
        if (!visited.has(nb)) queue.push(nb)
      }
    }
    if (component.length >= 2) {
      clusterList.push({
        size: component.length,
        representative: docs.find(d => d.id === component[0])?.filename ?? component[0],
        clusterIdx: clusterIdx++,
      })
    }
  }

  clusterList.sort((a, b) => b.size - a.size)

  return { bridgeNodes, orphanDocs, gapTopics, clusters: clusterList.slice(0, 5) }
}
