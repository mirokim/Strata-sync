/**
 * useVaultLoader — Shared vault loading logic.
 *
 * Extracted so it can be used by both:
 *   - App.tsx (auto-load on startup when vaultPath is persisted)
 *   - VaultSelector.tsx (manual load/reload from settings UI)
 */

import { useCallback } from 'react'
import { PERSONA_CONFIG_PATH } from '@/lib/constants'
import { logger } from '@/lib/logger'
import { useVaultStore } from '@/stores/vaultStore'
import { useGraphStore } from '@/stores/graphStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { parseVaultFilesAsync } from '@/lib/markdownParser'
import { buildGraph } from '@/lib/graphBuilder'
import { parsePersonaConfig } from '@/lib/personaVaultConfig'
import { tfidfIndex } from '@/lib/graphAnalysis'
import { buildAdjacencyMap } from '@/lib/graphRAG'
import { buildFingerprint, loadTfIdfCache, saveTfIdfCache } from '@/lib/tfidfCache'

export function useVaultLoader() {
  const { vaultPath, setLoadedDocuments, setVaultFolders, setImagePathRegistry, addImageDataCache, clearImageDataCache, setIsLoading, setVaultReady, setLoadingProgress, setError, setPendingFileCount } =
    useVaultStore()
  const { setNodes, setLinks, resetToMock } = useGraphStore()
  const { loadVaultPersonas, resetVaultPersonas } = useSettingsStore()

  const loadVault = useCallback(
    async (dirPath: string) => {
      if (!window.vaultAPI) {
        setError('Not running in Electron. Cannot load vault in a browser environment.')
        return
      }
      setIsLoading(true)
      setVaultReady(false)
      setLoadingProgress(0, 'Initializing vault...')
      setError(null)
      try {
        const { files, folders, imageRegistry } = await window.vaultAPI.loadFiles(dirPath)
        logger.debug(`[vault] ${files?.length ?? 0} files, ${folders?.length ?? 0} folders, ${Object.keys(imageRegistry ?? {}).length} images loaded (${dirPath})`)
        setVaultFolders(folders ?? [])
        setImagePathRegistry(imageRegistry ?? null)
        setPendingFileCount(files?.length ?? 0)
        setLoadingProgress(5, 'File list loaded')

        if (!files || files.length === 0) {
          setLoadedDocuments(null)
          resetToMock()
          setIsLoading(false)
          return
        }

        const total = files.length
        const docs = await parseVaultFilesAsync(files, (parsed) => {
          const pct = 5 + Math.round((parsed / total) * 80)
          setLoadingProgress(pct, `Parsing documents... (${parsed}/${total})`)
        })
        logger.debug(`[vault] ${docs.length}/${files.length} documents parsed successfully`)
        setLoadedDocuments(docs)

        // Load vault-scoped persona config (.rembrant/personas.md)
        try {
          const configPath = `${dirPath}/${PERSONA_CONFIG_PATH}`
          const configContent = await window.vaultAPI!.readFile(configPath)
          if (configContent) {
            const config = parsePersonaConfig(configContent)
            if (config) {
              loadVaultPersonas(config)
              logger.debug('[vault] Persona config loaded')
            } else {
              resetVaultPersonas()
            }
          } else {
            resetVaultPersonas()
          }
        } catch {
          resetVaultPersonas()
        }

        // Update graph
        setLoadingProgress(90, 'Building graph...')
        const { nodes, links } = buildGraph(docs)
        logger.debug(`[vault] Graph: ${nodes.length} nodes, ${links.length} links`)
        setNodes(nodes)
        setLinks(links)
        setLoadingProgress(95, 'Loading settings...')

        // TF-IDF index: restore from cache on hit, build and save on miss
        // setTimeout(0) to prevent UI blocking
        const fingerprint = buildFingerprint(docs)
        setTimeout(async () => {
          const cached = await loadTfIdfCache(dirPath, fingerprint)
          if (cached) {
            tfidfIndex.restore(cached)
          } else {
            tfidfIndex.build(docs)
            void saveTfIdfCache(dirPath, tfidfIndex.serialize(fingerprint))
          }
          // Pre-compute implicit links — adjacency-based cache warming
          const { links: currentLinks } = useGraphStore.getState()
          if (currentLinks.length > 0) {
            const adj = buildAdjacencyMap(currentLinks)
            tfidfIndex.findImplicitLinks(adj)
          }
        }, 0)

        // Pre-index images — runs in background after loading completes (no UI blocking)
        if (window.vaultAPI) {
          void (async () => {
            const registry = useVaultStore.getState().imagePathRegistry
            if (!registry) return
            // Collect imageRefs from all documents (deduplicated)
            // Obsidian embeds may use path-prefixed refs like ![[attachments/img.png]].
            // imagePathRegistry is keyed by basename only, so resolve via basename fallback.
            const resolveEntry = (ref: string) => {
              if (registry[ref]) return { key: ref, entry: registry[ref] }
              const basename = ref.split(/[/\\]/).pop() ?? ref
              if (registry[basename]) return { key: basename, entry: registry[basename] }
              return null
            }
            const refsToPreload = [...new Set(
              docs.flatMap(d => d.imageRefs ?? []).filter(ref => !!resolveEntry(ref))
            )]
            if (refsToPreload.length === 0) return
            clearImageDataCache()
            logger.debug(`[vault] Image pre-indexing started: ${refsToPreload.length} images`)
            // Process in parallel batches of 10
            const BATCH = 10
            for (let i = 0; i < refsToPreload.length; i += BATCH) {
              const batch = refsToPreload.slice(i, i + BATCH)
              const results = await Promise.allSettled(
                batch.map(async (ref) => {
                  const resolved = resolveEntry(ref)!
                  const dataUrl = await window.vaultAPI!.readImage(resolved.entry.absolutePath)
                  return { ref: resolved.key, dataUrl }  // cache by basename key
                })
              )
              const batchEntries: Record<string, string> = {}
              for (const r of results) {
                if (r.status === 'fulfilled' && r.value.dataUrl) {
                  batchEntries[r.value.ref] = r.value.dataUrl
                }
              }
              if (Object.keys(batchEntries).length > 0) addImageDataCache(batchEntries)
            }
            logger.debug('[vault] Image pre-indexing complete')
          })()
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'File load failed'
        logger.error('[vault] Load failed:', msg)
        setError(msg)
        setLoadedDocuments(null)
        resetToMock()
      } finally {
        setLoadingProgress(100, '')
        setVaultReady(true)
        setIsLoading(false)
        setPendingFileCount(null)
      }
    },
    [setLoadedDocuments, setVaultFolders, setImagePathRegistry, addImageDataCache, clearImageDataCache,
     setIsLoading, setVaultReady, setLoadingProgress, setError, setPendingFileCount,
     setNodes, setLinks, resetToMock,
     loadVaultPersonas, resetVaultPersonas]
  )

  return { vaultPath, loadVault }
}
