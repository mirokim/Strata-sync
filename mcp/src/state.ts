/**
 * In-memory state for MCP server — loaded documents, graph, BM25 index.
 */
import type { LoadedDocument } from './parser.js'
import { loadVaultDocuments } from './vault.js'
import { getConfig, getApiKey, getConfigPath } from './config.js'
import { expandTerms } from './synonyms.js'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { createHash } from 'crypto'
import { resolve, dirname } from 'path'

// ── State ────────────────────────────────────────────────────────────────────

let _documents: LoadedDocument[] = []
let _graphBuilt = false

export interface GraphNode {
  id: string
  docId: string
  speaker: string
  label: string
  folderPath?: string
  tags?: string[]
}

export interface GraphLink {
  source: string
  target: string
  strength?: number
}

let _nodes: GraphNode[] = []
let _links: GraphLink[] = []

// ── BM25 lightweight index ───────────────────────────────────────────────────

const KO_SUFFIXES = [
  '이라는', '이라고', '에서는', '에게서', '한테서', '으로서', '으로써', '으로는',
  '에서의', '으로의', '에서도', '으로도',
  '이라', '에서', '에게', '한테', '까지', '부터', '처럼', '같은', '같이',
  '만큼', '으로', '이랑', '라는', '라고', '이란', '에는', '하고',
  '은', '는', '이', '가', '을', '를', '와', '과', '에', '도', '만', '의', '로',
]

function stemKorean(token: string): string[] {
  const results = [token]
  for (const suffix of KO_SUFFIXES) {
    if (token.endsWith(suffix) && token.length > suffix.length + 1) {
      results.push(token.slice(0, -suffix.length))
      break
    }
  }
  return results
}

export function tokenize(text: string): string[] {
  const normalized = text.replace(/(\d+)(년|월|일|주|시간|시|분|초|개|명|번|회|차)/g, '$1 $2')
  const raw = normalized.toLowerCase().split(/[\s,.\-_?!;:()[\]{}'"《》「」【】]+/).filter(t => t.length > 1)
  const stems: string[] = []
  for (const token of raw) for (const stem of stemKorean(token)) stems.push(stem)
  return stems
}

interface BM25Doc {
  docId: string
  filename: string
  speaker: string
  termFreqs: Map<string, number>
  docLen: number
}

const BM25_K1 = 1.5
const BM25_B = 0.3
let _bm25Docs: BM25Doc[] = []
let _idf: Map<string, number> = new Map()
let _avgdl = 0

function buildBM25() {
  _bm25Docs = []
  _idf = new Map()
  const docFreq = new Map<string, number>()
  const allDocLens: number[] = []

  for (const doc of _documents) {
    const text = [doc.filename.replace(/\.md$/i, ''), doc.tags?.join(' ') ?? '', doc.speaker ?? '',
      ...doc.sections.map(s => `${s.heading} ${s.body}`), doc.rawContent ?? ''].join(' ')
    const tokens = tokenize(text)
    const termFreq = new Map<string, number>()
    for (const t of tokens) termFreq.set(t, (termFreq.get(t) ?? 0) + 1)
    _bm25Docs.push({ docId: doc.id, filename: doc.filename, speaker: doc.speaker, termFreqs: termFreq, docLen: tokens.length })
    allDocLens.push(tokens.length)
    for (const term of termFreq.keys()) docFreq.set(term, (docFreq.get(term) ?? 0) + 1)
  }

  const N = _bm25Docs.length
  _avgdl = N > 0 ? allDocLens.reduce((a, b) => a + b, 0) / N : 1
  for (const [term, df] of docFreq) {
    _idf.set(term, Math.log((N - df + 0.5) / (df + 0.5) + 1))
  }
}

export interface SearchResult {
  docId: string
  filename: string
  speaker: string
  score: number
}

export function bm25Search(query: string, topK = 10): SearchResult[] {
  const queryTokens = expandTerms(tokenize(query))
  if (queryTokens.length === 0) return []

  const scores: { docId: string; filename: string; speaker: string; score: number }[] = []
  const filenameBoost = 2.0
  for (const doc of _bm25Docs) {
    let score = 0
    const lenNorm = 1 - BM25_B + BM25_B * (doc.docLen / _avgdl)
    const filenameTokens = new Set(tokenize(doc.filename))
    for (const qt of queryTokens) {
      const tf = doc.termFreqs.get(qt) ?? 0
      if (tf === 0) continue
      const idfVal = _idf.get(qt) ?? 0
      score += idfVal * (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * lenNorm)
      if (filenameTokens.has(qt)) score += filenameBoost
    }
    if (score > 0) scores.push({ docId: doc.docId, filename: doc.filename, speaker: doc.speaker, score })
  }

  return scores.sort((a, b) => b.score - a.score).slice(0, topK)
}

// ── Vector embedding index ───────────────────────────────────────────────────

interface VectorDoc {
  docId: string
  filename: string
  speaker: string
  embedding: number[]
  fingerprint: string
}

let _vectorDocs: Map<string, VectorDoc> = new Map()

function getVectorCachePath(): string {
  return resolve(dirname(getConfigPath()), 'vector_cache.json')
}

function fingerprint(text: string): string {
  return createHash('md5').update(text).digest('hex')
}

function loadVectorCache(): void {
  const cachePath = getVectorCachePath()
  if (!existsSync(cachePath)) return
  try {
    const data = JSON.parse(readFileSync(cachePath, 'utf-8')) as VectorDoc[]
    _vectorDocs = new Map(data.map(d => [d.docId, d]))
  } catch { _vectorDocs = new Map() }
}

function saveVectorCache(): void {
  writeFileSync(getVectorCachePath(), JSON.stringify([..._vectorDocs.values()], null, 2), 'utf-8')
}

async function embedText(text: string, apiKey: string): Promise<number[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      model: 'models/gemini-embedding-001',
      content: { parts: [{ text: text.slice(0, 8000) }] },
    }),
  })
  if (!res.ok) throw new Error(`Gemini embeddings ${res.status}: ${res.statusText}`)
  const json = await res.json() as { embedding: { values: number[] } }
  return json.embedding.values
}

function cosineSim(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom === 0 ? 0 : dot / denom
}

function docFullText(doc: LoadedDocument): string {
  return [doc.filename.replace(/\.md$/i, ''), doc.tags?.join(' ') ?? '', doc.speaker ?? '',
    ...doc.sections.map(s => `${s.heading} ${s.body}`), doc.rawContent ?? ''].join(' ')
}

/** Build or incrementally update vector embedding index. */
export async function buildVectorIndex(): Promise<{ embedded: number; skipped: number; error?: string }> {
  const apiKey = getApiKey('gemini')
  if (!apiKey) return { embedded: 0, skipped: 0, error: 'OpenAI API key not configured' }

  loadVectorCache()
  let embedded = 0, skipped = 0

  for (const doc of _documents) {
    const text = docFullText(doc)
    const fp = fingerprint(text)
    if (_vectorDocs.get(doc.id)?.fingerprint === fp) { skipped++; continue }

    try {
      const embedding = await embedText(text, apiKey)
      _vectorDocs.set(doc.id, { docId: doc.id, filename: doc.filename, speaker: doc.speaker, embedding, fingerprint: fp })
      embedded++
      if (embedded % 20 === 0) await new Promise(r => setTimeout(r, 300)) // light rate-limit
    } catch (e) {
      console.error(`vector embed failed: ${doc.filename}`, e)
    }
  }

  if (embedded > 0) saveVectorCache()
  return { embedded, skipped }
}

/** Hybrid search: BM25 candidates → vector reranking. Falls back to BM25 if no vector index. */
export async function hybridSearch(query: string, topK = 10): Promise<SearchResult[]> {
  const bm25 = bm25Search(query, 50)
  if (bm25.length === 0) return []
  if (_vectorDocs.size === 0) return bm25.slice(0, topK)

  const apiKey = getApiKey('gemini')
  if (!apiKey) return bm25.slice(0, topK)

  let queryVec: number[]
  try { queryVec = await embedText(query, apiKey) }
  catch { return bm25.slice(0, topK) }

  const maxBm25 = bm25[0].score || 1
  return bm25
    .map(r => {
      const vdoc = _vectorDocs.get(r.docId)
      const vecSim = vdoc ? cosineSim(queryVec, vdoc.embedding) : 0
      return { ...r, score: (r.score / maxBm25) * 0.4 + vecSim * 0.6 }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}

export function getVectorIndexStats(): { indexed: number; total: number } {
  return { indexed: _vectorDocs.size, total: _documents.length }
}

// ── Graph builder ────────────────────────────────────────────────────────────

function buildGraph() {
  _nodes = []
  _links = []
  const nodeMap = new Map<string, GraphNode>()

  for (const doc of _documents) {
    const node: GraphNode = {
      id: doc.id, docId: doc.id, speaker: doc.speaker,
      label: doc.filename.replace(/\.md$/i, ''), folderPath: doc.folderPath, tags: doc.tags,
    }
    _nodes.push(node)
    nodeMap.set(doc.id, node)
  }

  // Build links from wikilinks
  const filenameToId = new Map<string, string>()
  for (const doc of _documents) {
    filenameToId.set(doc.filename.replace(/\.md$/i, '').toLowerCase(), doc.id)
  }

  const linkSet = new Set<string>()
  for (const doc of _documents) {
    const allLinks = [...doc.links, ...doc.sections.flatMap(s => s.wikiLinks)]
    for (const link of allLinks) {
      const targetId = filenameToId.get(link.toLowerCase())
      if (!targetId || targetId === doc.id) continue
      const key = [doc.id, targetId].sort().join('::')
      if (linkSet.has(key)) continue
      linkSet.add(key)
      _links.push({ source: doc.id, target: targetId })
    }
  }

  _graphBuilt = true
}

// ── Public API ───────────────────────────────────────────────────────────────

export function getDocuments(): LoadedDocument[] { return _documents }
export function getNodes(): GraphNode[] { return _nodes }
export function getLinks(): GraphLink[] { return _links }
export function isGraphBuilt(): boolean { return _graphBuilt }

export async function reloadVault(vaultPath?: string): Promise<{ docCount: number; nodeCount: number; linkCount: number }> {
  _documents = await loadVaultDocuments(vaultPath)
  buildGraph()
  buildBM25()
  loadVectorCache()
  return { docCount: _documents.length, nodeCount: _nodes.length, linkCount: _links.length }
}

/** PageRank computation */
export function computePageRank(topK = 20): { docId: string; filename: string; score: number }[] {
  const adj = new Map<string, string[]>()
  for (const link of _links) {
    const s = typeof link.source === 'string' ? link.source : link.source
    const t = typeof link.target === 'string' ? link.target : link.target
    if (!adj.has(s)) adj.set(s, [])
    if (!adj.has(t)) adj.set(t, [])
    adj.get(s)!.push(t)
    adj.get(t)!.push(s)
  }

  const N = _nodes.length
  if (N === 0) return []
  const d = 0.85
  let scores = new Map<string, number>()
  for (const node of _nodes) scores.set(node.id, 1 / N)

  for (let iter = 0; iter < 30; iter++) {
    const newScores = new Map<string, number>()
    for (const node of _nodes) {
      let sum = 0
      const neighbors = adj.get(node.id) ?? []
      for (const nb of neighbors) {
        const nbDeg = (adj.get(nb) ?? []).length
        if (nbDeg > 0) sum += (scores.get(nb) ?? 0) / nbDeg
      }
      newScores.set(node.id, (1 - d) / N + d * sum)
    }
    scores = newScores
  }

  const idToFilename = new Map(_documents.map(d => [d.id, d.filename]))
  return [...scores.entries()]
    .map(([id, score]) => ({ docId: id, filename: idToFilename.get(id) ?? id, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}

/** Cluster detection (Union-Find) */
export function detectClusters(): { clusterId: number; docIds: string[]; topTerms: string[] }[] {
  const parent = new Map<string, string>()
  function find(x: string): string {
    if (!parent.has(x)) parent.set(x, x)
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!))
    return parent.get(x)!
  }
  function union(a: string, b: string) { parent.set(find(a), find(b)) }

  for (const node of _nodes) find(node.id)
  for (const link of _links) union(link.source, link.target)

  const clusters = new Map<string, string[]>()
  for (const node of _nodes) {
    const root = find(node.id)
    if (!clusters.has(root)) clusters.set(root, [])
    clusters.get(root)!.push(node.id)
  }

  return [...clusters.values()]
    .filter(ids => ids.length >= 2)
    .sort((a, b) => b.length - a.length)
    .map((docIds, i) => ({ clusterId: i, docIds, topTerms: [] }))
}

/** Find bridge nodes (nodes connecting multiple clusters) */
export function findBridgeNodes(topK = 10): { docId: string; filename: string; clusterCount: number }[] {
  const clusterOf = new Map<string, number>()
  const clusters = detectClusters()
  clusters.forEach((c, i) => c.docIds.forEach(id => clusterOf.set(id, i)))

  const bridges: { docId: string; filename: string; clusterCount: number }[] = []
  const adj = new Map<string, Set<string>>()
  for (const link of _links) {
    if (!adj.has(link.source)) adj.set(link.source, new Set())
    if (!adj.has(link.target)) adj.set(link.target, new Set())
    adj.get(link.source)!.add(link.target)
    adj.get(link.target)!.add(link.source)
  }

  const idToFilename = new Map(_documents.map(d => [d.id, d.filename]))
  for (const [nodeId, neighbors] of adj) {
    const neighborClusters = new Set<number>()
    for (const nb of neighbors) {
      const c = clusterOf.get(nb)
      if (c !== undefined) neighborClusters.add(c)
    }
    if (neighborClusters.size >= 2) {
      bridges.push({ docId: nodeId, filename: idToFilename.get(nodeId) ?? nodeId, clusterCount: neighborClusters.size })
    }
  }

  return bridges.sort((a, b) => b.clusterCount - a.clusterCount).slice(0, topK)
}

/** Find implicit links via BM25 cosine similarity */
export function findImplicitLinks(minScore = 0.15, topK = 30): { docA: string; docB: string; similarity: number }[] {
  const results: { docA: string; docB: string; similarity: number }[] = []
  const existingLinks = new Set<string>()
  for (const l of _links) existingLinks.add([l.source, l.target].sort().join('::'))

  // Build BM25 vectors
  const vectors = new Map<string, Map<string, number>>()
  const norms = new Map<string, number>()
  for (const doc of _bm25Docs) {
    const vec = new Map<string, number>()
    const lenNorm = 1 - BM25_B + BM25_B * (doc.docLen / _avgdl)
    let normSq = 0
    for (const [term, tf] of doc.termFreqs) {
      const idfVal = _idf.get(term) ?? 0
      if (idfVal <= 0) continue
      const w = idfVal * (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * lenNorm)
      vec.set(term, w)
      normSq += w * w
    }
    vectors.set(doc.docId, vec)
    norms.set(doc.docId, Math.sqrt(normSq))
  }

  for (let i = 0; i < _bm25Docs.length; i++) {
    for (let j = i + 1; j < _bm25Docs.length; j++) {
      const a = _bm25Docs[i], b = _bm25Docs[j]
      const key = [a.docId, b.docId].sort().join('::')
      if (existingLinks.has(key)) continue

      const vecA = vectors.get(a.docId)!, vecB = vectors.get(b.docId)!
      const normA = norms.get(a.docId)!, normB = norms.get(b.docId)!
      if (normA === 0 || normB === 0) continue

      let dot = 0
      for (const [term, wA] of vecA) {
        const wB = vecB.get(term)
        if (wB) dot += wA * wB
      }
      const sim = dot / (normA * normB)
      if (sim >= minScore) results.push({ docA: a.docId, docB: b.docId, similarity: sim })
    }
  }

  return results.sort((a, b) => b.similarity - a.similarity).slice(0, topK)
}
