/**
 * vaultStore.ts — Phase 6 + Multi-Vault
 *
 * Stores the user's selected vault path and parsed documents.
 * Supports multiple vaults: vaults[] + activeVaultId are persisted.
 * Documents are re-loaded from the filesystem on each vault switch.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { LoadedDocument } from '@/types'

/** Image file path registry: filename -> { relativePath, absolutePath } */
export type ImagePathRegistry = Record<string, { relativePath: string; absolutePath: string }>

/** Registered vault entry */
export interface VaultEntry {
  path: string
  label: string
}

interface VaultState {
  /** Persisted: registered vault list */
  vaults: Record<string, VaultEntry>
  /** Persisted: currently active vault ID */
  activeVaultId: string
  /** Persisted: absolute path to the selected vault root (derived from vaults[activeVaultId]) */
  vaultPath: string | null
  /** Runtime: parsed documents (not persisted) */
  loadedDocuments: LoadedDocument[] | null
  /** Runtime: per-vault document cache — for Slack bot cross-vault search */
  vaultDocsCache: Record<string, LoadedDocument[]>
  /** Runtime: per-vault meta cache (imageRegistry + folders) */
  vaultMetaCache: Record<string, { imageRegistry: ImagePathRegistry | null; folders: string[] }>
  /** Runtime: all known subfolder paths in the vault (relative to vault root) */
  vaultFolders: string[]
  /** Runtime: image filename -> path lookup table (from vault load) */
  imagePathRegistry: ImagePathRegistry | null
  /** Runtime: pre-indexed image data cache: filename -> base64 dataUrl */
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
  /** Runtime: background vault indexing progress info */
  bgLoadingInfo: { label: string; done: number; total: number } | null
  /** Runtime: last file change diff info */
  watchDiff: { filePath: string; added: number; removed: number; preview: string } | null

  // Setters
  setVaultPath: (path: string | null) => void
  setLoadedDocuments: (docs: LoadedDocument[] | null) => void
  /** Get all vault documents merged (for bot cross-vault search) */
  getAllVaultDocs: () => LoadedDocument[]
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
  /** Cache vault documents (for background pre-indexing) */
  cacheVaultDocs: (vaultId: string, docs: LoadedDocument[]) => void
  /** Set background indexing progress info */
  setBgLoadingInfo: (info: { label: string; done: number; total: number } | null) => void
  /** Set file change diff */
  setWatchDiff: (diff: VaultState['watchDiff']) => void

  // Multi-Vault
  /** Register a new vault and return its ID. No automatic switch. */
  addVault: (path: string, label?: string) => string
  /** Remove a vault. If it's the active vault, switch to another. */
  removeVault: (id: string) => void
  /** Switch active vault and update vaultPath. */
  switchVault: (id: string) => void
  /** Change a vault's label. */
  updateVaultLabel: (id: string, label: string) => void
}

function generateVaultId(): string {
  return `vault_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

function labelFromPath(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() ?? path
}

export const useVaultStore = create<VaultState>()(
  persist(
    (set, get) => ({
      vaults: {},
      activeVaultId: '',
      vaultPath: null,
      loadedDocuments: null,
      vaultDocsCache: {},
      vaultMetaCache: {},
      vaultFolders: [],
      imagePathRegistry: null,
      imageDataCache: {},
      isLoading: false,
      vaultReady: false,
      loadingProgress: 0,
      loadingPhase: '',
      error: null,
      pendingFileCount: null,
      bgLoadingInfo: null,
      watchDiff: null,

      setVaultPath: (vaultPath) => set((s) => {
        // Also update the active vault's path record
        if (vaultPath && s.activeVaultId && s.vaults[s.activeVaultId]) {
          return {
            vaultPath,
            vaults: {
              ...s.vaults,
              [s.activeVaultId]: {
                ...s.vaults[s.activeVaultId],
                path: vaultPath,
                label: s.vaults[s.activeVaultId].label || labelFromPath(vaultPath),
              },
            },
          }
        }
        // No active vault yet -> create one
        if (vaultPath) {
          const id = s.activeVaultId || generateVaultId()
          return {
            vaultPath,
            activeVaultId: id,
            vaults: {
              ...s.vaults,
              [id]: { path: vaultPath, label: labelFromPath(vaultPath) },
            },
          }
        }
        return { vaultPath }
      }),

      setLoadedDocuments: (loadedDocuments) => set((s) => {
        if (loadedDocuments && s.activeVaultId) {
          const label = s.vaults[s.activeVaultId]?.label ?? s.activeVaultId
          // Skip full remap if all docs already carry the correct label
          const needsStamp = loadedDocuments.some(d => d.vaultLabel !== label)
          const stamped = needsStamp
            ? loadedDocuments.map(d => d.vaultLabel === label ? d : { ...d, vaultLabel: label })
            : loadedDocuments
          return { loadedDocuments: stamped, vaultDocsCache: { ...s.vaultDocsCache, [s.activeVaultId]: stamped } }
        }
        return { loadedDocuments }
      }),
      getAllVaultDocs: () => Object.values(get().vaultDocsCache).flat(),
      setVaultFolders: (vaultFolders) => set((s) => {
        if (!s.activeVaultId) return { vaultFolders }
        const prev = s.vaultMetaCache[s.activeVaultId] ?? { imageRegistry: null, folders: [] }
        return {
          vaultFolders,
          vaultMetaCache: { ...s.vaultMetaCache, [s.activeVaultId]: { ...prev, folders: vaultFolders } }
        }
      }),
      setImagePathRegistry: (imagePathRegistry) => set((s) => {
        if (!s.activeVaultId) return { imagePathRegistry }
        const prev = s.vaultMetaCache[s.activeVaultId] ?? { imageRegistry: null, folders: [] }
        return {
          imagePathRegistry,
          vaultMetaCache: { ...s.vaultMetaCache, [s.activeVaultId]: { ...prev, imageRegistry: imagePathRegistry } }
        }
      }),
      addImageDataCache: (entries) =>
        set((s) => {
          const merged = { ...s.imageDataCache, ...entries }
          // Cap cache at ~50MB (base64 string length ~ byte size)
          const MAX_BYTES = 50 * 1024 * 1024
          const TARGET_BYTES = MAX_BYTES * 0.75  // evict to 75% on overflow
          const keys = Object.keys(merged)
          let totalBytes = keys.reduce((sum, k) => sum + merged[k].length, 0)
          if (totalBytes > MAX_BYTES) {
            let i = 0
            while (totalBytes > TARGET_BYTES && i < keys.length - 1) {
              totalBytes -= merged[keys[i]].length
              delete merged[keys[i]]
              i++
            }
          }
          return { imageDataCache: merged }
        }),
      clearImageDataCache: () => set({ imageDataCache: {} }),
      setIsLoading: (isLoading) => set({ isLoading }),
      setVaultReady: (vaultReady) => set({ vaultReady }),
      setLoadingProgress: (loadingProgress, loadingPhase = '') =>
        set({ loadingProgress, loadingPhase }),
      setError: (error) => set({ error }),
      setPendingFileCount: (pendingFileCount) => set({ pendingFileCount }),
      clearVault: () =>
        set({ vaultPath: null, loadedDocuments: null, vaultFolders: [], imagePathRegistry: null, imageDataCache: {}, error: null, isLoading: false, vaultReady: false, loadingProgress: 0, loadingPhase: '', pendingFileCount: null }),

      cacheVaultDocs: (vaultId, docs) => set((s) => {
        const label = s.vaults[vaultId]?.label ?? vaultId
        const needsStamp = docs.some(d => d.vaultLabel !== label)
        const stamped = needsStamp
          ? docs.map(d => d.vaultLabel === label ? d : { ...d, vaultLabel: label })
          : docs
        return { vaultDocsCache: { ...s.vaultDocsCache, [vaultId]: stamped } }
      }),

      setBgLoadingInfo: (bgLoadingInfo) => set({ bgLoadingInfo }),
      setWatchDiff: (watchDiff) => set({ watchDiff }),

      // Multi-Vault actions
      addVault: (path, label) => {
        const { vaults } = get()
        // If path already exists, return that ID
        const existing = Object.entries(vaults).find(([, v]) => v.path === path)
        if (existing) return existing[0]
        if (Object.keys(vaults).length >= 8) return ''
        const id = generateVaultId()
        set((s) => ({
          vaults: { ...s.vaults, [id]: { path, label: label ?? labelFromPath(path) } },
        }))
        return id
      },

      removeVault: (id) => {
        const { vaults, activeVaultId } = get()
        const newVaults = { ...vaults }
        delete newVaults[id]
        const ids = Object.keys(newVaults)
        if (id === activeVaultId && ids.length > 0) {
          const nextId = ids[0]
          set({ vaults: newVaults, activeVaultId: nextId, vaultPath: newVaults[nextId].path })
        } else if (id === activeVaultId) {
          set({ vaults: newVaults, activeVaultId: '', vaultPath: null })
        } else {
          set({ vaults: newVaults })
        }
      },

      switchVault: (id) => {
        const { vaults } = get()
        const entry = vaults[id]
        if (!entry) return
        set({ activeVaultId: id, vaultPath: entry.path })
      },

      updateVaultLabel: (id, label) => {
        set((s) => ({
          vaults: s.vaults[id]
            ? { ...s.vaults, [id]: { ...s.vaults[id], label } }
            : s.vaults,
        }))
      },
    }),
    {
      name: 'strata-sync-vault',
      // Persist vaultPath, vaults, activeVaultId
      partialize: (state) => ({
        vaultPath: state.vaultPath,
        vaults: state.vaults,
        activeVaultId: state.activeVaultId,
      }),
      // Migration: old state had only vaultPath, no vaults
      merge: (persisted: any, current) => {
        const merged = { ...current, ...persisted }
        // If old state: vaultPath exists but vaults is empty -> create default entry
        if (merged.vaultPath && (!merged.vaults || Object.keys(merged.vaults).length === 0)) {
          const id = merged.activeVaultId || generateVaultId()
          merged.vaults = { [id]: { path: merged.vaultPath, label: labelFromPath(merged.vaultPath) } }
          merged.activeVaultId = id
        }
        return merged
      },
    }
  )
)
