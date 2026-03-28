/**
 * vectorEmbedIndex.ts — Google Gemini vector embedding index
 *
 * Reranks BM25 search results using vector similarity.
 * Document embeddings are built in the background after vault load and cached in IndexedDB.
 *
 * Usage flow:
 *   1. After vault load → buildInBackground(docs, apiKey, vaultPath, fingerprint)
 *   2. During search → hybridRerank(bm25Results, query, apiKey, topK)
 */

import type { LoadedDocument, SearchResult } from '@/types'
import { loadVectorEmbedCache, saveVectorEmbedCache } from './vectorEmbedCache'
import { logger } from './logger'

// ── Internal state ────────────────────────────────────────────────────────────

interface EmbedState {
  embeddings: Map<string, number[]>  // docId → embedding vector
  built: boolean
  building: boolean
  progress: number  // 0~100
  lastError: string | null
  generation: number  // increments on each reset() call — prevents stale builds from overwriting results
}

const _state: EmbedState = {
  embeddings: new Map(),
  built: false,
  building: false,
  progress: 0,
  lastError: null,
  generation: 0,
}

// ── Document text extraction ──────────────────────────────────────────────────

function docText(doc: LoadedDocument): string {
  return [
    doc.filename.replace(/\.md$/i, ''),
    doc.tags?.join(' ') ?? '',
    doc.speaker ?? '',
    ...doc.sections.map(s => `${s.heading} ${s.body}`),
    doc.rawContent ?? '',
  ].join(' ').slice(0, 3000)
}

// ── Google Gemini embedding API (gemini-embedding-001, 3072 dimensions) ──────

async function embedSingle(text: string, apiKey: string): Promise<number[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      model: 'models/gemini-embedding-001',
      content: { parts: [{ text }] },
    }),
  })
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}))
    throw new Error(`Gemini embeddings ${res.status}: ${JSON.stringify(errBody)}`)
  }
  const json = await res.json() as { embedding: { values: number[] } }
  return json.embedding.values
}

/** Process texts array in parallel batches of 5 */
async function embedBatch(texts: string[], apiKey: string): Promise<number[][]> {
  const CONCURRENCY = 5
  const results: number[][] = new Array(texts.length)
  for (let i = 0; i < texts.length; i += CONCURRENCY) {
    const chunk = texts.slice(i, i + CONCURRENCY)
    const vecs = await Promise.all(chunk.map(t => embedSingle(t, apiKey)))
    for (let j = 0; j < chunk.length; j++) results[i + j] = vecs[j]
  }
  return results
}

// ── Cosine similarity ─────────────────────────────────────────────────────────

function cosineSim(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom === 0 ? 0 : dot / denom
}

// ── Public API (singleton) ────────────────────────────────────────────────────

export const vectorEmbedIndex = {
  get isBuilt(): boolean { return _state.built },
  get isBuilding(): boolean { return _state.building },
  get progress(): number { return _state.progress },
  get size(): number { return _state.embeddings.size },
  get lastError(): string | null { return _state.lastError },

  /**
   * Builds embeddings in the background after vault load.
   * - IndexedDB cache hit: immediately restores without API calls
   * - Cache miss: creates batch embeddings via Gemini API then saves to cache
   * - Generation check: prevents stale builds started before reset() from overwriting results
   */
  async buildInBackground(
    docs: LoadedDocument[],
    apiKey: string,
    vaultPath: string,
    fingerprint: string,
  ): Promise<void> {
    if (_state.building) return
    _state.building = true
    _state.progress = 0
    _state.lastError = null
    const myGen = _state.generation  // generation number for this build

    try {
      // Check cache
      const cached = await loadVectorEmbedCache(vaultPath, fingerprint)
      if (_state.generation !== myGen) return  // already reset()
      if (cached && cached.size > 0) {
        _state.embeddings = cached
        _state.built = true
        _state.progress = 100
        logger.debug(`[vector] cache restored: ${cached.size} docs`)
        return
      }

      // Fresh build: batch API calls
      const BATCH = 20
      const newEmbeddings = new Map<string, number[]>()
      let processed = 0
      let firstError: string | null = null

      for (let i = 0; i < docs.length; i += BATCH) {
        if (_state.generation !== myGen) return  // reset() called → abort

        const batch = docs.slice(i, i + BATCH)
        const texts = batch.map(docText)

        try {
          const vecs = await embedBatch(texts, apiKey)
          for (let j = 0; j < batch.length; j++) {
            newEmbeddings.set(batch[j].id, vecs[j])
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          logger.warn(`[vector] batch embedding failed (${i}~${i + BATCH}):`, msg)
          if (!firstError) firstError = msg
          // Abort on first batch failure — likely key error
          if (i === 0) {
            _state.lastError = `API error: ${msg}`
            break
          }
        }

        processed += batch.length
        _state.progress = Math.round((processed / docs.length) * 100)

        // Rate limit prevention
        if (i + BATCH < docs.length) await new Promise(r => setTimeout(r, 100))
      }

      if (_state.generation !== myGen) return  // final check before saving

      _state.embeddings = newEmbeddings
      _state.built = newEmbeddings.size > 0
      _state.progress = 100

      if (newEmbeddings.size > 0) {
        if (firstError) _state.lastError = `Partial failure (${newEmbeddings.size} succeeded): ${firstError}`
        saveVectorEmbedCache(vaultPath, fingerprint, newEmbeddings)
          .catch((e: unknown) => logger.warn('[vector] cache save failed:', e))
        logger.debug(`[vector] embedding complete: ${newEmbeddings.size} docs`)
      } else if (!_state.lastError) {
        _state.lastError = firstError ?? 'Unknown error — check browser console'
      }
    } finally {
      if (_state.generation === myGen) _state.building = false
    }
  },

  /**
   * Reranks BM25 results using vector similarity.
   * - 40% normalized BM25 score + 60% vector cosine similarity
   * - Returns original BM25 results when embedding index is unavailable or API call fails
   */
  async hybridRerank(
    results: SearchResult[],
    query: string,
    apiKey: string,
    topK: number,
  ): Promise<SearchResult[]> {
    if (!_state.built || _state.embeddings.size === 0 || results.length === 0) {
      return results.slice(0, topK)
    }

    let queryVec: number[]
    try {
      const vecs = await embedBatch([query], apiKey)
      queryVec = vecs[0]
    } catch {
      return results.slice(0, topK)
    }

    const maxBm25 = results[0].score || 1
    return results
      .map(r => {
        const docVec = _state.embeddings.get(r.doc_id)
        const vecSim = docVec ? cosineSim(queryVec, docVec) : 0
        return { ...r, score: (r.score / maxBm25) * 0.4 + vecSim * 0.6 }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
  },

  /**
   * Full vector search across all embeddings (pure semantic similarity).
   * Computes cosine similarity against all documents without BM25 candidates and returns top-K.
   * Returns null when index is not built or API fails → caller falls back to BM25.
   */
  async fullVectorSearch(
    query: string,
    apiKey: string,
    topK: number,
    docs: LoadedDocument[],
  ): Promise<SearchResult[] | null> {
    if (!_state.built || _state.embeddings.size === 0) return null

    let queryVec: number[]
    try {
      queryVec = (await embedBatch([query], apiKey))[0]
    } catch {
      return null
    }

    // Document metadata map (id → doc)
    const docMap = new Map(docs.map(d => [d.id, d]))

    const scored: SearchResult[] = []
    for (const [docId, docVec] of _state.embeddings) {
      const sim = cosineSim(queryVec, docVec)
      if (sim <= 0) continue
      const doc = docMap.get(docId)
      if (!doc) continue
      scored.push({
        doc_id: docId,
        filename: doc.filename,
        section_id: null,
        heading: null,
        speaker: doc.speaker ?? '',
        content: doc.sections[0]?.body ?? doc.rawContent?.slice(0, 500) ?? '',
        score: sim,
        tags: doc.tags ?? [],
      })
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
  },

  /** Reset state when switching vaults */
  reset(): void {
    _state.generation++  // invalidate in-progress builds
    _state.embeddings = new Map()
    _state.built = false
    _state.building = false
    _state.progress = 0
    _state.lastError = null
  },
}
