/**
 * vaultStore.ts — Phase 6
 *
 * Stores the user's selected vault path and parsed documents.
 * Only vaultPath is persisted — documents are re-loaded from the filesystem
 * on each app start (so they stay fresh without a separate sync mechanism).
 *
 * Mock fallback pattern (used by FileTree, DocViewer, useDocumentFilter):
 *   const docs = (vaultPath && loadedDocuments) ? loadedDocuments : MOCK_DOCUMENTS
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { LoadedDocument } from '@/types'

/** Image file path registry: filename → { relativePath, absolutePath } */
export type ImagePathRegistry = Record<string, { relativePath: string; absolutePath: string }>

interface VaultState {
  /** Persisted: absolute path to the selected vault root */
  vaultPath: string | null
  /** Runtime: parsed documents (not persisted) */
  loadedDocuments: LoadedDocument[] | null
  /** Runtime: all known subfolder paths in the vault (relative to vault root) */
  vaultFolders: string[]
  /** Runtime: image filename → path lookup table (from vault load) */
  imagePathRegistry: ImagePathRegistry | null
  /** Runtime: pre-indexed image data cache: filename → base64 dataUrl */
  imageDataCache: Record<string, string>
  /** Runtime: true while loading/parsing files */
  isLoading: boolean
  /** Runtime: true after the first load attempt completes (success or failure) */
  vaultReady: boolean
  /** Runtime: loading progress 0-100 */
  loadingProgress: number
  /** Runtime: human-readable loading phase description */
  loadingPhase: string
  /** Runtime: last error message, null if none */
  error: string | null
  /** Runtime: total MD file count detected at load start (null = not yet known) */
  pendingFileCount: number | null

  setVaultPath: (path: string | null) => void
  setLoadedDocuments: (docs: LoadedDocument[] | null) => void
  setVaultFolders: (folders: string[]) => void
  setImagePathRegistry: (registry: ImagePathRegistry | null) => void
  addImageDataCache: (entries: Record<string, string>) => void
  clearImageDataCache: () => void
  setIsLoading: (loading: boolean) => void
  setVaultReady: (ready: boolean) => void
  setLoadingProgress: (progress: number, phase?: string) => void
  setError: (error: string | null) => void
  setPendingFileCount: (count: number | null) => void
  /** Clear vault path + documents + error */
  clearVault: () => void
}

export const useVaultStore = create<VaultState>()(
  persist(
    (set) => ({
      vaultPath: null,
      loadedDocuments: null,
      vaultFolders: [],
      imagePathRegistry: null,
      imageDataCache: {},
      isLoading: false,
      vaultReady: false,
      loadingProgress: 0,
      loadingPhase: '',
      error: null,
      pendingFileCount: null,

      setVaultPath: (vaultPath) => set({ vaultPath }),
      setLoadedDocuments: (loadedDocuments) => set({ loadedDocuments }),
      setVaultFolders: (vaultFolders) => set({ vaultFolders }),
      setImagePathRegistry: (imagePathRegistry) => set({ imagePathRegistry }),
      addImageDataCache: (entries) =>
        set((s) => ({ imageDataCache: { ...s.imageDataCache, ...entries } })),
      clearImageDataCache: () => set({ imageDataCache: {} }),
      setIsLoading: (isLoading) => set({ isLoading }),
      setVaultReady: (vaultReady) => set({ vaultReady }),
      setLoadingProgress: (loadingProgress, loadingPhase = '') =>
        set({ loadingProgress, loadingPhase }),
      setError: (error) => set({ error }),
      setPendingFileCount: (pendingFileCount) => set({ pendingFileCount }),
      clearVault: () =>
        set({ vaultPath: null, loadedDocuments: null, vaultFolders: [], imagePathRegistry: null, imageDataCache: {}, error: null, isLoading: false, vaultReady: false, loadingProgress: 0, loadingPhase: '', pendingFileCount: null }),
    }),
    {
      name: 'strata-sync-vault',
      // Only persist vaultPath — documents are re-loaded from disk on startup
      partialize: (state) => ({ vaultPath: state.vaultPath }),
    }
  )
)
