/**
 * pprWorkerClient.ts — PPR Web Worker client
 *
 * Delegates PPR (Personalized PageRank) computation to a worker thread.
 * The worker is lazily created on first call and reused for the app's lifetime.
 */

import type { GraphLink } from '@/types'
import { DEFAULT_LINK_STRENGTH } from '@/lib/constants'

type WorkerResult =
  | { type: 'done';  requestId: string; scores: [string, number][] }
  | { type: 'error'; requestId: string; message: string }

let _worker: Worker | null = null
let _reqCounter = 0
const _pending = new Map<string, (err: Error) => void>()

function getWorker(): Worker {
  if (!_worker) {
    _worker = new Worker(new URL('../workers/pprWorker.ts', import.meta.url), { type: 'module' })
    _worker.onerror = (e) => {
      console.error('[pprWorker] Worker error:', e)
      _worker = null
      const err = new Error(`PPR Worker error: ${e.message ?? 'unknown'}`)
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
      if (e.data.requestId !== requestId) return
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
 * Takes GraphLink[] (source/target may be string | GraphNode) and runs
 * PPR computation in the worker, returning the result Map.
 */
export function runPPRInWorker(
  seedIds: string[],
  links: GraphLink[],
  alpha = 0.15,
  iterations = 15,
): Promise<Map<string, number>> {
  // GraphLink source/target can be string | GraphNode — normalize to string before sending to worker
  const normalizedLinks = links.map(l => ({
    source: typeof l.source === 'string' ? l.source : (l.source as { id: string }).id,
    target: typeof l.target === 'string' ? l.target : (l.target as { id: string }).id,
    strength: l.strength ?? DEFAULT_LINK_STRENGTH,
  }))

  return callWorker(
    { type: 'ppr', seedIds, links: normalizedLinks, alpha, iterations },
    (r) => new Map(r.scores),
  )
}
