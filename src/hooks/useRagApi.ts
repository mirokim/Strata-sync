/**
 * useRagApi.ts - Hook for handling HTTP RAG requests from the Slack bot
 *
 * When Electron main.cjs's HTTP server (port 7331) sends a rag:search IPC,
 * searches using TF-IDF + directVaultSearch and returns results.
 */
import { useEffect } from 'react'
import { useVaultStore } from '@/stores/vaultStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { tfidfIndex } from '@/lib/graphAnalysis'
import { directVaultSearch } from '@/lib/graphRAG'
import { generateSlackAnswer } from '@/services/llmClient'
import type { RagDocResult } from '@/vite-env'

export function useRagApi() {
  useEffect(() => {
    if (!window.ragAPI) return

    const cleanup = window.ragAPI.onSearch(({ requestId, query, topN }) => {
      try {
        const docs = useVaultStore.getState().loadedDocuments
        if (!docs || docs.length === 0) {
          window.ragAPI!.sendResult(requestId, [])
          return
        }

        // Build TF-IDF index if not yet built
        if (!tfidfIndex.isBuilt) {
          tfidfIndex.build(docs)
        }

        // Merge TF-IDF search + direct string search results
        const tfidfHits = tfidfIndex.search(query, topN)
        const directHits = directVaultSearch(query, topN)

        // Dedup by docId -- TfIdfResult uses docId, SearchResult uses doc_id
        const scoreMap = new Map<string, number>()
        for (const r of tfidfHits) {
          const prev = scoreMap.get(r.docId) ?? -1
          if (r.score > prev) scoreMap.set(r.docId, r.score)
        }
        for (const r of directHits) {
          const prev = scoreMap.get(r.doc_id) ?? -1
          if (r.score > prev) scoreMap.set(r.doc_id, r.score)
        }

        const sorted = [...scoreMap.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, topN)

        const docMap = new Map(docs.map(d => [d.id, d]))
        const results: RagDocResult[] = []

        for (const [docId, score] of sorted) {
          const doc = docMap.get(docId)
          if (!doc) continue
          results.push({
            doc_id:   docId,
            filename: doc.filename,
            stem:     doc.filename.replace(/\.md$/i, ''),
            title:    doc.filename.replace(/\.md$/i, ''),
            date:     doc.date  || '',
            tags:     doc.tags  || [],
            body:     (doc.rawContent || '').slice(0, 2000),
            score,
          })
        }

        window.ragAPI!.sendResult(requestId, results)
      } catch (err) {
        console.error('[useRagApi] search error:', err)
        window.ragAPI!.sendResult(requestId, [])
      }
    })

    // Handle settings requests
    const cleanupSettings = window.ragAPI.onGetSettings(({ requestId }) => {
      const { personaModels } = useSettingsStore.getState()
      window.ragAPI!.sendResult(requestId, { personaModels })
    })

    // Handle full answer generation (Slack /ask endpoint)
    const cleanupAsk = window.ragAPI.onAsk(async ({ requestId, query, directorId, history, images }) => {
      try {
        const answer = await generateSlackAnswer(query, directorId, history ?? [], images)
        window.ragAPI!.sendResult(requestId, { answer })
      } catch (err) {
        console.error('[useRagApi] ask error:', err)
        window.ragAPI!.sendResult(requestId, { answer: '' })
      }
    })

    return () => { cleanup(); cleanupSettings(); cleanupAsk() }
  }, [])
}
