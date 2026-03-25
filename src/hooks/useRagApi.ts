/**
 * useRagApi.ts — Hook for handling HTTP RAG requests from the Slack bot
 *
 * When Electron main.cjs's HTTP server (port 7331) sends a rag:search IPC,
 * searches using TF-IDF + directVaultSearch and returns results.
 */
import { useEffect, useRef } from 'react'
import { useVaultStore } from '@/stores/vaultStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { tfidfIndex } from '@/lib/graphAnalysis'
import { directVaultSearch } from '@/lib/graphRAG'
import { generateSlackAnswer } from '@/services/llmClient'
import { PERSONA_PROMPTS } from '@/lib/personaPrompts'
import type { RagDocResult } from '@/vite-env'
import { runSimulation } from '@/services/mirofish/simulationEngine'
import { generateReport } from '@/services/mirofish/reportGenerator'
import { generatePersonas } from '@/services/mirofish/personaGenerator'
import { useMiroStore } from '@/stores/miroStore'
import type { MirofishPersona, MirofishPost } from '@/services/mirofish/types'

/**
 * Strips meta-instruction expressions from the search query.
 * Prevents BM25/TF-IDF from being contaminated by common vault words
 * like "report", "analysis", "direction".
 * Same logic as bot.py's _clean_search_query.
 */
function cleanSearchQuery(query: string): string {
  let q = query.trim()
  // 1. Compound meta-verbs (Korean): "analyze", "organize", "suggest", etc.
  q = q.replace(/\s*(분석|정리|요약|검토|설명|비교|제안|작성|소개|추천|추출|뽑아)(해줘|해주세요|해봐줘|해봐|줘|주세요|해)\s*$/i, '')
  // 2. Meta-noun + action verb (Korean): "write a report", "create a report"
  q = q.replace(/\s*(보고서|리포트|report)\s*\S*(써|만들|작성)[가-힣\s]*$/i, '')
  // 3. Pure request endings (Korean): "tell me", "find for me", etc.
  q = q.replace(/\s*(알려줘|알려주세요|찾아줘|찾아주세요|말해줘|말해주세요|해줘|해주세요|줘|주세요|부탁해|부탁합니다)\s*$/i, '')
  return q.trim() || query.trim()
}

export function useRagApi() {
  const mirofishInFlightRef = useRef(false)

  useEffect(() => {
    if (!window.ragAPI) return

    const cleanup = window.ragAPI.onSearch(({ requestId, query, topN }) => {
      try {
        const api = window.ragAPI
        if (!api) return  // Guard against destroyed preload context
        const docs = useVaultStore.getState().loadedDocuments
        if (!docs || !docs.length) {
          api.sendResult(requestId, [])
          return
        }

        // Build TF-IDF index if not yet built
        if (!tfidfIndex.isBuilt) {
          tfidfIndex.build(docs)
        }

        // Strip meta-instruction expressions before search (prevents BM25/TF-IDF contamination)
        const searchQuery = cleanSearchQuery(query)

        // Merge TF-IDF search + direct string search results
        // TfIdfResult uses `docId`; SearchResult uses `doc_id` — normalize to doc_id
        const tfidfHits = tfidfIndex.search(searchQuery, topN).map(r => ({ doc_id: r.docId, score: r.score }))
        const directHits = directVaultSearch(searchQuery, topN)

        // Dedup by doc_id, keeping the highest score
        const scoreMap = new Map<string, number>()
        for (const r of [...tfidfHits, ...directHits]) {
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
            title:    doc.title || doc.filename,
            date:     doc.date  || '',
            tags:     doc.tags  || [],
            body:     (doc.rawContent || '').slice(0, 2000),
            score,
          })
        }

        // Date boosting: if query contains "latest/recent" or current year,
        // boost recent docs (BM25 is date-unaware, so short recent docs need help)
        const curYear  = String(new Date().getFullYear())
        const prevYear = String(new Date().getFullYear() - 1)
        if (/최신|최근|latest|recent/i.test(query) || query.includes(curYear)) {
          results.sort((a, b) => {
            const ba = a.date.includes(curYear) ? 2 : a.date.includes(prevYear) ? 1 : 0
            const bb = b.date.includes(curYear) ? 2 : b.date.includes(prevYear) ? 1 : 0
            return bb !== ba ? bb - ba : b.score - a.score
          })
        }

        api.sendResult(requestId, results)
      } catch (err) {
        console.error('[useRagApi] search error:', err)
        window.ragAPI?.sendResult(requestId, [])
      }
    })

    // Handle settings requests
    const cleanupSettings = window.ragAPI.onGetSettings(({ requestId }) => {
      const { personaModels, personaPromptOverrides, selfReview, nAgents, apiKeys } = useSettingsStore.getState()
      const s = (id: keyof typeof PERSONA_PROMPTS) =>
        personaPromptOverrides[id] || PERSONA_PROMPTS[id]
      const personas = {
        chief: { name: 'PM',                  emoji: '🎯', system: s('chief_director') },
        art:   { name: 'Art Director',         emoji: '🎨', system: s('art_director')   },
        spec:  { name: 'Planning Director',    emoji: '📐', system: s('plan_director')  },
        tech:  { name: 'Programming Director', emoji: '⚙️', system: s('prog_director') },
      }
      const { imageDirectPass } = useMiroStore.getState().config
      const { scheduledTopics, presets } = useMiroStore.getState()
      window.ragAPI?.sendResult(requestId, { personaModels, personas, imageDirectPass, scheduledTopics, presets, selfReview, nAgents, apiKeys })
    })

    // Handle full answer generation (Slack /ask endpoint)
    const cleanupAsk = window.ragAPI.onAsk(async ({ requestId, query, directorId, history, images }) => {
      try {
        const result = await generateSlackAnswer(query, directorId, history ?? [], images)
        window.ragAPI?.sendResult(requestId, result)
      } catch (err) {
        console.error('[useRagApi] ask error:', err)
        window.ragAPI?.sendResult(requestId, { answer: '', imagePaths: [] })
      }
    })

    // Handle explicit image search (Slack /images endpoint)
    const cleanupImages = window.ragAPI.onGetImages?.(({ requestId, query }) => {
      const { imagePathRegistry, loadedDocuments } = useVaultStore.getState()
      if (!imagePathRegistry) {
        window.ragAPI?.sendResult(requestId, { paths: [] })
        return
      }
      const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 1)
      const seen = new Set<string>()
      const paths: string[] = []

      // Priority 1: collect imageRefs from documents matching query words
      if (loadedDocuments) {
        const matchingDocs = loadedDocuments.filter(doc => {
          const text = (doc.filename + ' ' + (doc.rawContent ?? '')).toLowerCase()
          return words.some(w => text.includes(w))
        })
        for (const doc of matchingDocs) {
          for (const ref of doc.imageRefs ?? []) {
            const basename = ref.split(/[/\\]/).pop() ?? ref
            const entry = imagePathRegistry[ref] ?? imagePathRegistry[basename]
            if (entry?.absolutePath && !seen.has(entry.absolutePath)) {
              seen.add(entry.absolutePath)
              paths.push(entry.absolutePath)
              if (paths.length >= 5) break
            }
          }
          if (paths.length >= 5) break
        }
      }

      // Priority 2: match query words against imageRegistry filenames
      if (paths.length < 5) {
        for (const [name, entry] of Object.entries(imagePathRegistry)) {
          if (!entry || typeof entry.absolutePath !== 'string') continue
          const n = name.toLowerCase()
          if (words.some(w => n.includes(w)) && !seen.has(entry.absolutePath)) {
            seen.add(entry.absolutePath)
            paths.push(entry.absolutePath)
            if (paths.length >= 5) break
          }
        }
      }

      window.ragAPI?.sendResult(requestId, { paths })
    })

    // Handle MiroFish simulation requests (Slack /mirofish endpoint)
    const cleanupMirofish = window.ragAPI.onMirofish?.(async ({ requestId, topic, numPersonas, numRounds, modelId, context, segment, presetPersonas, images }) => {
      if (mirofishInFlightRef.current) {
        console.warn('[useRagApi] MiroFish already running — ignoring duplicate request')
        window.ragAPI?.sendResult(requestId, { feed: [], report: 'A simulation is already running. Please try again later.' })
        return
      }
      mirofishInFlightRef.current = true
      try {
        // Use presetPersonas directly if provided, otherwise generate via LLM
        const personas: MirofishPersona[] = presetPersonas?.length
          ? presetPersonas as MirofishPersona[]
          : await generatePersonas(topic, numPersonas, modelId, context, segment)
        if (!personas.length) throw new Error('Persona generation returned empty results')
        const feed: MirofishPost[] = []
        const abort = new AbortController()
        let currentRound = 0

        // Notify simulation start
        window.electronAPI?.ipcSend?.('rag:mirofish:progress', { running: true, feed: [], round: 0, totalRounds: numRounds })

        await runSimulation(
          { topic, numPersonas, numRounds, modelId, autoGeneratePersonas: false, imageDirectPass: !!images?.length, personas, context, images },
          (event) => {
            if (event.type === 'post-done' && event.post) {
              feed.push(event.post)
              // Send real-time progress (for Slack bot polling)
              window.electronAPI?.ipcSend?.('rag:mirofish:progress', {
                running: true, feed: [...feed], round: event.post.round, totalRounds: numRounds,
              })
            } else if (event.type === 'round-done' && event.round != null) {
              currentRound = event.round
            }
          },
          abort.signal,
        )

        // Notify completion
        window.electronAPI?.ipcSend?.('rag:mirofish:progress', { running: false, feed: [...feed], round: currentRound, totalRounds: numRounds })

        const report = await generateReport(topic, feed, modelId)
        window.ragAPI?.sendResult(requestId, { feed, report })
      } catch (err) {
        console.error('[useRagApi] mirofish error:', err)
        window.ragAPI?.sendResult(requestId, { feed: [], report: `Error: ${err instanceof Error ? err.message : String(err)}` })
      } finally {
        mirofishInFlightRef.current = false
      }
    })

    // Handle vault path requests (fallback for /mirofish-save)
    const cleanupVaultPath = window.ragAPI.onGetVaultPath?.(({ requestId }: { requestId: string }) => {
      const vaultPath = useVaultStore.getState().vaultPath ?? null
      window.ragAPI?.sendResult(requestId, vaultPath)
    })

    return () => { cleanup(); cleanupSettings(); cleanupAsk(); cleanupImages?.(); cleanupMirofish?.(); cleanupVaultPath?.() }
  }, [])
}
