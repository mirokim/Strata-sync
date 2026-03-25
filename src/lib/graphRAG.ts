/**
 * graphRAG.ts — Graph-Augmented RAG
 *
 * Enhances ChromaDB search results using wiki-link graph relationships:
 *  1. Graph expansion: include content from neighbor sections
 *  2. Keyword reranking with speaker affinity: reorder candidates by term overlap
 *  3. Compressed formatting: token-efficient context for LLM
 *  4. TF-IDF vector search: cosine similarity seeding (graphAnalysis.ts)
 *  5. Graph metrics: PageRank + cluster info in context header
 *  6. Passage-level retrieval: query-aware section selection (B)
 *  7. Implicit link discovery: hidden semantic connections (A)
 *  8. Cluster topic labels: TF-IDF keywords per cluster (C)
 *  9. Bridge node detection: cross-cluster connector docs (D)
 */

import type { SearchResult, GraphLink, LoadedDocument, DocSection } from '@/types'
import { useGraphStore } from '@/stores/graphStore'
import { useVaultStore } from '@/stores/vaultStore'
import { logger } from '@/lib/logger'
import {
  tfidfIndex,
  getGraphMetrics,
  tokenize as _tokenize,
  detectBridgeNodes,
  getClusterTopics,
} from '@/lib/graphAnalysis'
import { runPPRInWorker } from '@/lib/pprWorkerClient'

// ── Persona tag affinity map ──────────────────────────────────────────────────

/**
 * Maps each built-in director persona to its affinity tag.
 * Documents tagged with this value are boosted during retrieval.
 * Tags are matched case-insensitively.
 */
export const PERSONA_TAG_MAP: Record<string, string> = {
  chief_director: 'chief',
  art_director: 'art',
  plan_director: 'design',
  level_director: 'level',
  prog_director: 'tech',
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface NeighborContext {
  sectionId: string
  heading: string
  content: string
  linkedFrom: string
  filename: string
}

/**
 * Tokenize a Korean/English query string into search stems.
 * Delegates to graphAnalysis.tokenize — includes Korean particle stripping.
 * Exported so llmClient.ts can pass query terms to context builders.
 */
export function tokenizeQuery(text: string): string[] {
  return _tokenize(text)
}

// ── Recency helpers ──────────────────────────────────────────────────────────

/**
 * Returns a comparable recency value (ms since epoch) for a document.
 * Priority: filesystem mtime > frontmatter date string > 0 (unknown).
 */
function getDocRecency(doc: LoadedDocument): number {
  if (doc.mtime) return doc.mtime
  if (doc.date) {
    const ms = Date.parse(doc.date)
    if (!isNaN(ms)) return ms
  }
  return 0
}

/**
 * Returns a short date label (YYYY-MM-DD) for context headers.
 * Empty string when date is unavailable.
 */
function getDocDateLabel(doc: LoadedDocument): string {
  if (doc.date) return doc.date.slice(0, 10)
  if (doc.mtime) return new Date(doc.mtime).toISOString().slice(0, 10)
  return ''
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Build an undirected adjacency map from graph links.
 * Handles both string IDs and resolved GraphNode objects (d3-force mutates these).
 * Exported for use in useVaultLoader (implicit link pre-computation).
 */
export function buildAdjacencyMap(links: GraphLink[]): Map<string, string[]> {
  const adj = new Map<string, string[]>()

  for (const link of links) {
    const source = typeof link.source === 'string' ? link.source : link.source.id
    const target = typeof link.target === 'string' ? link.target : link.target.id

    if (!adj.has(source)) adj.set(source, [])
    if (!adj.has(target)) adj.set(target, [])
    adj.get(source)!.push(target)
    adj.get(target)!.push(source)
  }

  return adj
}

/** Build a lookup map: section_id → { section, filename, docId } */
function buildSectionMap(
  docs: LoadedDocument[]
): Map<string, { section: DocSection; filename: string; docId: string }> {
  const map = new Map<string, { section: DocSection; filename: string; docId: string }>()
  for (const doc of docs) {
    for (const section of doc.sections) {
      map.set(section.id, { section, filename: doc.filename, docId: doc.id })
    }
  }
  return map
}

// ── 0. Frontend search (TF-IDF first, keyword fallback) ─────────────────────

/**
 * Search vault documents.
 *
 * Pipeline:
 *   1. TF-IDF cosine similarity search (when tfidfIndex is built)
 *      — finds semantically close documents, resolving title-mismatch issues
 *   2. Falls back to keyword-based search when no TF-IDF results
 *
 * @param query  User query
 * @param topN   Maximum number of results to return
 */
export function frontendKeywordSearch(
  query: string,
  topN: number = 8,
  currentSpeaker?: string
): SearchResult[] {
  const { loadedDocuments } = useVaultStore.getState()
  if (!loadedDocuments || loadedDocuments.length === 0) return []

  // O(1) lookup map — reuse cached version if available, else build once
  const { links } = useGraphStore.getState()
  const docMap = links.length > 0
    ? getCachedMaps(links, loadedDocuments).docMap
    : new Map(loadedDocuments.map(d => [d.id, d]))

  const personaTag = currentSpeaker ? PERSONA_TAG_MAP[currentSpeaker] : undefined
  const TAG_BOOST = 0.1

  // ── TF-IDF first ─────────────────────────────────────────────────────────
  if (tfidfIndex.isBuilt) {
    const tfidfHits = tfidfIndex.search(query, topN * 2)  // over-fetch for tag re-sort
    if (tfidfHits.length > 0) {
      const results = tfidfHits.map(hit => {
        const doc = docMap.get(hit.docId)
        // Select the section within the document that best matches the query
        const queryStems = tokenizeQuery(query)
        let bestSection = doc?.sections.find(s => s.body.trim())
        let bestSectionScore = -1
        if (doc && queryStems.length > 0) {
          for (const section of doc.sections) {
            if (!section.body.trim()) continue
            const text = `${section.heading} ${section.body}`.toLowerCase()
            const matchCount = queryStems.filter(s => text.includes(s)).length
            if (matchCount > bestSectionScore) {
              bestSectionScore = matchCount
              bestSection = section
            }
          }
        }
        const tags = doc?.tags ?? []
        const hasPersonaTag = personaTag
          ? tags.some(t => t.toLowerCase() === personaTag)
          : false
        // Outdated/deprecated document penalty
        const docStatus = doc?.status
        const outdatedPenalty = (docStatus === 'outdated' || docStatus === 'deprecated') ? -0.25 : 0
        return {
          doc_id: hit.docId,
          filename: hit.filename,
          section_id: bestSection?.id ?? '',
          heading: bestSection?.heading ?? '',
          speaker: hit.speaker,
          content: bestSection
            ? (bestSection.body.length > 400
              ? bestSection.body.slice(0, 400).trimEnd() + '…'
              : bestSection.body)
            : '',
          score: Math.max(0, Math.min(1, hit.score + (hasPersonaTag ? TAG_BOOST : 0) + outdatedPenalty)),
          tags,
        } satisfies SearchResult
      })
      results.sort((a, b) => b.score - a.score)
      return results.slice(0, topN)
    }
  }

  // ── Keyword fallback search (when TF-IDF index is not built) ─────────────
  const queryStems = tokenizeQuery(query)
  if (queryStems.length === 0) return []

  const scored: { result: SearchResult; score: number }[] = []

  for (const doc of loadedDocuments) {
    for (const section of doc.sections) {
      if (!section.body.trim()) continue

      const headingLower = section.heading.toLowerCase()
      const bodyLower = section.body.toLowerCase()

      let score = 0
      let matchedTerms = 0
      for (const stem of queryStems) {
        const inHeading = headingLower.includes(stem)
        const bodyCount = bodyLower.split(stem).length - 1
        if (inHeading || bodyCount > 0) {
          matchedTerms++
          score += inHeading ? 0.3 : 0
          score += bodyCount > 0 ? 0.1 * (1 + Math.log(bodyCount)) : 0
        }
      }

      if (matchedTerms === 0) continue

      const coverage = matchedTerms / queryStems.length
      score = Math.min(1, score * 0.6 + coverage * 0.4)

      const tags = doc.tags ?? []
      const hasPersonaTag = personaTag
        ? tags.some(t => t.toLowerCase() === personaTag)
        : false
      const boostedScore = Math.min(1, score + (hasPersonaTag ? TAG_BOOST : 0))

      scored.push({
        score: boostedScore,
        result: {
          doc_id: doc.id,
          filename: doc.filename,
          section_id: section.id,
          heading: section.heading,
          speaker: doc.speaker,
          content: section.body.length > 400
            ? section.body.slice(0, 400).trimEnd() + '…'
            : section.body,
          score: boostedScore,
          tags,
        },
      })
    }
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, topN).map(s => s.result)
}

// ── Direct string search (simple grep-style fallback) ────────────────────────

/**
 * Directly searches all vault documents by query words (simple string search).
 *
 * A simple fallback to supplement documents missed by TF-IDF/BFS.
 * Filename matches are weighted 2x, body matches 1x.
 */
export function directVaultSearch(
  query: string,
  topN: number = 5,
): SearchResult[] {
  const { loadedDocuments } = useVaultStore.getState()
  if (!loadedDocuments?.length) return []

  // Tokenizer strips particles and punctuation (including Korean particles)
  const tokenized = _tokenize(query)
  // Supplement with 2+ digit numbers to reliably match date-format filenames like "[2026.01.28]"
  const numericTerms = query.match(/\d{2,}/g) ?? []
  const terms = [...new Set([...tokenized, ...numericTerms])]
  if (terms.length === 0) return []

  const scored: { doc: LoadedDocument; score: number; bestSection: DocSection | null }[] = []

  for (const doc of loadedDocuments) {
    const filename = doc.filename.toLowerCase()
    const raw = (doc.rawContent ?? '').toLowerCase()

    let score = 0
    for (const term of terms) {
      if (filename.includes(term)) score += 2  // filename match 2x weight
      if (raw.includes(term)) score += 1        // body match (counted independently from filename)
    }
    if (score === 0) continue

    // Select the section with the most query term overlap
    let bestSection: DocSection | null = null
    let bestSectionScore = -1
    for (const section of doc.sections) {
      if (!section.body.trim()) continue
      const text = `${section.heading} ${section.body}`.toLowerCase()
      const sScore = terms.filter(t => text.includes(t)).length
      if (sScore > bestSectionScore) {
        bestSectionScore = sScore
        bestSection = section
      }
    }

    scored.push({ doc, score, bestSection })
  }

  scored.sort((a, b) => b.score - a.score)

  return scored.slice(0, topN).map(({ doc, score, bestSection }) => ({
    doc_id: doc.id,
    filename: doc.filename,
    section_id: bestSection?.id ?? '',
    heading: bestSection?.heading ?? '',
    speaker: doc.speaker,
    content: bestSection
      ? (bestSection.body.length > 500 ? bestSection.body.slice(0, 500).trimEnd() + '…' : bestSection.body)
      : '',
    score: Math.min(1, score * 0.1),  // normalize
    tags: doc.tags ?? [],
  } satisfies SearchResult))
}

// ── Graph data cache ────────────────────────────────────────────────────────

let _cachedAdjacency: Map<string, string[]> | null = null
let _cachedSectionMap: Map<string, { section: DocSection; filename: string; docId: string }> | null = null
let _cachedDocMap: Map<string, LoadedDocument> | null = null
let _cachedMetrics: ReturnType<typeof getGraphMetrics> | null = null
let _cachedLinksKey: string = ''
let _cachedDocsKey: string = ''

/** Content-based fingerprint — length + first/middle/last ID sample */
function arrayKey<T extends { id?: string; source?: unknown; target?: unknown }>(arr: T[]): string {
  const n = arr.length
  if (n === 0) return '0'
  const mid = arr[Math.floor(n / 2)] as { id?: string }
  const first = arr[0] as { id?: string }
  const last = arr[n - 1] as { id?: string }
  return `${n}:${first.id ?? ''}:${mid.id ?? ''}:${last.id ?? ''}`
}

function getCachedMaps(links: GraphLink[], docs: LoadedDocument[]) {
  const linksKey = arrayKey(links as { id?: string }[])
  const docsKey = arrayKey(docs)
  if (linksKey !== _cachedLinksKey || docsKey !== _cachedDocsKey) {
    _cachedAdjacency = buildAdjacencyMap(links)
    _cachedSectionMap = buildSectionMap(docs)
    _cachedDocMap = new Map(docs.map(d => [d.id, d]))
    _cachedMetrics = null  // invalidate metrics — recomputed on next call
    _cachedLinksKey = linksKey
    _cachedDocsKey = docsKey
  }
  return {
    adjacency: _cachedAdjacency!,
    sectionMap: _cachedSectionMap!,
    docMap: _cachedDocMap!,
    /** Lazily compute and cache graph metrics (PageRank + clusters) */
    getMetrics: () => {
      if (!_cachedMetrics) _cachedMetrics = getGraphMetrics(_cachedAdjacency!, links)
      return _cachedMetrics
    },
  }
}

// ── 1. Graph expansion ───────────────────────────────────────────────────────

/**
 * Expand search results with graph-connected neighbor sections.
 *
 * For each ChromaDB result, looks up wiki-link neighbors in the graph
 * and includes truncated content from connected sections.
 *
 * @param results                ChromaDB search results (already reranked)
 * @param maxNeighborsPerResult  Max neighbor sections to include per result
 */
export function expandWithGraphNeighbors(
  results: SearchResult[],
  maxNeighborsPerResult: number = 2
): NeighborContext[] {
  const { links } = useGraphStore.getState()
  const { loadedDocuments } = useVaultStore.getState()

  if (!loadedDocuments || loadedDocuments.length === 0 || links.length === 0) {
    return []
  }

  const { adjacency, sectionMap, docMap } = getCachedMaps(links, loadedDocuments)

  // Map result section_ids to their parent doc IDs
  const primaryDocIds = new Set<string>()
  for (const r of results) {
    if (!r.section_id) continue
    const entry = sectionMap.get(r.section_id)
    if (entry) primaryDocIds.add(entry.docId)
  }

  const seenDocIds = new Set<string>()
  const neighbors: NeighborContext[] = []

  for (const result of results) {
    if (!result.section_id) continue

    // Find the parent doc ID for this result
    const resultEntry = sectionMap.get(result.section_id)
    if (!resultEntry) continue
    const resultDocId = resultEntry.docId

    // Graph adjacency is now document-level (doc.id → doc.id)
    const connectedDocIds = adjacency.get(resultDocId) ?? []
    let added = 0

    for (const neighborDocId of connectedDocIds) {
      if (added >= maxNeighborsPerResult) break
      if (primaryDocIds.has(neighborDocId)) continue
      if (seenDocIds.has(neighborDocId)) continue

      // Find first non-empty section from the neighbor document
      const neighborDoc = docMap.get(neighborDocId)
      if (!neighborDoc) continue
      const firstSection = neighborDoc.sections.find(s => s.body.trim())
      if (!firstSection) continue

      seenDocIds.add(neighborDocId)
      const body = firstSection.body
      neighbors.push({
        sectionId: firstSection.id,
        heading: firstSection.heading,
        content: body.length > 300 ? body.slice(0, 300).trimEnd() + '…' : body,
        linkedFrom: result.section_id,
        filename: neighborDoc.filename,
      })
      added++
    }
  }

  return neighbors
}

// ── 2. 2-stage reranking ─────────────────────────────────────────────────────

/**
 * Rerank search results by combining vector similarity score
 * with keyword overlap and optional speaker affinity.
 *
 * Formula:
 *   keyword_score = |query_terms ∩ content_terms| / |query_terms|
 *   speaker_boost = 0.1 if speaker matches current persona, else 0
 *   final_score   = 0.6 × vector_score + 0.3 × keyword_score + speaker_boost
 *
 * @param results         ChromaDB search results (pre-filtered by score > 0.3)
 * @param query           Original user query
 * @param topN            Number of results to return after reranking
 * @param currentSpeaker  Current director persona (for speaker affinity boost)
 */
export function rerankResults(
  results: SearchResult[],
  query: string,
  topN: number = 3,
  currentSpeaker?: string
): SearchResult[] {
  if (results.length <= topN) return results

  // Tokenize query with Korean particle stripping
  const queryStems = new Set(tokenizeQuery(query))

  if (queryStems.size === 0) return results.slice(0, topN)

  // Build docMap once for recency lookups (O(n) outside the loop)
  const { loadedDocuments: _docs } = useVaultStore.getState()
  const _docMap = _docs ? new Map(_docs.map(d => [d.id, d])) : new Map<string, LoadedDocument>()

  const scored = results.map(r => {
    // Check content using substring matching (handles Korean particles in content too)
    const contentLower = (r.content + ' ' + (r.heading ?? '')).toLowerCase()

    // Count stem matches via substring inclusion
    let overlap = 0
    for (const stem of queryStems) {
      if (contentLower.includes(stem)) overlap++
    }
    const keywordScore = overlap / queryStems.size

    // Speaker affinity boost (same speaker → 10% bonus)
    const speakerBoost =
      currentSpeaker && currentSpeaker !== 'unknown' && r.speaker === currentSpeaker
        ? 0.1
        : 0

    // Tag affinity boost: doc tagged with persona's topic → 15% bonus
    const pTag = currentSpeaker ? PERSONA_TAG_MAP[currentSpeaker] : undefined
    const tagBoost = pTag && r.tags?.some(t => t.toLowerCase() === pTag) ? 0.15 : 0

    // Outdated/deprecated document penalty
    const docStatus = _docMap.get(r.doc_id)?.status
    const outdatedPenalty = (docStatus === 'outdated' || docStatus === 'deprecated') ? -0.3 : 0

    const finalScore = 0.6 * r.score + 0.3 * keywordScore + speakerBoost + tagBoost + outdatedPenalty

    return { result: r, finalScore }
  })

  scored.sort((a, b) => b.finalScore - a.finalScore)

  return scored.slice(0, topN).map(s => s.result)
}

// ── 3a. Deep graph traversal (BFS) ───────────────────────────────────────────

/**
 * Returns the document body text with frontmatter YAML stripped.
 *
 * Priority:
 *   1. Section combination (gray-matter has already removed frontmatter)
 *   2. Manual frontmatter removal from rawContent (when all sections are empty)
 *
 * Why not use rawContent directly: rawContent includes YAML frontmatter, which
 * causes AI to misread "---\nspeaker: ...\ntags: ..." as actual content.
 */
export function getStrippedBody(doc: LoadedDocument): string {
  const sectionText = doc.sections
    .filter(s => s.body.trim())
    .map(s => {
      const h = s.heading && s.heading !== '(intro)' ? `### ${s.heading}\n` : ''
      return h + s.body
    })
    .join('\n\n')
    .trim()
  if (sectionText) return sectionText

  // All sections are empty — manually strip frontmatter from rawContent
  const raw = doc.rawContent ?? ''
  const fmMatch = raw.match(/^---[\s\S]*?---\n?/)
  return fmMatch ? raw.slice(fmMatch[0].length).trim() : raw.trim()
}

/**
 * B. Passage-level content selection.
 *
 * If queryTerms are provided, selects the section with the most query token matches.
 * If queryTerms are absent, returns the beginning of the full getStrippedBody() result.
 *
 * Frontmatter YAML is excluded in all cases.
 */
function getDocContent(
  doc: LoadedDocument,
  budget: number,
  queryTerms?: string[]
): string {
  // No queryTerms → return beginning of body with frontmatter stripped
  if (!queryTerms || queryTerms.length === 0) {
    const body = getStrippedBody(doc)
    return body.length > budget ? body.slice(0, budget).trimEnd() + '…' : body
  }

  // Passage-level: select the section with the most query token matches
  // The intro section body may include an H1 title (e.g. "# Heat System"), causing a short
  // intro to outscore longer H2 sections when the filename overlaps with the query.
  // To prevent this, strip the leading markdown heading from the intro section body before scoring.
  let bestSection: DocSection | null = null
  let bestScore = -1

  for (const section of doc.sections) {
    if (!section.body.trim()) continue
    // Strip leading H1 from intro section body before scoring (prevents filename inflation)
    const bodyForScore = section.heading === '(intro)'
      ? section.body.replace(/^#[^\n]*\n?/, '').trim()
      : section.body
    const text = `${section.heading} ${bodyForScore}`.toLowerCase()
    let score = 0
    for (const term of queryTerms) {
      if (text.includes(term)) score++
    }
    if (score > bestScore) {
      bestScore = score
      bestSection = section
    }
  }

  // If no section matched or the selected section is too short, use the full body
  const fullBody = getStrippedBody(doc)
  if (!bestSection || bestScore <= 0) {
    return fullBody.length > budget ? fullBody.slice(0, budget).trimEnd() + '…' : fullBody
  }

  const h = bestSection.heading && bestSection.heading !== '(intro)' ? `### ${bestSection.heading}\n` : ''
  const passageText = h + bestSection.body

  // If the selected passage is too short and the full body has much more content, use the full body
  // (e.g. prevents dropping actual content sections when a short intro section is selected)
  if (passageText.length < 200 && fullBody.length > passageText.length * 3) {
    return fullBody.length > budget ? fullBody.slice(0, budget).trimEnd() + '…' : fullBody
  }

  return passageText.length > budget
    ? passageText.slice(0, budget).trimEnd() + '…'
    : passageText
}

/**
 * BFS traversal from starting document IDs.
 * Returns a map of docId → minimum hop distance from any starting node.
 * Phantom nodes (no rawContent) are visited but not included in output.
 */
function bfsFromDocIds(
  startDocIds: string[],
  adjacency: Map<string, string[]>,
  maxHops: number,
  maxDocs: number
): Map<string, number> {
  const visited = new Map<string, number>()
  const queue: [string, number][] = []

  for (const id of startDocIds) {
    if (!visited.has(id)) {
      visited.set(id, 0)
      queue.push([id, 0])
    }
  }

  while (queue.length > 0 && visited.size < maxDocs) {
    const [docId, hop] = queue.shift()!
    if (hop >= maxHops) continue
    for (const neighborId of adjacency.get(docId) ?? []) {
      if (!visited.has(neighborId) && visited.size < maxDocs) {
        visited.set(neighborId, hop + 1)
        queue.push([neighborId, hop + 1])
      }
    }
  }
  return visited
}

/**
 * Total context budget (chars).
 * 16000 chars ≈ ~4800 tokens — well within Claude's 200k context.
 * Tuning guide: increase for better coverage over response quality;
 * decrease if cost/speed is the priority.
 */
const DEEP_CONTEXT_BUDGET = 16_000

/** Maximum content length (chars) per document by hop distance */
const HOP_CHAR_BUDGET = [1_500, 900, 500, 250] as const

/**
 * PPR-based graph traversal to collect related document context.
 *
 * Starts from TF-IDF seeds, runs strength-weighted PPR via Web Worker,
 * then selects the top-scoring maxDocs documents.
 * Unlike BFS, PPR has no hop limit and automatically captures
 * strongly-connected hub documents.
 *
 * Use cases: "insights related to this topic", "give me project feedback" —
 * queries that need to gather information across multiple documents.
 *
 * @param maxHops    Unused (kept for API compatibility — PPR has no hop concept)
 */
export async function buildDeepGraphContext(
  results: SearchResult[],
  maxHops: number = 2,
  maxDocs: number = 14,
  queryTerms?: string[],
  currentSpeaker?: string,
): Promise<string> {
  const { links } = useGraphStore.getState()
  const { loadedDocuments } = useVaultStore.getState()
  if (!loadedDocuments?.length) {
    logger.warn('[RAG] No loadedDocuments — vault has not been loaded')
    return ''
  }

  const { adjacency, docMap, getMetrics } = getCachedMaps(links, loadedDocuments)

  // Vault with no WikiLinks — graph traversal unavailable, format TF-IDF results directly
  if (!links.length) {
    if (results.length === 0) return ''
    const parts: string[] = ['## Related Documents (Direct Search)\n']
    let charCount = 20
    for (const r of results.slice(0, maxDocs)) {
      const doc = docMap.get(r.doc_id)
      if (!doc) continue
      const name = doc.filename.replace(/\.md$/i, '')
      const content = getDocContent(doc, 1200, queryTerms)
      if (!content) continue
      const entry = `[Document] ${name}\n${content}\n\n`
      if (charCount + entry.length > DEEP_CONTEXT_BUDGET) break
      parts.push(entry)
      charCount += entry.length
    }
    return parts.length <= 1 ? '' : parts.join('') + '\n'
  }

  // Starting nodes: top documents from search results (deduplicated)
  const _startSet = new Set<string>()
  for (const r of results) { if (r.doc_id) _startSet.add(r.doc_id) }
  const startDocIds = [..._startSet]

  // If keyword matching is weak, auto-supplement with hub nodes as seeds
  if (startDocIds.length < 2) {
    const hubIds = getHubDocIds(adjacency, 5)
    for (const id of hubIds) {
      if (!startDocIds.includes(id)) startDocIds.push(id)
      if (startDocIds.length >= 6) break
    }
  }

  if (startDocIds.length === 0) return ''

  // PPR execution — async via Web Worker (no main thread blocking)
  const pprScores = await runPPRInWorker(startDocIds, links)

  // Select top maxDocs by PPR score (exclude score=0)
  // Outdated/deprecated docs get 70% decay; graphWeight adjustments apply
  const seedSet = new Set(startDocIds)
  const _pprEntries: [string, number][] = []
  for (const [id, score] of pprScores) {
    if (score <= 0) continue
    const doc = docMap.get(id)
    // graph_weight: skip — fully exclude from traversal (link-only hubs, 500+ outbound)
    if (doc?.graphWeight === 'skip') continue
    const docStatus = doc?.status
    const decay = (docStatus === 'outdated' || docStatus === 'deprecated') ? 0.3 : 1.0
    // graph_weight: low — link weight 0.3 decay (100-499 outbound links)
    const weightDecay = doc?.graphWeight === 'low' ? 0.3 : 1.0
    // Speaker affinity boost: doc.speaker matches current persona -> +10%
    const speakerBoost = (currentSpeaker && currentSpeaker !== 'unknown' && doc?.speaker === currentSpeaker) ? 1.1 : 1.0
    _pprEntries.push([id, score * decay * weightDecay * speakerBoost])
  }
  _pprEntries.sort((a, b) => b[1] - a[1])
  const sorted = _pprEntries.slice(0, maxDocs)

  if (sorted.length === 0) return ''

  // Build visited Map for buildStructureHeader compatibility (seed=0, rest=1)
  const visited = new Map<string, number>(
    sorted.map(([id]) => [id, seedSet.has(id) ? 0 : 1])
  )

  // Yield to event loop before heavy computation
  await new Promise<void>(r => setTimeout(r, 0))

  // Structure header (PageRank + cluster overview)
  const structureHeader = await buildStructureHeader(visited, adjacency, links, loadedDocuments, docMap, getMetrics)

  // PPR rank-based labels and char budgets
  // Top 3: core (1500 chars), 4-8: related (900 chars), 9+: peripheral (500 chars)
  const parts: string[] = [structureHeader, '## Related Documents (PPR Traversal)\n']
  let charCount = structureHeader.length + 20
  let docHits = 0

  sorted.forEach(([docId, pprScore], rank) => {
    if (charCount >= DEEP_CONTEXT_BUDGET) return

    const doc = docMap.get(docId)
    if (!doc) return  // phantom node — skip

    const budget = rank < 3 ? 1_500 : rank < 8 ? 900 : 500
    const label = seedSet.has(docId) ? 'Core' : rank < 3 ? 'Core' : rank < 8 ? 'Related' : 'Peripheral'
    const name = doc.filename.replace(/\.md$/i, '')
    const speaker = doc.speaker && doc.speaker !== 'unknown' ? ` (${doc.speaker})` : ''
    const dateLabel = getDocDateLabel(doc)
    const typeLabel = doc.type ? ` [${doc.type}]` : ''
    const scorePct = Math.round(pprScore * 1000) / 10
    const outdatedLabel = (doc.status === 'outdated' || doc.status === 'deprecated')
      ? ` [outdated${doc.supersededBy ? ` -> ${doc.supersededBy}` : ''}]`
      : ''
    const header = `[${label}|PPR ${scorePct}]${outdatedLabel}${typeLabel} ${name}${speaker}${dateLabel ? ` [${dateLabel}]` : ''}`

    const content = getDocContent(doc, budget, queryTerms)
    const entry = `${header}\n${content}\n\n`
    if (charCount + entry.length > DEEP_CONTEXT_BUDGET) return

    parts.push(entry)
    charCount += entry.length
    docHits++
  })

  logger.debug(`[RAG] PPR complete: candidates=${sorted.length}, content included=${docHits} docs, total ${charCount} chars`)

  // Fall back to direct TF-IDF result format when no actual document content is included
  if (docHits === 0) {
    if (results.length === 0) return ''
    const fallback: string[] = ['## Related Documents (Direct Search)\n']
    let fallbackChars = 20
    for (const r of results.slice(0, maxDocs)) {
      const doc = docMap.get(r.doc_id)
      if (!doc) continue
      const content = getDocContent(doc, 1200, queryTerms)
      if (!content) continue
      const entry = `[Direct] ${doc.filename.replace(/\.md$/i, '')}\n${content}\n\n`
      if (fallbackChars + entry.length > DEEP_CONTEXT_BUDGET) break
      fallback.push(entry)
      fallbackChars += entry.length
    }
    return fallback.length <= 1 ? '' : fallback.join('') + '\n'
  }

  return parts.join('') + '\n'
}

/**
 * Traverses the graph via BFS from a specific document ID and collects related context.
 *
 * Identical to buildDeepGraphContext but completely bypasses keyword search.
 * Use when the user directly selects a node in the graph.
 *
 * @param startDocId  Starting document ID (graphStore.selectedNodeId)
 * @param maxHops     Maximum hops to traverse (default 3)
 * @param maxDocs     Maximum documents to collect (default 20)
 */
export async function buildDeepGraphContextFromDocId(
  startDocId: string,
  maxHops: number = 3,
  maxDocs: number = 20
): Promise<string> {
  const { links } = useGraphStore.getState()
  const { loadedDocuments } = useVaultStore.getState()
  if (!loadedDocuments?.length || !links.length) return ''

  const { adjacency, docMap, getMetrics } = getCachedMaps(links, loadedDocuments)

  const visited = bfsFromDocIds([startDocId], adjacency, maxHops, maxDocs)
  if (visited.size === 0) return ''

  await new Promise<void>(r => setTimeout(r, 0))
  const structureHeader = await buildStructureHeader(visited, adjacency, links, loadedDocuments, docMap, getMetrics)

  const rec2 = (id: string) => { const d = docMap.get(id); return d ? getDocRecency(d) : 0 }
  const sorted = [...visited.entries()].sort((a, b) =>
    a[1] !== b[1] ? a[1] - b[1] : rec2(b[0]) - rec2(a[0])
  )
  const hopLabel = ['Selected', '1-hop', '2-hop', '3-hop']
  const parts: string[] = [structureHeader, '## Documents Related to Selected Node (Graph Traversal)\n']
  let charCount = structureHeader.length + 25

  for (const [docId, hop] of sorted) {
    if (charCount >= DEEP_CONTEXT_BUDGET) break
    const doc = docMap.get(docId)
    if (!doc) continue

    const budget = HOP_CHAR_BUDGET[hop] ?? 80
    const label = hopLabel[hop] ?? `${hop}-hop`
    const name = doc.filename.replace(/\.md$/i, '')
    const speaker = doc.speaker && doc.speaker !== 'unknown' ? ` (${doc.speaker})` : ''
    const dateLabel = getDocDateLabel(doc)
    const header = `[${label}] ${name}${speaker}${dateLabel ? ` [${dateLabel}]` : ''}`
    const content = getDocContent(doc, budget)
    const entry = `${header}\n${content}\n\n`
    if (charCount + entry.length > DEEP_CONTEXT_BUDGET) break
    parts.push(entry)
    charCount += entry.length
  }

  if (parts.length <= 1) return ''
  return parts.join('') + '\n'
}

// ── 3a-helper. Structure header generation ───────────────────────────────────

/**
 * Generates structural information about traversed documents as an AI context header.
 *
 * Includes:
 *  - Top PageRank hub documents
 *  - C. TF-IDF topic keyword labels per cluster
 *  - D. Bridge documents connecting multiple clusters
 *  - A. Hidden semantically connected document pairs with no WikiLinks
 */
async function buildStructureHeader(
  visited: Map<string, number>,
  adjacency: Map<string, string[]>,
  links: GraphLink[],
  loadedDocuments: LoadedDocument[],
  docMap: Map<string, LoadedDocument>,
  getMetrics: () => ReturnType<typeof getGraphMetrics>
): Promise<string> {
  const metrics = getMetrics()  // cached — no recomputation if adjacency/links unchanged
  const { pageRank, clusters, clusterCount } = metrics

  // Top 5 by PageRank (limited to traversed documents)
  const topDocs = [...visited.keys()]
    .map(id => ({ id, rank: pageRank.get(id) ?? 0 }))
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 5)
    .map(({ id }) => docMap.get(id)?.filename.replace(/\.md$/i, '') ?? id)

  // C. Document groups per cluster + TF-IDF topic keyword labels (yield to UI on cache miss)
  await new Promise<void>(r => setTimeout(r, 0))
  const clusterTopics = getClusterTopics(clusters, loadedDocuments, 3)
  const clusterGroups = new Map<number, string[]>()
  for (const [docId] of visited) {
    const cId = clusters.get(docId)
    if (cId === undefined) continue
    if (!clusterGroups.has(cId)) clusterGroups.set(cId, [])
    const name = docMap.get(docId)?.filename.replace(/\.md$/i, '') ?? docId
    clusterGroups.get(cId)!.push(name)
  }
  const clusterLines = [...clusterGroups.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 4)
    .map(([cId, names]) => {
      const topics = clusterTopics.get(cId) ?? []
      const topicLabel = topics.length > 0 ? ` [${topics.join('/')}]` : ''
      return `  • Cluster ${cId + 1}${topicLabel} (${names.length} docs): ${names.slice(0, 5).join(', ')}${names.length > 5 ? ' …' : ''}`
    })
    .join('\n')

  // D. Bridge node detection (limited to traversed documents, top 3)
  const visitedAdj = new Map<string, string[]>()
  for (const [docId] of visited) {
    visitedAdj.set(docId, adjacency.get(docId) ?? [])
  }
  const bridges = detectBridgeNodes(visitedAdj, clusters)
    .slice(0, 3)
    .map(b => {
      const name = docMap.get(b.docId)?.filename.replace(/\.md$/i, '') ?? b.docId
      return `${name}(${b.clusterCount} clusters connected)`
    })

  // A. Implicit link discovery (semantically similar pairs without WikiLinks, top 4) — yield on cache miss
  await new Promise<void>(r => setTimeout(r, 0))
  const implicitLinks = tfidfIndex.findImplicitLinks(adjacency, 4, 0.25)
    .map(l => {
      const a = l.filenameA.replace(/\.md$/i, '')
      const b = l.filenameB.replace(/\.md$/i, '')
      const pct = Math.round(l.similarity * 100)
      return `  • "${a}" ↔ "${b}" (similarity ${pct}%)`
    })

  const lines: string[] = [
    `## Project Structure Overview`,
    `Total clusters: ${clusterCount} | Documents traversed: ${visited.size}`,
    `Key hub documents (top PageRank): ${topDocs.join(', ')}`,
  ]

  if (clusterLines) {
    lines.push(`\nCluster topic groups:`)
    lines.push(clusterLines)
  }

  if (bridges.length > 0) {
    lines.push(`\nKey bridge documents (multi-cluster connections): ${bridges.join(', ')}`)
  }

  if (implicitLinks.length > 0) {
    lines.push(`\nHidden semantic connections (no WikiLink):`)
    lines.push(implicitLinks.join('\n'))
  }

  lines.push('')
  return lines.join('\n') + '\n'
}

// ── 3a-extra. BFS node ID helpers (for graph highlight) ──────────────────────

/** Shared setup: read stores + build adjacency. Returns null when no data. */
function getAdjacency(): Map<string, string[]> | null {
  const { links } = useGraphStore.getState()
  const { loadedDocuments } = useVaultStore.getState()
  if (!loadedDocuments?.length || !links.length) return null
  return getCachedMaps(links, loadedDocuments).adjacency
}

/**
 * Returns the doc IDs visited by BFS from a given starting document.
 * Used to highlight nodes in the graph while AI is analyzing.
 */
export function getBfsContextDocIds(
  startDocId: string,
  maxHops: number = 3,
  maxDocs: number = 20
): string[] {
  const adjacency = getAdjacency()
  if (!adjacency) return [startDocId]
  return [...bfsFromDocIds([startDocId], adjacency, maxHops, maxDocs).keys()]
}

/**
 * Returns the doc IDs visited by the hub-seeded global BFS traversal.
 * Used to highlight nodes in the graph during a full-project AI analysis.
 */
export function getGlobalContextDocIds(
  maxDocs: number = 35,
  maxHops: number = 4
): string[] {
  const adjacency = getAdjacency()
  if (!adjacency) return []
  const hubIds = getHubDocIds(adjacency, 8)
  if (hubIds.length === 0) return []
  return [...bfsFromDocIds(hubIds, adjacency, maxHops, maxDocs).keys()]
}

// ── 3b. Hub-seeded global graph context ──────────────────────────────────────

/**
 * Returns the top N hub document IDs by degree (connection count).
 * Hub nodes are connected to many documents, making them ideal starting points for full traversal.
 */
function getHubDocIds(adjacency: Map<string, string[]>, topN: number = 10): string[] {
  return [...adjacency.entries()]
    .filter(([, neighbors]) => neighbors.length > 0)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, topN)
    .map(([id]) => id)
}

/**
 * Traverses the full graph via BFS from hub nodes and collects context.
 *
 * Used for broad queries like "overall project insights", "general feedback",
 * or when the AI analysis button is clicked without selecting a node.
 *
 * @param maxDocs   Maximum documents to collect (default 35)
 * @param maxHops   Maximum BFS hops (default 4)
 */
export async function buildGlobalGraphContext(
  maxDocs: number = 35,
  maxHops: number = 4
): Promise<string> {
  const { links } = useGraphStore.getState()
  const { loadedDocuments } = useVaultStore.getState()
  if (!loadedDocuments?.length || !links.length) return ''

  const { adjacency, docMap, getMetrics } = getCachedMaps(links, loadedDocuments)

  const hubIds = getHubDocIds(adjacency, 8)
  if (hubIds.length === 0) return ''

  const visited = bfsFromDocIds(hubIds, adjacency, maxHops, maxDocs)
  if (visited.size === 0) return ''

  const structureHeader = await buildStructureHeader(visited, adjacency, links, loadedDocuments, docMap, getMetrics)

  const GLOBAL_BUDGET = 24000
  const rec3 = (id: string) => { const d = docMap.get(id); return d ? getDocRecency(d) : 0 }
  const sorted = [...visited.entries()].sort((a, b) =>
    a[1] !== b[1] ? a[1] - b[1] : rec3(b[0]) - rec3(a[0])
  )
  const parts: string[] = [structureHeader, '## All Project-Related Documents (Hub-based Traversal)\n']
  let charCount = structureHeader.length + 28

  for (const [docId, hop] of sorted) {
    if (charCount >= GLOBAL_BUDGET) break
    const doc = docMap.get(docId)
    if (!doc) continue

    const budget = HOP_CHAR_BUDGET[Math.min(hop, HOP_CHAR_BUDGET.length - 1)] ?? 80
    const name = doc.filename.replace(/\.md$/i, '')
    const speaker = doc.speaker && doc.speaker !== 'unknown' ? ` (${doc.speaker})` : ''
    const dateLabel = getDocDateLabel(doc)
    const header = `[Traversal] ${name}${speaker}${dateLabel ? ` [${dateLabel}]` : ''}`
    const content = getDocContent(doc, budget)
    const entry = `${header}\n${content}\n\n`
    if (charCount + entry.length > GLOBAL_BUDGET) break
    parts.push(entry)
    charCount += entry.length
  }

  if (parts.length <= 2) return ''
  return parts.join('') + '\n'
}

// ── 3. Compressed context formatting ─────────────────────────────────────────

/**
 * Format search results and neighbor contexts into a compressed,
 * token-efficient context string for LLM injection.
 *
 * Format:
 *   ## Related Documents
 *   [Document] filename > heading (speaker)
 *   content...
 *
 *   ### Connected Documents
 *   [Connected] filename > heading
 *   neighbor content...
 */
/**
 * Max total characters for the context string.
 * ~2000 chars ≈ ~600 tokens — keeps LLM context lean while providing
 * enough reference material for accurate answers.
 */
const CONTEXT_BUDGET = 3000

export function formatCompressedContext(
  results: SearchResult[],
  neighbors: NeighborContext[]
): string {
  if (results.length === 0) return ''

  const parts: string[] = ['## Related Documents\n']
  let charCount = 10 // header length

  for (const r of results) {
    const header = [
      `[Document]`,
      r.filename,
      r.heading ? `> ${r.heading}` : null,
      r.speaker && r.speaker !== 'unknown' ? `(${r.speaker})` : null,
    ]
      .filter(Boolean)
      .join(' ')

    // Truncate content to fit budget
    const maxContent = Math.min(300, CONTEXT_BUDGET - charCount - header.length - 10)
    if (maxContent <= 0) break
    const content = r.content.length > maxContent
      ? r.content.slice(0, maxContent).trimEnd() + '…'
      : r.content

    parts.push(header)
    parts.push(content)
    parts.push('')
    charCount += header.length + content.length + 2
  }

  if (neighbors.length > 0 && charCount < CONTEXT_BUDGET - 100) {
    parts.push('### Connected Documents\n')
    charCount += 12

    for (const n of neighbors) {
      const nHeader = `[Connected] ${n.filename} > ${n.heading}`
      const maxContent = Math.min(200, CONTEXT_BUDGET - charCount - nHeader.length - 10)
      if (maxContent <= 0) break
      const content = n.content.length > maxContent
        ? n.content.slice(0, maxContent).trimEnd() + '…'
        : n.content

      parts.push(nHeader)
      parts.push(content)
      parts.push('')
      charCount += nHeader.length + content.length + 2
    }
  }

  return parts.join('\n') + '\n'
}
