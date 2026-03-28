/**
 * backendStore.ts — Phase 1-3
 *
 * Tracks the Python FastAPI backend's runtime state.
 * NOT persisted — backend status is detected fresh on each app launch.
 */

import { create } from 'zustand'
import { BACKEND_DEFAULT_PORT } from '@/lib/constants'

interface BackendState {
  /** True once the Python server is ready */
  isReady: boolean
  /** Port the backend is listening on */
  port: number
  /** Number of document chunks indexed in ChromaDB */
  chunkCount: number
  /** True while indexDocuments() is in flight */
  isIndexing: boolean
  /** Indexing progress 0–100 (100 = done) */
  indexingProgress: number
  /** Last error message, null if none */
  error: string | null

  setReady: (ready: boolean, port?: number) => void
  setChunkCount: (count: number) => void
  setIndexing: (indexing: boolean) => void
  setIndexingProgress: (progress: number) => void
  setError: (error: string | null) => void
  reset: () => void
}

const DEFAULT_STATE = {
  isReady: false,
  port: BACKEND_DEFAULT_PORT,
  chunkCount: 0,
  isIndexing: false,
  indexingProgress: 0,
  error: null,
}

export const useBackendStore = create<BackendState>()((set) => ({
  ...DEFAULT_STATE,

  setReady: (isReady, port) =>
    set((state) => ({ isReady, port: port !== undefined ? port : state.port })),

  setChunkCount: (chunkCount) => set({ chunkCount }),

  setIndexing: (isIndexing) =>
    set({ isIndexing, indexingProgress: isIndexing ? 0 : 100 }),

  setIndexingProgress: (indexingProgress) => set({ indexingProgress }),

  setError: (error) => set({ error }),

  reset: () => set({ ...DEFAULT_STATE }),
}))
