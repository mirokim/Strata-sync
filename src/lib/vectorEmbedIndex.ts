/**
 * vectorEmbedIndex.ts — Google Gemini 벡터 임베딩 인덱스
 *
 * BM25 검색 결과를 벡터 유사도로 reranking합니다.
 * 문서 임베딩은 볼트 로드 후 백그라운드에서 빌드되며 IndexedDB에 캐시됩니다.
 *
 * 사용 흐름:
 *   1. vault 로드 후 → buildInBackground(docs, apiKey, vaultPath, fingerprint)
 *   2. 검색 시 → hybridRerank(bm25Results, query, apiKey, topK)
 */

import type { LoadedDocument, SearchResult } from '@/types'
import { loadVectorEmbedCache, saveVectorEmbedCache } from './vectorEmbedCache'
import { logger } from './logger'

// ── 내부 상태 ────────────────────────────────────────────────────────────────

interface EmbedState {
  embeddings: Map<string, number[]>  // docId → embedding vector
  built: boolean
  building: boolean
  progress: number  // 0~100
  lastError: string | null
  generation: number  // reset() 호출마다 증가 — 구버전 빌드가 결과를 덮어쓰지 못하게
}

const _state: EmbedState = {
  embeddings: new Map(),
  built: false,
  building: false,
  progress: 0,
  lastError: null,
  generation: 0,
}

// ── 문서 텍스트 추출 ──────────────────────────────────────────────────────────

function docText(doc: LoadedDocument): string {
  return [
    doc.filename.replace(/\.md$/i, ''),
    doc.tags?.join(' ') ?? '',
    doc.speaker ?? '',
    ...doc.sections.map(s => `${s.heading} ${s.body}`),
    doc.rawContent ?? '',
  ].join(' ').slice(0, 3000)
}

// ── Google Gemini 임베딩 API (gemini-embedding-001, 3072차원) ─────────────────

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

/** texts 배열을 동시 5개씩 병렬 처리 */
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

// ── 코사인 유사도 ─────────────────────────────────────────────────────────────

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
   * 볼트 로드 후 백그라운드에서 임베딩을 빌드합니다.
   * - IndexedDB 캐시 히트 시: API 호출 없이 즉시 복원
   * - 캐시 미스 시: Gemini API로 배치 임베딩 생성 후 캐시 저장
   * - generation 체크: reset() 이후 시작된 이전 빌드가 결과를 덮어쓰지 못하게 방어
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
    const myGen = _state.generation  // 이 빌드의 세대 번호

    try {
      // 캐시 확인
      const cached = await loadVectorEmbedCache(vaultPath, fingerprint)
      if (_state.generation !== myGen) return  // 이미 reset() 됨
      if (cached && cached.size > 0) {
        _state.embeddings = cached
        _state.built = true
        _state.progress = 100
        logger.debug(`[vector] 캐시 복원: ${cached.size}개 문서`)
        return
      }

      // 새로 빌드: 배치 단위 API 호출
      const BATCH = 20
      const newEmbeddings = new Map<string, number[]>()
      let processed = 0
      let firstError: string | null = null

      for (let i = 0; i < docs.length; i += BATCH) {
        if (_state.generation !== myGen) return  // reset() 됨 → 중단

        const batch = docs.slice(i, i + BATCH)
        const texts = batch.map(docText)

        try {
          const vecs = await embedBatch(texts, apiKey)
          for (let j = 0; j < batch.length; j++) {
            newEmbeddings.set(batch[j].id, vecs[j])
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          logger.warn(`[vector] 배치 임베딩 실패 (${i}~${i + BATCH}):`, msg)
          if (!firstError) firstError = msg
          // 첫 배치 실패 시 중단 — 키 오류 가능성
          if (i === 0) {
            _state.lastError = `API 오류: ${msg}`
            break
          }
        }

        processed += batch.length
        _state.progress = Math.round((processed / docs.length) * 100)

        // Rate limit 방지
        if (i + BATCH < docs.length) await new Promise(r => setTimeout(r, 100))
      }

      if (_state.generation !== myGen) return  // 최종 저장 전 마지막 체크

      _state.embeddings = newEmbeddings
      _state.built = newEmbeddings.size > 0
      _state.progress = 100

      if (newEmbeddings.size > 0) {
        if (firstError) _state.lastError = `일부 실패 (${newEmbeddings.size}개 성공): ${firstError}`
        saveVectorEmbedCache(vaultPath, fingerprint, newEmbeddings)
          .catch((e: unknown) => logger.warn('[vector] 캐시 저장 실패:', e))
        logger.debug(`[vector] 임베딩 완료: ${newEmbeddings.size}개 문서`)
      } else if (!_state.lastError) {
        _state.lastError = firstError ?? '알 수 없는 오류 — 브라우저 콘솔 확인'
      }
    } finally {
      if (_state.generation === myGen) _state.building = false
    }
  },

  /**
   * BM25 결과를 벡터 유사도로 reranking합니다.
   * - 40% BM25 정규화 점수 + 60% 벡터 코사인 유사도
   * - 임베딩 인덱스 없거나 API 호출 실패 시 원본 BM25 결과 반환
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
   * 전체 임베딩 대상 벡터 검색 (순수 의미 유사도).
   * BM25 후보 없이 모든 문서에 대해 코사인 유사도를 계산해 top-K 반환.
   * 인덱스 미빌드 또는 API 실패 시 null 반환 → 호출 측에서 BM25 폴백.
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

    // 문서 메타데이터 맵 (id → doc)
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

  /** 볼트 전환 시 상태 초기화 */
  reset(): void {
    _state.generation++  // 진행 중인 빌드를 무효화
    _state.embeddings = new Map()
    _state.built = false
    _state.building = false
    _state.progress = 0
    _state.lastError = null
  },
}
