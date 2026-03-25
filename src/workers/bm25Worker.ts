/**
 * bm25Worker.ts — BM25 index build + implicit link calculation off the main thread
 *
 * Message protocol:
 *   IN  { type: 'build',     docs, adjacency, threshold, topN, fingerprint }
 *         -> BM25 build + findImplicitLinks -> { type: 'done', serialized, implicitLinks }
 *   IN  { type: 'findLinks', serialized, adjacency, threshold, topN }
 *         -> Cache restore + findImplicitLinks -> { type: 'done', implicitLinks }
 *   OUT { type: 'error', message }
 */

import { TfIdfIndex } from '@/lib/graphAnalysis'
import type { SerializedTfIdf, ImplicitLink } from '@/lib/graphAnalysis'
import type { LoadedDocument } from '@/types'

type InMsg =
  | { type: 'build';      requestId: string; docs: LoadedDocument[]; adjacency: [string, string[]][]; threshold: number; topN: number; fingerprint: string }
  | { type: 'findLinks';  requestId: string; serialized: SerializedTfIdf; adjacency: [string, string[]][]; threshold: number; topN: number }
  | { type: 'updateDoc';  requestId: string; serialized: SerializedTfIdf; doc: LoadedDocument; adjacency: [string, string[]][]; threshold: number; topN: number; fingerprint: string }

type OutMsg =
  | { type: 'done';  requestId: string; serialized?: SerializedTfIdf; implicitLinks: ImplicitLink[] }
  | { type: 'error'; requestId: string; message: string }

self.onmessage = (e: MessageEvent<InMsg>) => {
  const { requestId } = e.data
  try {
    const msg = e.data
    const index = new TfIdfIndex()
    let serialized: SerializedTfIdf | undefined

    if (msg.type === 'build') {
      index.build(msg.docs)
      serialized = index.serialize(msg.fingerprint)
    } else if (msg.type === 'updateDoc') {
      // Incremental update: restore existing index, then rebuild single document
      index.restore(msg.serialized)
      index.updateDoc(msg.doc)
      serialized = index.serialize(msg.fingerprint)
    } else {
      index.restore(msg.serialized)
    }

    const adj = new Map(msg.adjacency)
    const implicitLinks = index.findImplicitLinks(adj, msg.topN, msg.threshold)

    const result: OutMsg = { type: 'done', requestId, implicitLinks }
    if (serialized) result.serialized = serialized
    self.postMessage(result)
  } catch (err) {
    self.postMessage({ type: 'error', requestId, message: String(err) } satisfies OutMsg)
  }
}
