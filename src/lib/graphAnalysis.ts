/**
 * graphAnalysis.ts
 *
 * Provides six analysis tools:
 *   A. TfIdfIndex      — Cosine similarity-based document search + implicit link discovery
 *   B. computePageRank — Connection importance-based document ranking (hub detection)
 *   C. detectClusters  — Union-Find connected components (topic cluster detection)
 *   D. detectBridgeNodes — Bridge node detection connecting multiple clusters
 *   E. getClusterTopics  — Top TF-IDF keyword extraction per cluster
 *   F. findImplicitLinks — Hidden semantic connections without WikiLinks
 */

import type { LoadedDocument } from '@/types'
import { logger } from '@/lib/logger'
import { expandTerms } from '@/lib/synonyms'

// ── Shared tokenizer ──────────────────────────────────────────────────────────

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
  // This ensures "28" from query "28일" matches "28" in filename "[2026.01.28]"
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

// ── A. BM25 Index (TF-IDF → BM25 transition) ────────────────────────────────

export interface TfIdfResult {
  docId: string
  filename: string
  speaker: string
  score: number
}

/**
 * Extract content creation date from filename (ms since epoch).
 * Patterns: [2023_05_02], 20250723, _250328, _260106 etc.
 * Returns 0 on match failure.
 */
export function parseFilenameDate(filename: string): number {
  const now = Date.now() + 30 * 86_400_000  // 30-day margin (allow future-dated documents)
  // Boundary: word boundary or non-digit (parentheses, underscores, spaces, hyphens, etc.)
  const B = '(?:^|[^\\d])'   // leading boundary
  const A = '(?:[^\\d]|$)'   // trailing boundary

  // YYYY_MM_DD or YYYY-MM-DD (underscore/hyphen separated, with or without brackets)
  let m = filename.match(new RegExp(`${B}(20[0-3]\\d)[_\\-](0[1-9]|1[0-2])[_\\-](0[1-9]|[12]\\d|3[01])${A}`))
  if (m) {
    const ms = Date.parse(`${m[1]}-${m[2]}-${m[3]}`)
    if (!isNaN(ms) && ms <= now) return ms
  }

  // YYYYMMDD (8 consecutive digits) — year range 2000~2039
  m = filename.match(new RegExp(`${B}(20[0-3]\\d)(0[1-9]|1[0-2])(0[1-9]|[12]\\d|3[01])${A}`))
  if (m) {
    const ms = Date.parse(`${m[1]}-${m[2]}-${m[3]}`)
    if (!isNaN(ms) && ms <= now) return ms
  }

  // YY_MM_DD (underscore/hyphen separated, e.g., 25_03_28)
  m = filename.match(new RegExp(`${B}(\\d{2})[_\\-](0[1-9]|1[0-2])[_\\-](0[1-9]|[12]\\d|3[01])${A}`))
  if (m) {
    const yy = parseInt(m[1], 10)
    const yyyy = yy >= 50 ? 1900 + yy : 2000 + yy
    const ms = Date.parse(`${yyyy}-${m[2]}-${m[3]}`)
    if (!isNaN(ms) && ms <= now) return ms
  }

  // YYMMDD (6 digits, e.g., 260106)
  m = filename.match(new RegExp(`${B}(\\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\\d|3[01])${A}`))
  if (m) {
    const yy = parseInt(m[1], 10)
    const yyyy = yy >= 50 ? 1900 + yy : 2000 + yy
    const ms = Date.parse(`${yyyy}-${m[2]}-${m[3]}`)
    if (!isNaN(ms) && ms <= now) return ms
  }

  return 0
}

/** Extract document content creation date (filename > frontmatter > mtime > 0) */
export function getContentDate(doc: LoadedDocument): number {
  const fromFilename = parseFilenameDate(doc.filename)
  if (fromFilename > 0) return fromFilename
  if (doc.date) {
    const ms = Date.parse(doc.date)
    if (!isNaN(ms)) return ms
  }
  if (doc.mtime) return doc.mtime
  return 0
}

interface BM25Doc {
  docId: string
  filename: string
  speaker: string
  termFreqs: Map<string, number>  // raw term frequency
  docLen: number                   // total document token count
  contentDate: number              // content creation date (ms), 0 = unknown
  bm25Vec: Map<string, number>    // normalized BM25 vector (for implicit link similarity)
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
const BM25_K1 = 1.5   // term saturation coefficient — controls diminishing returns of frequency
const BM25_B  = 0.75  // document length normalization coefficient

/** IndexedDB cache schema version — bump this value to auto-invalidate cache on format change */
export const TFIDF_SCHEMA_VERSION = 7

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
    contentDate: number
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

  /** Inject pre-computed implicit links from Worker (cache warmup) */
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
        contentDate: d.contentDate,
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
      contentDate: d.contentDate ?? 0,
      bm25Vec: new Map(d.bm25Vec),
      bm25Norm: d.bm25Norm,
    }))
    this._implicitLinks = null
    this._implicitAdjRef = null
    this.built = true
    logger.debug(`[graphAnalysis] BM25 index cache restored: ${this.docs.length} docs`)
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
      if ((doc as any).graphWeight === 'skip') continue   // skip docs excluded from BM25 index
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

    const N = docLens.size  // based on skip-filtered document count
    const totalLen = [...docLens.values()].reduce((a, b) => a + b, 0)
    this.avgdl = N > 0 ? totalLen / N : 1

    // BM25 IDF: log((N - df + 0.5) / (df + 0.5) + 1)
    for (const [term, df] of docFreq) {
      this.idf.set(term, Math.log((N - df + 0.5) / (df + 0.5) + 1))
    }

    // BM25 weight vectors + L2 norm (for implicit link similarity)
    for (const doc of loadedDocuments) {
      if ((doc as any).graphWeight === 'skip') continue   // skip 문서는 벡터도 제외
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
        contentDate: getContentDate(doc),
        bm25Vec,
        bm25Norm: Math.sqrt(normSq),
      })
    }

    this._implicitLinks = null
    this._implicitAdjRef = null
    this.built = true
    logger.debug(`[graphAnalysis] BM25 index build complete: ${this.docs.length} docs, avgdl=${this.avgdl.toFixed(1)}`)
  }

  /**
   * 단일 문서 증분 업데이트 — 전체 재빌드 없이 한 파일만 교체.
   * IDF는 전체 재계산 없이 기존 값 유지 (근사치). avgdl은 재계산.
   */
  updateDoc(doc: LoadedDocument): void {
    if (!this.built) return

    // 기존 문서 제거
    const existingIdx = this.docs.findIndex(d => d.docId === doc.id)
    if (existingIdx !== -1) this.docs.splice(existingIdx, 1)

    // 새 문서 토큰화
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

    // BM25 벡터 계산 (기존 IDF 재사용, 신규 용어는 idf=1 근사)
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
      contentDate: getContentDate(doc),
      bm25Vec,
      bm25Norm: Math.sqrt(normSq),
    })
    this._implicitLinks = null
  }

  search(query: string, topN: number = 8): TfIdfResult[] {
    if (!this.built || this.docs.length === 0) return []

    const queryTerms = expandTerms(tokenize(query))
    if (queryTerms.length === 0) return []

    // 중복 쿼리 용어 집계
    const queryTermSet = new Set(queryTerms)

    const scored: { doc: BM25Doc; score: number }[] = []
    const queryTermCount = queryTermSet.size
    const now = Date.now()

    for (const doc of this.docs) {
      const lenNorm = 1 - BM25_B + BM25_B * (doc.docLen / this.avgdl)
      let rawScore = 0
      let matchedTerms = 0

      for (const term of queryTermSet) {
        const idfVal = this.idf.get(term) ?? 0
        if (idfVal <= 0) continue
        const tf = doc.termFreqs.get(term) ?? 0
        if (tf === 0) continue
        rawScore += idfVal * (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * lenNorm)
        matchedTerms++
      }

      if (rawScore <= 0) continue

      // 쿼리 용어 커버리지 보정: 쿼리 단어 3개 중 1개만 매칭된 문서는 감점
      // coverage = matchedTerms / queryTermCount (0~1)
      // 단일 단어 쿼리는 보정 없음 (coverage=1)
      const coverage = queryTermCount > 1
        ? matchedTerms / queryTermCount
        : 1
      // 커버리지 부스트: coverage^0.5 → 부드러운 감점 (1/3 매칭 = 0.58배, 2/3 = 0.82배, 3/3 = 1.0배)
      let score = rawScore * Math.pow(coverage, 0.5)

      // Recency boost: 최근 문서 가산 — 6개월 이내 ~10%, 1년 지나면 거의 0
      if (doc.contentDate > 0) {
        const daysOld = (now - doc.contentDate) / 86_400_000
        score *= 1 + 0.1 * Math.exp(-daysOld / 180)
      }

      scored.push({ doc, score })
    }

    scored.sort((a, b) => b.score - a.score)

    // 최고 점수 기준 0~1 정규화
    const maxScore = scored[0]?.score ?? 1
    return scored.slice(0, topN).map(s => ({
      docId: s.doc.docId,
      filename: s.doc.filename,
      speaker: s.doc.speaker,
      score: Math.min(1, s.score / maxScore),
    }))
  }

  /**
   * WikiLink로 연결되지 않은 문서 중 의미적으로 유사한 쌍을 반환합니다.
   * BM25 가중치 벡터의 코사인 유사도가 threshold 이상인 쌍이 대상입니다.
   *
   * adjacency 참조가 바뀌지 않으면 캐시된 결과를 반환합니다 (O(N²) 연산 1회).
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

        // BM25 가중치 벡터 코사인 유사도
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
    logger.debug(`[graphAnalysis] ${pairs.length} implicit link pairs found (docs=${n}, threshold=${threshold})`)

    return pairs.slice(0, topN)
  }
}

/** BM25 인덱스 싱글톤 — 볼트 로드 시 build() 호출 필요 */
export const tfidfIndex = new TfIdfIndex()

// ── B. PageRank ───────────────────────────────────────────────────────────────

/**
 * 문서 그래프에서 PageRank를 계산합니다.
 * 많은 문서로부터 참조될수록 높은 순위를 받습니다.
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

  // 역방향 엣지 (in-edges) 사전 계산 — O(N+M) 순회를 위해
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
    // 아웃링크 없는 노드의 랭크 합 (dangling nodes)
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

  // 0..1 정규화
  const max = Math.max(1e-10, ...rank.values())
  for (const [id, r] of rank) rank.set(id, r / max)

  return rank
}

// ── C. 클러스터 감지 (Union-Find) ─────────────────────────────────────────────

/**
 * Union-Find로 연결 컴포넌트(클러스터)를 감지합니다.
 * 같은 WikiLink 네트워크로 연결된 문서들은 같은 클러스터 번호를 받습니다.
 *
 * @returns Map<docId, clusterId> — clusterId 0이 가장 큰 클러스터
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

  // 루트별 그룹화
  const groups = new Map<string, string[]>()
  for (const id of adjacency.keys()) {
    const root = find(id)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root)!.push(id)
  }

  // 클러스터 크기 내림차순 정렬 (0 = 가장 큰 클러스터)
  const sorted = [...groups.values()].sort((a, b) => b.length - a.length)
  const clusterMap = new Map<string, number>()
  sorted.forEach((members, idx) => {
    for (const id of members) clusterMap.set(id, idx)
  })

  return clusterMap
}

// ── 그래프 메트릭 캐시 ────────────────────────────────────────────────────────

export interface GraphMetrics {
  pageRank: Map<string, number>
  clusters: Map<string, number>
  clusterCount: number
}

let _metricsCache: GraphMetrics | null = null
let _metricsLinksRef: unknown = null

/** 볼트 교체 시 캐시를 명시적으로 초기화합니다. */
export function clearMetricsCache(): void {
  _metricsCache = null
  _metricsLinksRef = null
}

/**
 * PageRank + 클러스터를 한 번 계산하고 캐시합니다.
 * links 배열 참조가 바뀌면 자동으로 재계산됩니다.
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

// ── D. 브릿지 노드 탐지 ───────────────────────────────────────────────────────

export interface BridgeNode {
  docId: string
  /** 이 노드가 연결하는 서로 다른 클러스터 수 (자신의 클러스터 포함) */
  clusterCount: number
}

/**
 * 여러 클러스터에 걸쳐 이웃을 가진 브릿지 노드를 탐지합니다.
 *
 * 브릿지 노드 = 자신과 다른 클러스터에 속한 이웃을 1개 이상 가진 노드.
 * 이런 노드는 주제 영역들을 연결하는 아키텍처 핵심 문서입니다.
 *
 * @returns clusterCount 내림차순으로 정렬된 배열
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

// ── E. 클러스터 주제 키워드 ──────────────────────────────────────────────────

/**
 * 각 클러스터의 TF-IDF 상위 키워드를 추출합니다.
 *
 * 클러스터 내 모든 문서의 텍스트를 합산하여 가장 고빈도 토큰을 반환합니다.
 * 구조 헤더에 "클러스터 1 [전투/스킬/밸런스]" 형태로 활용됩니다.
 *
 * @param clusters  Map<docId, clusterId>
 * @param docs      볼트 문서 배열
 * @param topK      클러스터당 반환할 키워드 수
 * @returns Map<clusterId, topKeywords[]>
 */
// 클러스터 토픽 캐시 — clusters Map 참조와 topK가 동일하면 재계산 생략
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

// ── F. 볼트 인사이트 종합 분석 ───────────────────────────────────────────────

export interface InsightResult {
  /** 많은 문서에서 참조되는 허브 문서들 */
  bridgeNodes: { docId: string; filename: string; inboundCount: number; outboundCount: number }[]
  /** 인바운드/아웃바운드 링크가 모두 없는 고립 문서 */
  orphanDocs: { docId: string; filename: string }[]
  /** 여러 문서에서 참조되지만 실제 파일이 없는 주제 (작성 필요) */
  gapTopics: { topic: string; referenceCount: number }[]
  /** 연결 컴포넌트 클러스터 요약 */
  clusters: { size: number; representative: string; clusterIdx: number }[]
}

/**
 * 볼트 전체를 분석하여 인사이트를 생성합니다.
 * - 브리지 노드: 많이 참조되는 허브 문서
 * - 고립 문서: 링크가 전혀 없는 문서
 * - 빈틈 주제: 여러 곳에서 참조되지만 파일이 없는 [[링크]]
 * - 클러스터: 연결 컴포넌트 요약
 */
export function computeInsights(docs: LoadedDocument[]): InsightResult {
  if (docs.length === 0) return { bridgeNodes: [], orphanDocs: [], gapTopics: [], clusters: [] }

  const docIds = new Set(docs.map(d => d.id))
  // stem → docId 매핑 (파일명 기반 역조회)
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

  // Gap topics (phantom links referenced ≥2 times)
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
