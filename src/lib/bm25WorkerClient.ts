/**
 * bm25WorkerClient.ts — BM25 Web Worker client
 *
 * Delegates heavy BM25 index building / O(N^2) implicit link computation
 * to a worker thread. The worker is lazily created on first call and
 * reused for the app's lifetime.
 */

import type { SerializedTfIdf, ImplicitLink } from './graphAnalysis'
import type { LoadedDocument } from '@/types'

type WorkerResult =
  | { type: 'done';  requestId: string; serialized?: SerializedTfIdf; implicitLinks: ImplicitLink[] }
  | { type: 'error'; requestId: string; message: string }

let _worker: Worker | null = null
let _reqCounter = 0
const _pending = new Map<string, (err: Error) => void>()  // requestId -> reject

function getWorker(): Worker {
  if (!_worker) {
    _worker = new Worker(new URL('../workers/bm25Worker.ts', import.meta.url), { type: 'module' })
    _worker.onerror = (e) => {
      console.error('[bm25Worker] Worker error:', e)
      _worker = null  // Recreate on next call
      // Reject all pending promises to prevent infinite hang
      const err = new Error(`Worker error: ${e.message ?? 'unknown'}`)
      for (const reject of _pending.values()) reject(err)
      _pending.clear()
    }
  }
  return _worker
}

type DoneMsg = Extract<WorkerResult, { type: 'done' }>

function callWorker<T>(msg: object, extract: (r: DoneMsg) => T): Promise<T> {
  return new Promise((resolve, reject) => {
    const requestId = String(++_reqCounter)
    const worker = getWorker()
    _pending.set(requestId, reject)
    const handler = (e: MessageEvent<WorkerResult>) => {
      if (e.data.requestId !== requestId) return  // Response for a different request — ignore
      worker.removeEventListener('message', handler)
      _pending.delete(requestId)
      if (e.data.type === 'error') {
        reject(new Error(e.data.message))
      } else {
        resolve(extract(e.data as DoneMsg))
      }
    }
    worker.addEventListener('message', handler)
    worker.postMessage({ ...msg, requestId })
  })
}

/**
 * On cache miss: takes LoadedDocument[] and runs BM25 build + findImplicitLinks
 * in the worker. Returns the serialized index and implicit links together.
 */
export function buildAndFindLinks(
  docs: LoadedDocument[],
  adjacency: Map<string, string[]>,
  fingerprint: string,
  threshold = 0.25,
  topN = 6,
): Promise<{ serialized: SerializedTfIdf; implicitLinks: ImplicitLink[] }> {
  const adj = [...adjacency.entries()]
  return callWorker(
    { type: 'build', docs, adjacency: adj, threshold, topN, fingerprint },
    (r) => {
      if (!r.serialized) throw new Error('Worker response missing serialized data')
      return { serialized: r.serialized, implicitLinks: r.implicitLinks }
    },
  )
}

/**
 * Single document incremental update — reprocesses one changed file and
 * returns the new index + implicit links.
 */
export function updateDocInWorker(
  serialized: SerializedTfIdf,
  doc: LoadedDocument,
  adjacency: Map<string, string[]>,
  fingerprint: string,
  threshold = 0.25,
  topN = 6,
): Promise<{ serialized: SerializedTfIdf; implicitLinks: ImplicitLink[] }> {
  const adj = [...adjacency.entries()]
  return callWorker(
    { type: 'updateDoc', serialized, doc, adjacency: adj, threshold, topN, fingerprint },
    (r) => {
      if (!r.serialized) throw new Error('Worker response missing serialized data')
      return { serialized: r.serialized, implicitLinks: r.implicitLinks }
    },
  )
}

/**
 * On cache hit: takes an already-serialized index and runs only findImplicitLinks
 * in the worker.
 *
 * Only sends bm25Vec + bm25Norm + id to the worker — strips idf Map, termFreqs,
 * docLen, avgdl to minimize postMessage structured clone size.
 * (On large vaults: ~20MB -> ~10MB, reduces main thread serialization time)
 */
export function findLinksFromCache(
  serialized: SerializedTfIdf,
  adjacency: Map<string, string[]>,
  threshold = 0.25,
  topN = 6,
): Promise<ImplicitLink[]> {
  const adj = [...adjacency.entries()]
  // Keep only fields needed by findImplicitLinks, strip the rest
  const slim: SerializedTfIdf = {
    schemaVersion: serialized.schemaVersion,
    fingerprint: serialized.fingerprint,
    idf: [],       // Not used by findImplicitLinks
    avgdl: 0,      // Not used by findImplicitLinks
    docs: serialized.docs.map(d => ({
      docId: d.docId,
      filename: d.filename,
      speaker: d.speaker,
      termFreqs: [],         // Not used by findImplicitLinks
      docLen: 0,             // Not used by findImplicitLinks
      bm25Vec: d.bm25Vec,    // Needed for cosine similarity
      bm25Norm: d.bm25Norm,  // Needed for normalization
    })),
  }
  return callWorker(
    { type: 'findLinks', serialized: slim, adjacency: adj, threshold, topN },
    (r) => r.implicitLinks,
  )
}
