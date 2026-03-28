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
import { useSettingsStore } from '@/stores/settingsStore'
import { logger } from '@/lib/logger'
import {
  tfidfIndex,
  getGraphMetrics,
  tokenize as _tokenize,
  detectBridgeNodes,
  getClusterTopics,
  getContentDate,
} from '@/lib/graphAnalysis'
import { runPPRInWorker } from '@/lib/pprWorkerClient'
import { expandTerms } from '@/lib/synonyms'

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

// ── Generic heading filter (PPTX/PDF slide/page heading noise removal) ──────
const GENERIC_HEADING_RE = /^(슬라이드|페이지|slide|page)\s*\d+$/i

/** Replace generic headings that don't contribute to search scoring with empty string */
function headingForScore(heading: string): string {
  return GENERIC_HEADING_RE.test(heading.trim()) ? '' : heading
}

// ── Archive / outdated detection ─────────────────────────────────────────────

const ARCHIVE_PATH_RE = /(?:^|[\\/])\.?archive[\\/]/i

/** Determine if a document is in archive or outdated/deprecated state */
function isOutdatedDoc(doc: { status?: string; folderPath?: string; absolutePath?: string } | undefined): boolean {
  if (!doc) return false
  if (doc.status === 'outdated' || doc.status === 'deprecated') return true
  const path = (doc.folderPath ?? (doc as any).absolutePath ?? '')
  return ARCHIVE_PATH_RE.test(path)
}

// ── Recency helpers ──────────────────────────────────────────────────────────

/** getContentDate imported from graphAnalysis.ts */

/**
 * Returns a short date label (YYYY-MM-DD) for context headers.
 * Empty string when date is unavailable.
 */
function getDocDateLabel(doc: LoadedDocument): string {
  const t = getContentDate(doc)
  if (t > 0) return new Date(t).toISOString().slice(0, 10)
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

// ── 0. Frontend search (TF-IDF first, keyword fallback) ──────────────────────

/**
 * Searches vault documents.
 *
 * Pipeline:
 *   1. TF-IDF cosine similarity search (when tfidfIndex is built)
 *      — finds semantically close documents, resolving title mismatch issues
 *   2. Falls back to keyword-based search when TF-IDF yields no results
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

  // ── TF-IDF priority search ──────────────────────────────────────────────────
  if (tfidfIndex.isBuilt) {
    const tfidfHits = tfidfIndex.search(query, topN * 2)  // over-fetch for tag re-sort
    if (tfidfHits.length > 0) {
      const queryStems = tokenizeQuery(query)  // shared — avoids repeated computation inside map
      const results = tfidfHits.map(hit => {
        const doc = docMap.get(hit.docId)
        // Select the section within the document that best matches the query
        let bestSection = doc?.sections.find(s => s.body.trim())
        let bestSectionScore = -1
        if (doc && queryStems.length > 0) {
          for (const section of doc.sections) {
            if (!section.body.trim()) continue
            const text = `${headingForScore(section.heading)} ${section.body}`.toLowerCase()
            let matchCount = 0
            for (const s of queryStems) { if (text.includes(s)) matchCount++ }
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
        // outdated/deprecated/archive document penalty
        const outdatedPenalty = isOutdatedDoc(doc) ? -0.25 : 0
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
          score: Math.max(0, Math.min(1, hit.score * (hasPersonaTag ? (1 + TAG_BOOST) : 1) + outdatedPenalty)),
          tags,
        } satisfies SearchResult
      })
      results.sort((a, b) => b.score - a.score)
      return results.slice(0, topN)
    }
  }

  // ── Keyword fallback search (when TF-IDF index not built) ───────────────────
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
        let bodyCount = 0
        if (bodyLower.includes(stem)) {  // fast path: skip indexOf loop if no match
          let pos = 0
          while ((pos = bodyLower.indexOf(stem, pos)) !== -1) { bodyCount++; pos += Math.max(stem.length, 1) }
        }
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
      const boostedScore = Math.min(1, score * (hasPersonaTag ? (1 + TAG_BOOST) : 1))

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
 * Directly searches all vault documents by query words (string search).
 *
 * Simple fallback to supplement documents not found by TF-IDF/BFS.
 * Filename match weight 2x, body match weight 1x.
 */
export function directVaultSearch(
  query: string,
  topN: number = 5,
): SearchResult[] {
  const { loadedDocuments } = useVaultStore.getState()
  if (!loadedDocuments?.length) return []

  // Remove particles/punctuation via tokenizer (includes Korean particle stripping)
  const tokenized = expandTerms(_tokenize(query))
  // Supplement 2+ digit numbers: ensure matching with date-format filename components like "[2026.01.28]"
  const numericTerms = query.match(/\d{2,}/g) ?? []
  const terms = [...new Set([...tokenized, ...numericTerms])]
  if (terms.length === 0) return []

  const scored: { doc: LoadedDocument; score: number; bestSection: DocSection | null }[] = []
  const now = Date.now()

  for (const doc of loadedDocuments) {
    const filename = doc.filename.toLowerCase()
    const raw = (doc.rawContent ?? '').toLowerCase()

    // Per-query-word match count (pure coverage without weighting)
    let filenameHits = 0
    let bodyHits = 0
    for (const term of terms) {
      if (filename.includes(term)) filenameHits++
      if (raw.includes(term)) bodyHits++
    }
    if (filenameHits === 0 && bodyHits === 0) continue

    // Coverage-based score: filename 60%, body 40% — query word coverage ratio
    const n = terms.length
    let score = (filenameHits / n) * 0.6 + (bodyHits / n) * 0.4

    // Filename match boost: scale up to 0.5-1.0 range to compete with BM25 scores (0.9+)
    if (filenameHits > 0) {
      score = 0.5 + score * 0.5  // 0-1 → 0.5-1.0
    }

    // Recency boost: bonus for recent docs — ~10% within 6 months, nearly 0 after 1 year
    const docTime = getContentDate(doc)
    if (docTime > 0) {
      const daysOld = (now - docTime) / 86_400_000
      score *= 1 + 0.1 * Math.exp(-daysOld / 180)
    }

    // Select section with most overlap with query words
    let bestSection: DocSection | null = null
    let bestSectionScore = -1
    for (const section of doc.sections) {
      if (!section.body.trim()) continue
      const text = `${headingForScore(section.heading)} ${section.body}`.toLowerCase()
      let sScore = 0
      for (const t of terms) { if (text.includes(t)) sScore++ }
      if (sScore > bestSectionScore) {
        bestSectionScore = sScore
        bestSection = section
      }
    }

    scored.push({ doc, score, bestSection })
  }

  // Sort by coverage score (removed filename absolute priority)
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
    score,  // already in 0-1 range (coverage ratio)
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

/** Array content-based fingerprint — length + first/middle/last ID samples */
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

  const { loadedDocuments: _docs } = useVaultStore.getState()
  const _docMap = _docs ? new Map(_docs.map(d => [d.id, d])) : new Map<string, LoadedDocument>()
  const { rerankVectorWeight, rerankKeywordWeight } = useSettingsStore.getState().searchConfig

  const scored = results.map(r => {
    const contentLower = (r.content + ' ' + (r.heading ?? '')).toLowerCase()

    let overlap = 0
    for (const stem of queryStems) {
      if (contentLower.includes(stem)) overlap++
    }
    const keywordScore = overlap / queryStems.size

    // Speaker affinity boost
    const speakerBoost =
      currentSpeaker && currentSpeaker !== 'unknown' && r.speaker === currentSpeaker
        ? 0.1
        : 0

    // Tag affinity boost
    const pTag = currentSpeaker ? PERSONA_TAG_MAP[currentSpeaker] : undefined
    const tagBoost = pTag && r.tags?.some(t => t.toLowerCase() === pTag) ? 0.15 : 0

    // Outdated/deprecated/archive penalty (recency boost is already handled in fetchRAGContext Stage 1)
    const outdatedPenalty = isOutdatedDoc(_docMap.get(r.doc_id)) ? -0.3 : 0

    const baseScore = rerankVectorWeight * r.score + rerankKeywordWeight * keywordScore
    const finalScore = baseScore * (1 + speakerBoost + tagBoost) + outdatedPenalty

    return { result: r, finalScore }
  })

  scored.sort((a, b) => b.finalScore - a.finalScore)

  return scored.slice(0, topN).map(s => s.result)
}

// ── 3.5 Version deduplication ────────────────────────────────────────────────

const VERSION_RE = /[_\s]v(\d+(?:\.\d+)?)(?:\.md)?$/i

/**
 * Parses filename version suffixes (_v2, _v3, etc.) to remove older versions of the same document.
 * Keeps the document with the highest version number; on ties, keeps the one with the most recent frontmatter date.
 */
export function deduplicateVersions(
  results: SearchResult[],
  docMap: Map<string, LoadedDocument>,
): SearchResult[] {
  const groups = new Map<string, SearchResult[]>()
  for (const r of results) {
    const base = r.filename.replace(VERSION_RE, '').replace(/\.md$/i, '').toLowerCase().trim()
    if (!groups.has(base)) groups.set(base, [])
    groups.get(base)!.push(r)
  }

  const deduped: SearchResult[] = []
  for (const [, group] of groups) {
    if (group.length <= 1) { deduped.push(group[0]); continue }
    // Higher version number first → then most recent date
    group.sort((a, b) => {
      const va = parseFloat(a.filename.match(VERSION_RE)?.[1] ?? '0')
      const vb = parseFloat(b.filename.match(VERSION_RE)?.[1] ?? '0')
      if (va !== vb) return vb - va
      const da = docMap.get(a.doc_id)?.date ?? ''
      const db = docMap.get(b.doc_id)?.date ?? ''
      return db.localeCompare(da)
    })
    deduped.push(group[0])  // keep only latest version
  }
  return deduped
}

// ── 3a. Deep graph traversal (BFS) ───────────────────────────────────────────

/**
 * Returns document body text with frontmatter YAML stripped.
 *
 * Priority:
 *   1. Section combination (result of gray-matter already stripping frontmatter)
 *   2. Manually strip frontmatter from rawContent (when all sections are empty)
 *
 * Reason for not using rawContent directly: rawContent includes YAML frontmatter,
 * causing AI to misread "---\nspeaker: ...\ntags: ..." etc. as actual content.
 */
export function getStrippedBody(doc: LoadedDocument): string {
  // Single pass — accumulate directly without filter+map intermediate arrays
  const parts: string[] = []
  for (const s of doc.sections) {
    if (!s.body.trim()) continue
    const h = s.heading && s.heading !== '(intro)' ? `### ${s.heading}\n` : ''
    parts.push(h + s.body)
  }
  const sectionText = parts.join('\n\n').trim()
  if (sectionText) return sectionText

  // When all sections are empty — manually remove frontmatter from rawContent
  // indexOf-based to prevent ReDoS (replaces regex [\s\S]*?)
  const raw = doc.rawContent ?? ''
  if (raw.startsWith('---')) {
    const closeIdx = raw.indexOf('\n---', 3)
    if (closeIdx >= 0) return raw.slice(closeIdx + 4).trim()
  }
  return raw.trim()
}

/**
 * B. Passage-level content selection.
 *
 * When queryTerms are provided, selects the section with the most query token matches.
 * When queryTerms are absent, returns the full getStrippedBody() from the beginning.
 *
 * Frontmatter YAML is excluded in all cases.
 */
function getDocContent(
  doc: LoadedDocument,
  budget: number,
  queryTerms?: string[]
): string {
  // No queryTerms → beginning of frontmatter-stripped body
  if (!queryTerms || queryTerms.length === 0) {
    const body = getStrippedBody(doc)
    return body.length > budget ? body.slice(0, budget).trimEnd() + '…' : body
  }

  // Passage-level: select the section that matches most query tokens
  // Intro section body contains the H1 title (e.g., "# Heat System"), so when filename
  // overlaps with query, short intros score higher than longer H2 sections.
  // To prevent this, strip the leading markdown heading from intro section body before scoring.
  let bestSection: DocSection | null = null
  let bestScore = -1

  for (const section of doc.sections) {
    if (!section.body.trim()) continue
    // Strip leading H1 title from intro section body before scoring (prevents filename inflation)
    const bodyForScore = section.heading === '(intro)'
      ? section.body.replace(/^#[^\n]*\n?/, '').trim()
      : section.body
    const text = `${headingForScore(section.heading)} ${bodyForScore}`.toLowerCase()
    let score = 0
    for (const term of queryTerms) {
      if (text.includes(term)) score++
    }
    if (score > bestScore) {
      bestScore = score
      bestSection = section
    }
  }

  // 어떤 섹션에도 매칭 없거나, 선택된 섹션이 너무 짧으면 전체 본문 사용
  const fullBody = getStrippedBody(doc)
  if (!bestSection || bestScore <= 0) {
    return fullBody.length > budget ? fullBody.slice(0, budget).trimEnd() + '…' : fullBody
  }

  const h = bestSection.heading && bestSection.heading !== '(intro)' ? `### ${bestSection.heading}\n` : ''
  const passageText = h + bestSection.body

  // 선택된 패시지가 너무 짧고 전체 본문이 훨씬 더 많은 내용을 가지고 있으면 전체 본문 사용
  // (예: 짧은 intro 섹션이 선택됐을 때 실제 내용 섹션들을 날리는 것 방지)
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

  let queueIdx = 0
  while (queueIdx < queue.length && visited.size < maxDocs) {
    const [docId, hop] = queue[queueIdx++]
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
 * 16000 chars ≈ ~4800 tokens — plenty of room within Claude's 200k context.
 * 조정 가이드: 응답 품질보다 커버리지가 중요하면 늘리고,
 * 비용/속도가 우선이면 줄이세요.
 */
const DEEP_CONTEXT_BUDGET = 16_000

/** Max content length per document by hop distance (chars) */
const HOP_CHAR_BUDGET = [1_500, 900, 500, 250] as const

/**
 * Personalized PageRank 기반 그래프 탐색으로 관련 문서 컨텍스트 수집.
 *
 * TF-IDF 시드에서 출발해 strength 가중 PPR을 실행 → 점수 높은 순 maxDocs개 선택.
 * BFS와 달리 hop 수 제한 없이 강하게 연결된 허브 문서를 자동으로 캡처합니다.
 *
 * 사용 시나리오: "이 주제와 관련된 인사이트", "프로젝트 피드백 주세요" 등
 * 여러 문서에 걸쳐 정보를 수집해야 하는 쿼리.
 *
 * @param maxHops    미사용 (API 호환성 유지 — PPR은 hop 개념 없음)
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
    logger.warn('[RAG] loadedDocuments is empty — vault not loaded')
    return ''
  }

  const { adjacency, docMap, getMetrics } = getCachedMaps(links, loadedDocuments)

  // WikiLink 없는 볼트 — 그래프 탐색 불가, TF-IDF 결과를 직접 포맷
  if (!links.length) {
    if (results.length === 0) return ''
    const parts: string[] = ['## Related documents (direct search)\n']
    let charCount = 20
    for (const r of results.slice(0, maxDocs)) {
      const doc = docMap.get(r.doc_id)
      if (!doc) continue
      const name = doc.filename.replace(/\.md$/i, '')
      const content = getDocContent(doc, 1200, queryTerms)
      if (!content) continue
      const entry = `[doc] ${name}\n${content}\n\n`
      if (charCount + entry.length > DEEP_CONTEXT_BUDGET) break
      parts.push(entry)
      charCount += entry.length
    }
    return parts.length <= 1 ? '' : parts.join('') + '\n'
  }

  // 시작 노드: 검색 결과 상위 문서들 (중복 제거) — 중간 배열 없이 Set 직접 구축
  const _startSet = new Set<string>()
  for (const r of results) { if (r.doc_id) _startSet.add(r.doc_id) }
  const startDocIds = [..._startSet]

  // 키워드 매칭이 빈약하면 허브 노드를 자동 보완 시드로 추가
  if (startDocIds.length < 2) {
    const hubIds = getHubDocIds(adjacency, 5)
    for (const id of hubIds) {
      if (!startDocIds.includes(id)) startDocIds.push(id)
      if (startDocIds.length >= 6) break
    }
  }

  if (startDocIds.length === 0) return ''

  // PPR 실행 — Web Worker에서 비동기 계산 (메인 스레드 블로킹 없음)
  const pprScores = await runPPRInWorker(startDocIds, links)

  // PPR 점수 기준 상위 maxDocs 선택 (점수 0 제외)
  // status: outdated/deprecated 문서는 점수 70% 감쇠 (최신성 버그 §18.1 대응)
  const seedSet = new Set(startDocIds)
  // filter×2 + map → 단일 루프: docMap 조회 1회, 중간 배열 3개 제거
  const _pprEntries: [string, number][] = []
  for (const [id, score] of pprScores) {
    if (score <= 0) continue
    const doc = docMap.get(id)
    // graph_weight: skip → BFS 탐색에서 완전 제외 (링크 전용 허브, 500+ outbound)
    if (doc?.graphWeight === 'skip') continue
    const decay = isOutdatedDoc(doc) ? 0.3 : 1.0
    // graph_weight: low → 링크 가중치 0.3 감쇠 (100-499 outbound links)
    const weightDecay = doc?.graphWeight === 'low' ? 0.15 : 1.0  // strengthened low decay (0.3→0.15)
    // Speaker affinity boost: doc.speaker matches current persona → +10%
    const speakerBoost = (currentSpeaker && currentSpeaker !== 'unknown' && doc?.speaker === currentSpeaker) ? 1.1 : 1.0
    _pprEntries.push([id, score * decay * weightDecay * speakerBoost])
  }
  _pprEntries.sort((a, b) => b[1] - a[1])
  const sorted = _pprEntries.slice(0, maxDocs)

  if (sorted.length === 0) return ''

  // visited Map for buildStructureHeader compatibility (seed=0, rest=1)
  const visited = new Map<string, number>(
    sorted.map(([id]) => [id, seedSet.has(id) ? 0 : 1])
  )

  // Yield to UI before PageRank + cluster computation
  await new Promise<void>(r => setTimeout(r, 0))

  // Structure header (PageRank + cluster overview)
  const structureHeader = await buildStructureHeader(visited, adjacency, links, loadedDocuments, docMap, getMetrics)

  // PPR rank-based labels and character budget
  // Top 3: core (1500 chars), ranks 4-8: related (900 chars), rank 9+: peripheral (500 chars)
  const parts: string[] = [structureHeader, '## Related documents (PPR traversal)\n']
  let charCount = structureHeader.length + 20
  let docHits = 0

  sorted.forEach(([docId, pprScore], rank) => {
    if (charCount >= DEEP_CONTEXT_BUDGET) return

    const doc = docMap.get(docId)
    if (!doc) return  // phantom node — skip

    // adaptive budget: allocate more budget to large docs (10K+ chars) (up to 2x)
    const docLen = doc.rawContent?.length ?? 0
    const baseBudget = rank < 3 ? 1_500 : rank < 8 ? 900 : 500
    const budget = docLen > 10_000
      ? Math.min(baseBudget * 2, Math.max(baseBudget, Math.floor(docLen * 0.03)))
      : baseBudget
    const label = seedSet.has(docId) ? 'core' : rank < 3 ? 'core' : rank < 8 ? 'related' : 'peripheral'
    const name = doc.filename.replace(/\.md$/i, '')
    const speaker = doc.speaker && doc.speaker !== 'unknown' ? ` (${doc.speaker})` : ''
    const dateLabel = getDocDateLabel(doc)
    const sourceLabel = doc.source ? ` [source: ${doc.source}]` : ''
    const typeLabel = doc.type ? ` [${doc.type}]` : ''
    const scorePct = Math.round(pprScore * 1000) / 10
    const outdatedLabel = (doc.status === 'outdated' || doc.status === 'deprecated')
      ? ` ⚠️outdated${doc.supersededBy ? `→${doc.supersededBy}` : ''}`
      : ''
    const header = `[${label}|PPR ${scorePct}]${outdatedLabel}${typeLabel} ${name}${speaker}${dateLabel ? ` [${dateLabel}]` : ''}${sourceLabel}`

    const content = getDocContent(doc, budget, queryTerms)
    const entry = `${header}\n${content}\n\n`
    if (charCount + entry.length > DEEP_CONTEXT_BUDGET) return

    parts.push(entry)
    charCount += entry.length
    docHits++
  })

  logger.debug(`[RAG] PPR complete: candidates=${sorted.length}, content included=${docHits}, total ${charCount} chars`)

  // Fall back to direct TF-IDF result formatting if no actual document content
  if (docHits === 0) {
    if (results.length === 0) return ''
    const fallback: string[] = ['## 관련 문서 (직접 검색)\n']
    let fallbackChars = 20
    for (const r of results.slice(0, maxDocs)) {
      const doc = docMap.get(r.doc_id)
      if (!doc) continue
      const content = getDocContent(doc, 1200, queryTerms)
      if (!content) continue
      const entry = `[direct] ${doc.filename.replace(/\.md$/i, '')}\n${content}\n\n`
      if (fallbackChars + entry.length > DEEP_CONTEXT_BUDGET) break
      fallback.push(entry)
      fallbackChars += entry.length
    }
    return fallback.length <= 1 ? '' : fallback.join('') + '\n'
  }

  return parts.join('') + '\n'
}

/**
 * Collects related context by BFS traversal of the graph starting from a specific document ID.
 *
 * Same as buildDeepGraphContext but completely bypasses keyword search.
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

  const recMap2 = new Map<string, number>()
  for (const id of visited.keys()) { const d = docMap.get(id); recMap2.set(id, d ? getContentDate(d) : 0) }
  const sorted = [...visited.entries()].sort((a, b) =>
    a[1] !== b[1] ? a[1] - b[1] : (recMap2.get(b[0]) ?? 0) - (recMap2.get(a[0]) ?? 0)
  )
  const hopLabel = ['selected', '1-hop', '2-hop', '3-hop']
  const parts: string[] = [structureHeader, '## Selected node related documents (graph traversal)\n']
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
    const sourceLabel = doc.source ? ` [source: ${doc.source}]` : ''
    const header = `[${label}] ${name}${speaker}${dateLabel ? ` [${dateLabel}]` : ''}${sourceLabel}`
    const content = getDocContent(doc, budget)
    const entry = `${header}\n${content}\n\n`
    if (charCount + entry.length > DEEP_CONTEXT_BUDGET) break
    parts.push(entry)
    charCount += entry.length
  }

  if (parts.length <= 1) return ''
  return parts.join('') + '\n'
}

// ── 3a-helper. Structure header generation ──────────────────────────────────

/**
 * Generates structural info of traversed documents as an AI context header.
 *
 * Includes:
 *  - Top PageRank hub documents
 *  - C. Per-cluster TF-IDF topic keyword labels
 *  - D. Bridge documents connecting multiple clusters
 *  - A. Hidden semantic connection pairs without WikiLinks
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

  // Top 5 PageRank (limited to traversed documents)
  const topDocs = [...visited.keys()]
    .map(id => ({ id, rank: pageRank.get(id) ?? 0 }))
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 5)
    .map(({ id }) => docMap.get(id)?.filename.replace(/\.md$/i, '') ?? id)

  // C. Per-cluster document groups + TF-IDF topic keyword labels (expensive on cache miss — yield to UI)
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
      return `  • Cluster ${cId + 1}${topicLabel} (${names.length}): ${names.slice(0, 5).join(', ')}${names.length > 5 ? ' …' : ''}`
    })
    .join('\n')

  // D. Bridge node detection (limited to traversed docs, top 3)
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

  // A. Implicit link discovery (semantic similarity pairs without WikiLinks, top 4) — expensive on cache miss, yield to UI
  await new Promise<void>(r => setTimeout(r, 0))
  const implicitLinks = tfidfIndex.findImplicitLinks(adjacency, 4, 0.25)
    .map(l => {
      const a = l.filenameA.replace(/\.md$/i, '')
      const b = l.filenameB.replace(/\.md$/i, '')
      const pct = Math.round(l.similarity * 100)
      return `  • "${a}" ↔ "${b}" (similarity ${pct}%)`
    })

  const lines: string[] = [
    `## Project structure overview`,
    `Total clusters: ${clusterCount} | Explored documents: ${visited.size}`,
    `Key hub documents (top PageRank): ${topDocs.join(', ')}`,
  ]

  if (clusterLines) {
    lines.push(`\nCluster topic groups:`)
    lines.push(clusterLines)
  }

  if (bridges.length > 0) {
    lines.push(`\nKey bridge documents (multi-cluster connection): ${bridges.join(', ')}`)
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
 * Returns top N hub document IDs by degree (connectivity).
 * Hub nodes are connected to many documents, making them suitable as full traversal starting points.
 */
function getHubDocIds(adjacency: Map<string, string[]>, topN: number = 10): string[] {
  return [...adjacency.entries()]
    .filter(([, neighbors]) => neighbors.length > 0)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, topN)
    .map(([id]) => id)
}

/**
 * Collects context by BFS traversal of the full graph starting from hub nodes.
 *
 * Used for broad queries like "full project insight", "overall feedback" etc.
 * or when the AI analysis button is pressed without node selection.
 *
 * @param maxDocs   Maximum documents to collect (default 35)
 * @param maxHops   BFS 최대 홉 수 (기본 4)
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

  await new Promise<void>(r => setTimeout(r, 0))
  const structureHeader = await buildStructureHeader(visited, adjacency, links, loadedDocuments, docMap, getMetrics)

  const GLOBAL_BUDGET = 24000
  const recMap3 = new Map<string, number>()
  for (const id of visited.keys()) { const d = docMap.get(id); recMap3.set(id, d ? getContentDate(d) : 0) }
  const sorted = [...visited.entries()].sort((a, b) =>
    a[1] !== b[1] ? a[1] - b[1] : (recMap3.get(b[0]) ?? 0) - (recMap3.get(a[0]) ?? 0)
  )
  const parts: string[] = [structureHeader, '## 전체 프로젝트 관련 문서 (허브 기반 탐색)\n']
  let charCount = structureHeader.length + 28

  for (const [docId, hop] of sorted) {
    if (charCount >= GLOBAL_BUDGET) break
    const doc = docMap.get(docId)
    if (!doc) continue

    const budget = HOP_CHAR_BUDGET[Math.min(hop, HOP_CHAR_BUDGET.length - 1)] ?? 80
    const name = doc.filename.replace(/\.md$/i, '')
    const speaker = doc.speaker && doc.speaker !== 'unknown' ? ` (${doc.speaker})` : ''
    const dateLabel = getDocDateLabel(doc)
    const header = `[탐색] ${name}${speaker}${dateLabel ? ` [${dateLabel}]` : ''}`
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
 *   ## 관련 문서
 *   [문서] filename > heading (speaker)
 *   content...
 *
 *   ### 연결 문서
 *   [연결] filename > heading
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

  const parts: string[] = ['## 관련 문서\n']
  let charCount = 10 // header length

  for (const r of results) {
    const header = [
      `[문서]`,
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
    parts.push('### 연결 문서\n')
    charCount += 12

    for (const n of neighbors) {
      const nHeader = `[연결] ${n.filename} > ${n.heading}`
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
