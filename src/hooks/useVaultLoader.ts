/**
 * useVaultLoader — Shared vault loading logic.
 *
 * Extracted so it can be used by both:
 *   - App.tsx (auto-load on startup when vaultPath is persisted)
 *   - VaultSelector.tsx (manual load/reload from settings UI)
 *
 * Supports multi-vault: loadVaultCached restores from in-memory cache,
 * loadVaultBackground pre-loads a vault into the docs cache silently.
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
import { tfidfIndex, clearMetricsCache } from '@/lib/graphAnalysis'
import { buildAdjacencyMap } from '@/lib/graphRAG'
import { buildAndFindLinks, findLinksFromCache } from '@/lib/bm25WorkerClient'
import { buildFingerprint, loadTfIdfCache, saveTfIdfCache } from '@/lib/tfidfCache'
import { buildDocsFingerprint, loadDocsCache, saveDocsCache } from '@/lib/docsCache'
import type { VaultFile } from '@/types'

export function useVaultLoader() {
  const { vaultPath, setLoadedDocuments, setVaultFolders, setImagePathRegistry, clearImageDataCache, setIsLoading, setVaultReady, setLoadingProgress, setError, setPendingFileCount, cacheVaultDocs, setBgLoadingInfo } =
    useVaultStore()
  const { setGraph, resetToMock, setGraphLayoutReady } = useGraphStore()
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
        // ── Step 1: scanMetadata (mtime only, no file content) → check cache fingerprint ──
        let docs = null
        let folders: string[] = []
        let imageRegistry: Record<string, { relativePath: string; absolutePath: string }> | null = null

        if (window.vaultAPI.scanMetadata) {
          try {
            setLoadingProgress(2, 'Scanning metadata...')
            const meta = await window.vaultAPI.scanMetadata(dirPath)
            if (meta && meta.length > 0) {
              const docsFingerprint = buildDocsFingerprint(
                meta.map(m => ({ relativePath: m.relativePath, mtime: m.mtime }))
              )
              const hit = await loadDocsCache(dirPath, docsFingerprint)
              if (hit) {
                logger.debug(`[vault] Cache hit — skipping loadFiles and parsing (${hit.docs.length} docs)`)
                setLoadingProgress(90, 'Restoring from cache...')
                docs = hit.docs
                folders = hit.folders
                imageRegistry = hit.imageRegistry
                setPendingFileCount(hit.docs.length)
                setVaultFolders(folders)
                setImagePathRegistry(imageRegistry)
              }
            }
          } catch { /* scanMetadata failed → fall back to loadFiles */ }
        }

        // ── Step 2: Cache miss → loadFiles (with file content) ─────────────────
        let files: VaultFile[] | null = null
        if (!docs) {
          const loaded = await window.vaultAPI.loadFiles(dirPath)
          files = loaded.files
          folders = loaded.folders ?? []
          imageRegistry = loaded.imageRegistry ?? null
          logger.debug(`[vault] ${files?.length ?? 0} files, ${folders.length} folders, ${Object.keys(imageRegistry ?? {}).length} images loaded (${dirPath})`)
          setVaultFolders(folders)
          setImagePathRegistry(imageRegistry)
          setPendingFileCount(files?.length ?? 0)
          setLoadingProgress(5, 'File list loaded')

          if (!files || files.length === 0) {
            setLoadedDocuments(null)
            resetToMock()
            setIsLoading(false)
            return
          }
        }

        // ── Step 3: Cache miss → full parsing ──────────────────────────────────
        if (!docs) {
          const total = files!.length
          docs = await parseVaultFilesAsync(files!, (parsed) => {
            const pct = 5 + Math.round((parsed / total) * 80)
            setLoadingProgress(pct, `Parsing documents... (${parsed}/${total})`)
          })
          logger.debug(`[vault] ${docs.length}/${files!.length} documents parsed successfully`)

          // Save to docs cache after parsing (background, includes folders + imageRegistry)
          const metaForCache = files!.map(f => ({ relativePath: f.relativePath, mtime: f.mtime ?? 0 }))
          const fp = buildDocsFingerprint(metaForCache)
          saveDocsCache(dirPath, fp, docs, folders, imageRegistry)
            .catch((e: unknown) => logger.warn('[docsCache] Save failed:', e))
        }
        setLoadedDocuments(docs)

        // Load vault-scoped persona config (.strata-sync/personas.md)
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

        // Update graph (clear stale metrics cache from previous vault)
        clearMetricsCache()
        setLoadingProgress(95, 'Finalizing...')

        // Graph build + BM25 index: use setTimeout(0) to avoid UI blocking
        // BM25 build/findImplicitLinks runs in a Web Worker (removes O(N^2) main-thread blocking)
        const fingerprint = buildFingerprint(docs)
        setTimeout(async () => {
          // Graph build (synchronous operation)
          try {
            const { nodes, links } = buildGraph(docs)
            logger.debug(`[vault] Graph: ${nodes.length} nodes, ${links.length} links`)
            setGraph(nodes, links)
          } catch (e: unknown) {
            logger.warn('[vault] Graph build failed:', e instanceof Error ? e.message : String(e))
          }

          // BM25 index: cache hit → restore (fast) + compute implicit links in worker
          //             cache miss → build in worker + compute implicit links (non-blocking main thread)
          const { links: currentLinks } = useGraphStore.getState()
          const adj = buildAdjacencyMap(currentLinks)
          try {
            const cached = await loadTfIdfCache(dirPath, fingerprint)
            if (cached) {
              tfidfIndex.restore(cached)
              if (currentLinks.length > 0) {
                findLinksFromCache(cached, adj)
                  .then(links => tfidfIndex.setImplicitLinks(links, adj))
                  .catch((e: unknown) => logger.warn('[BM25] Implicit link computation failed:', e instanceof Error ? e.message : String(e)))
              }
            } else {
              try {
                const { serialized, implicitLinks } = await buildAndFindLinks(docs, adj, fingerprint)
                tfidfIndex.restore(serialized)
                tfidfIndex.setImplicitLinks(implicitLinks, adj)
                saveTfIdfCache(dirPath, serialized)
                  .catch((e: unknown) => logger.warn('[BM25] Cache save failed:', e instanceof Error ? e.message : String(e)))
              } catch (e: unknown) {
                logger.warn('[BM25] Worker build failed, falling back to main thread:', e instanceof Error ? e.message : String(e))
                try { tfidfIndex.build(docs) } catch { /* rebuild also failed — silent */ }
              }
            }
          } catch (e: unknown) {
            logger.warn('[BM25] Index initialization failed, retrying build:', e instanceof Error ? e.message : String(e))
            try { tfidfIndex.build(docs) } catch { /* rebuild also failed — silent */ }
          }
        }, 0)

        // Images are loaded on-demand (ChatInput.tsx readImage IPC fallback)
        // No full pre-indexing at vault load to save memory
        clearImageDataCache()
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
    [setLoadedDocuments, setVaultFolders, setImagePathRegistry, clearImageDataCache,
     setIsLoading, setVaultReady, setLoadingProgress, setError, setPendingFileCount,
     setGraph, resetToMock,
     loadVaultPersonas, resetVaultPersonas]
  )

  const loadVaultCached = useCallback(
    async (dirPath: string) => {
      const { activeVaultId: startVaultId, vaultDocsCache, vaultMetaCache } = useVaultStore.getState()
      const cachedDocs = startVaultId ? vaultDocsCache[startVaultId] : null
      const cachedMeta = startVaultId ? vaultMetaCache[startVaultId] : null

      if (!cachedDocs?.length) {
        // Cache miss → full load
        return loadVault(dirPath)
      }

      if (!window.vaultAPI) return
      // Pre-update currentVaultPath — needed for usePersonaVaultSaver's vault:save-file security check
      try { await window.vaultAPI.setActivePath?.(dirPath) } catch { /* failure is OK, cache restore continues */ }
      // Cache restore is fast, so skip isLoading/vaultReady reset → no loading overlay shown
      setError(null)
      // Don't set pendingFileCount during cache restore → prevents quality selection screen from reappearing
      try {
        // Restore image registry + folders from cache (or empty defaults)
        setImagePathRegistry(cachedMeta?.imageRegistry ?? null)
        setVaultFolders(cachedMeta?.folders ?? [])

        // Persona config (quick single file read)
        try {
          const configContent = await window.vaultAPI.readFile(`${dirPath}/${PERSONA_CONFIG_PATH}`)
          if (configContent) {
            const config = parsePersonaConfig(configContent)
            config ? loadVaultPersonas(config) : resetVaultPersonas()
          } else {
            resetVaultPersonas()
          }
        } catch { resetVaultPersonas() }

        setLoadedDocuments(cachedDocs)
        clearMetricsCache()

        // buildGraph: defer by one tick to avoid main-thread blocking
        await new Promise<void>(r => setTimeout(r, 0))
        if (useVaultStore.getState().activeVaultId !== startVaultId) return
        try {
          const { nodes, links } = buildGraph(cachedDocs)
          setGraph(nodes, links)
        } catch (e: unknown) {
          logger.warn('[vault] Graph build failed:', e instanceof Error ? e.message : String(e))
        }
        setGraphLayoutReady(true)

        const fingerprint = buildFingerprint(cachedDocs)
        setTimeout(async () => {
          // Abort if vault switched before this async callback runs (prevents stale index)
          if (useVaultStore.getState().activeVaultId !== startVaultId) return
          const { links: currentLinks } = useGraphStore.getState()
          const adj = buildAdjacencyMap(currentLinks)
          try {
            const cached = await loadTfIdfCache(dirPath, fingerprint)
            if (useVaultStore.getState().activeVaultId !== startVaultId) return
            if (cached) {
              tfidfIndex.restore(cached)
              if (currentLinks.length > 0) {
                findLinksFromCache(cached, adj)
                  .then(links => tfidfIndex.setImplicitLinks(links, adj))
                  .catch((e: unknown) => logger.warn('[BM25] Implicit link computation failed:', e instanceof Error ? e.message : String(e)))
              }
            } else {
              try {
                const { serialized, implicitLinks } = await buildAndFindLinks(cachedDocs, adj, fingerprint)
                tfidfIndex.restore(serialized)
                tfidfIndex.setImplicitLinks(implicitLinks, adj)
                saveTfIdfCache(dirPath, serialized)
                  .catch((e: unknown) => logger.warn('[BM25] Cache save failed:', e instanceof Error ? e.message : String(e)))
              } catch (e: unknown) {
                logger.warn('[BM25] Worker build failed, falling back to main thread:', e instanceof Error ? e.message : String(e))
                try { tfidfIndex.build(cachedDocs) } catch { /* rebuild also failed — silent */ }
              }
            }
          } catch (e: unknown) {
            logger.warn('[BM25] Index initialization failed, retrying build:', e instanceof Error ? e.message : String(e))
            try { tfidfIndex.build(cachedDocs) } catch { /* rebuild also failed — silent */ }
          }
        }, 0)

        clearImageDataCache()
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Restore failed'
        setError(msg)
        setLoadedDocuments(null)
        resetToMock()
      } finally {
        setPendingFileCount(null)
      }
    },
    [loadVault, setLoadedDocuments, setImagePathRegistry, setVaultFolders, clearImageDataCache,
     setError, setPendingFileCount,
     setGraph, setGraphLayoutReady, resetToMock, loadVaultPersonas, resetVaultPersonas]
  )

  const loadVaultBackground = useCallback(
    async (vaultId: string, dirPath: string) => {
      if (!window.vaultAPI) return
      const { vaultDocsCache } = useVaultStore.getState()
      if (vaultDocsCache[vaultId]?.length) return  // already in-memory
      try {
        // ── docsCache hit → skip file reading and parsing entirely ──────────
        if (window.vaultAPI.scanMetadata) {
          try {
            const meta = await window.vaultAPI.scanMetadata(dirPath)
            if (meta?.length) {
              const fp = buildDocsFingerprint(meta.map(m => ({ relativePath: m.relativePath, mtime: m.mtime })))
              const hit = await loadDocsCache(dirPath, fp)
              if (hit) {
                useVaultStore.getState().cacheVaultDocs(vaultId, hit.docs)
                useVaultStore.setState((s) => ({
                  vaultMetaCache: {
                    ...s.vaultMetaCache,
                    [vaultId]: { imageRegistry: hit.imageRegistry ?? null, folders: hit.folders ?? [] }
                  }
                }))
                return
              }
            }
          } catch { /* docsCache miss → fall through to loadFiles */ }
        }

        // ── Cache miss: read files + parse, then save ────────────────────────
        const { files, folders, imageRegistry } = await window.vaultAPI.loadFiles(dirPath)
        if (!files?.length) return
        const docs = await parseVaultFilesAsync(files)
        useVaultStore.getState().cacheVaultDocs(vaultId, docs)
        useVaultStore.setState((s) => ({
          vaultMetaCache: {
            ...s.vaultMetaCache,
            [vaultId]: { imageRegistry: imageRegistry ?? null, folders: folders ?? [] }
          }
        }))
        // Save so next restart gets a cache hit
        const metaForFp = files.map(f => ({ relativePath: f.relativePath, mtime: f.mtime ?? 0 }))
        saveDocsCache(dirPath, buildDocsFingerprint(metaForFp), docs, folders ?? [], imageRegistry ?? null)
          .catch(() => { /* background save failure is silent */ })
      } catch {
        // Silent failure
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  // Expose cacheVaultDocs and setBgLoadingInfo via closure (used in App.tsx)
  void cacheVaultDocs
  void setBgLoadingInfo

  return { vaultPath, loadVault, loadVaultCached, loadVaultBackground }
}
