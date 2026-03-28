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
import { useBackendStore } from '@/stores/backendStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { parseVaultFilesAsync } from '@/lib/markdownParser'
import { buildGraph } from '@/lib/graphBuilder'
import { vaultDocsToChunks } from '@/lib/vaultToChunks'
import { parsePersonaConfig } from '@/lib/personaVaultConfig'
import { tfidfIndex, clearMetricsCache } from '@/lib/graphAnalysis'
import { buildAdjacencyMap } from '@/lib/graphRAG'
import { buildAndFindLinks, findLinksFromCache } from '@/lib/bm25WorkerClient'
import { buildFingerprint, loadTfIdfCache, saveTfIdfCache } from '@/lib/tfidfCache'
import { buildDocsFingerprint, loadDocsCache, saveDocsCache } from '@/lib/docsCache'
import { vectorEmbedIndex } from '@/lib/vectorEmbedIndex'
import type { VaultFile } from '@/types'

export function useVaultLoader() {
  const { vaultPath, setLoadedDocuments, setVaultFolders, setImagePathRegistry, clearImageDataCache, setIsLoading, setVaultReady, setLoadingProgress, setError, setPendingFileCount, cacheVaultDocs, setBgLoadingInfo } =
    useVaultStore()
  const { setGraph, resetToMock, setGraphLayoutReady } = useGraphStore()
  const { setIndexing, setChunkCount, setError: setBackendError } = useBackendStore()
  const { loadVaultPersonas, resetVaultPersonas } = useSettingsStore()

  const loadVault = useCallback(
    async (dirPath: string) => {
      if (!window.vaultAPI) {
        setError('Not an Electron environment. Cannot load vault from browser.')
        return
      }
      setIsLoading(true)
      setVaultReady(false)
      setLoadingProgress(0, 'Initializing vault...')
      setError(null)
      try {
        // ── Step 1: scanMetadata (mtime only, no file content) → cache fingerprint check ──
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
                logger.debug(`[vault] cache hit — skipping loadFiles and parsing (${hit.docs.length} docs)`)
                setLoadingProgress(90, 'Restoring from cache...')
                docs = hit.docs
                folders = hit.folders
                imageRegistry = hit.imageRegistry
                setPendingFileCount(hit.docs.length)
                setVaultFolders(folders)
                setImagePathRegistry(imageRegistry)
              }
            }
          } catch { /* scanMetadata failed → loadFiles fallback */ }
        }

        // ── Step 2: on cache miss, loadFiles (with file content) ─────────────
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

        // ── Step 3: full parse on cache miss ──────────────────────────────────
        if (!docs) {
          const total = files!.length
          docs = await parseVaultFilesAsync(files!, (parsed) => {
            const pct = 5 + Math.round((parsed / total) * 80)
            setLoadingProgress(pct, `Parsing documents... (${parsed}/${total})`)
          })
          logger.debug(`[vault] ${docs.length}/${files!.length} docs parsed successfully`)

          // Save cache after parsing complete (background, includes folders+imageRegistry)
          const metaForCache = files!.map(f => ({ relativePath: f.relativePath, mtime: f.mtime ?? 0 }))
          const fp = buildDocsFingerprint(metaForCache)
          saveDocsCache(dirPath, fp, docs, folders, imageRegistry)
            .catch((e: unknown) => logger.warn('[docsCache] save failed:', e))
        }
        setLoadedDocuments(docs)

        // Load vault-scoped persona config (.rembrant/personas.md)
        try {
          const configPath = `${dirPath}/${PERSONA_CONFIG_PATH}`
          const configContent = await window.vaultAPI!.readFile(configPath)
          if (configContent) {
            const config = parsePersonaConfig(configContent)
            if (config) {
              loadVaultPersonas(config)
              logger.debug('[vault] persona config loaded')
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

        // 그래프 빌드 + BM25 인덱스: setTimeout(0)으로 UI 블로킹 방지
        // BM25 build/findImplicitLinks은 Web Worker에서 실행 (O(N²) 메인 스레드 블로킹 제거)
        const fingerprint = buildFingerprint(docs)
        const buildForVault = dirPath  // 캡처: 비동기 완료 시 vault가 바뀌었는지 확인용
        setTimeout(async () => {
          // 그래프 빌드 (동기 작업)
          if (useVaultStore.getState().vaultPath !== buildForVault) return
          try {
            const { nodes, links } = buildGraph(docs)
            logger.debug(`[vault] graph: ${nodes.length} nodes, ${links.length} links`)
            setGraph(nodes, links)
          } catch (e: unknown) {
            logger.warn('[vault] graph build failed:', e instanceof Error ? e.message : String(e))
          }

          // BM25 인덱스: 캐시 히트 → 복원(빠름) + 워커에서 묵시적 링크 계산
          //              캐시 미스 → 워커에서 빌드 + 묵시적 링크 계산 (메인 스레드 비블로킹)
          const { links: currentLinks } = useGraphStore.getState()
          const adj = buildAdjacencyMap(currentLinks)
          try {
            const cached = await loadTfIdfCache(dirPath, fingerprint)
            // 비동기 완료 후 vault가 바뀌었으면 stale 결과를 tfidfIndex에 적용하지 않음
            if (useVaultStore.getState().vaultPath !== buildForVault) return
            if (cached) {
              tfidfIndex.restore(cached)
              if (currentLinks.length > 0) {
                findLinksFromCache(cached, adj)
                  .then(links => tfidfIndex.setImplicitLinks(links, adj))
                  .catch((e: unknown) => logger.warn('[BM25] implicit link computation failed:', e instanceof Error ? e.message : String(e)))
              }
            } else {
              try {
                const { serialized, implicitLinks } = await buildAndFindLinks(docs, adj, fingerprint)
                if (useVaultStore.getState().vaultPath !== buildForVault) return
                tfidfIndex.restore(serialized)
                tfidfIndex.setImplicitLinks(implicitLinks, adj)
                saveTfIdfCache(dirPath, serialized)
                  .catch((e: unknown) => logger.warn('[BM25] cache save failed:', e instanceof Error ? e.message : String(e)))
              } catch (e: unknown) {
                logger.warn('[BM25] worker build failed, main thread fallback:', e instanceof Error ? e.message : String(e))
                if (useVaultStore.getState().vaultPath === buildForVault) {
                  try { tfidfIndex.build(docs) } catch { /* 재빌드도 실패 시 무음 */ }
                }
              }
            }
          } catch (e: unknown) {
            logger.warn('[BM25] index init failed, attempting rebuild:', e instanceof Error ? e.message : String(e))
            if (useVaultStore.getState().vaultPath === buildForVault) {
              try { tfidfIndex.build(docs) } catch { /* 재빌드도 실패 시 무음 */ }
            }
          }

          // 벡터 임베딩 백그라운드 빌드 (OpenAI API 키가 있을 때만)
          const geminiKey = useSettingsStore.getState().apiKeys['gemini']?.trim()
          if (geminiKey && docs.length > 0 && useVaultStore.getState().vaultPath === buildForVault) {
            vectorEmbedIndex.reset()
            vectorEmbedIndex.buildInBackground(docs, geminiKey, dirPath, fingerprint)
              .catch((e: unknown) => logger.warn('[vector] embedding build failed:', e instanceof Error ? e.message : String(e)))
          }
        }, 0)

        // Index into backend if available (check readiness first to avoid noisy errors)
        if (window.backendAPI && docs.length > 0) {
          try {
            const status = await window.backendAPI.getStatus()
            if (status?.ready) {
              const chunks = vaultDocsToChunks(docs)
              setIndexing(true)
              window.backendAPI
                .indexDocuments(chunks)
                .then(({ indexed }) => setChunkCount(indexed))
                .catch((err: unknown) =>
                  setBackendError(err instanceof Error ? err.message : String(err))
                )
                .finally(() => setIndexing(false))
            }
          } catch {
            // Backend not running — silently skip indexing
          }
        }
        // 이미지는 on-demand로 로드 (ChatInput.tsx readImage IPC fallback)
        // 볼트 로드 시 전체 사전 인덱싱을 하지 않아 메모리를 절약
        clearImageDataCache()
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'File load failed'
        logger.error('[vault] 로드 실패:', msg)
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
     setGraph, resetToMock, setIndexing, setChunkCount, setBackendError,
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
      // currentVaultPath를 선제 갱신 — usePersonaVaultSaver의 vault:save-file 보안 검사 통과용
      try { await window.vaultAPI.setActivePath?.(dirPath) } catch { /* 실패해도 캐시 복원은 계속 */ }
      // 캐시 복원은 빠르므로 isLoading/vaultReady 리셋 없이 silent 처리 → 로딩 오버레이 미표시
      setError(null)
      // 캐시 복원 시엔 pendingFileCount 미설정 → 품질 선택 화면 재표시 방지
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

        // buildGraph: 한 틱 후로 이동 — 메인 스레드 블로킹 방지
        await new Promise<void>(r => setTimeout(r, 0))
        if (useVaultStore.getState().activeVaultId !== startVaultId) return
        try {
          const { nodes, links } = buildGraph(cachedDocs)
          setGraph(nodes, links)
        } catch (e: unknown) {
          logger.warn('[vault] 그래프 빌드 실패:', e instanceof Error ? e.message : String(e))
        }
        setGraphLayoutReady(true)

        const fingerprint = buildFingerprint(cachedDocs)
        setTimeout(async () => {
          // 비동기 콜백 실행 전에 다른 볼트로 전환됐으면 중단 (stale index 방지)
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
                  .catch((e: unknown) => logger.warn('[BM25] implicit link computation failed:', e instanceof Error ? e.message : String(e)))
              }
            } else {
              try {
                const { serialized, implicitLinks } = await buildAndFindLinks(cachedDocs, adj, fingerprint)
                tfidfIndex.restore(serialized)
                tfidfIndex.setImplicitLinks(implicitLinks, adj)
                saveTfIdfCache(dirPath, serialized)
                  .catch((e: unknown) => logger.warn('[BM25] cache save failed:', e instanceof Error ? e.message : String(e)))
              } catch (e: unknown) {
                logger.warn('[BM25] worker build failed, main thread fallback:', e instanceof Error ? e.message : String(e))
                try { tfidfIndex.build(cachedDocs) } catch { /* 재빌드도 실패 시 무음 */ }
              }
            }
          } catch (e: unknown) {
            logger.warn('[BM25] index init failed, attempting rebuild:', e instanceof Error ? e.message : String(e))
            try { tfidfIndex.build(cachedDocs) } catch { /* 재빌드도 실패 시 무음 */ }
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
        // ── docsCache 히트 시 파일 읽기·파싱 전체 생략 ──────────────────────
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

        // ── 캐시 미스: 파일 읽기 + 파싱 후 저장 ────────────────────────────
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
        // 다음 재시작에서 캐시 히트되도록 저장
        const metaForFp = files.map(f => ({ relativePath: f.relativePath, mtime: f.mtime ?? 0 }))
        saveDocsCache(dirPath, buildDocsFingerprint(metaForFp), docs, folders ?? [], imageRegistry ?? null)
          .catch(() => { /* 백그라운드 저장 실패는 무음 처리 */ })
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
