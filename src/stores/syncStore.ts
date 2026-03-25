import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface SyncNotification {
  message: string
  count: number
  at: string
}

interface SyncStore {
  lastSyncAt: string | null
  notification: SyncNotification | null
  setLastSyncAt: (at: string) => void
  setNotification: (n: SyncNotification | null) => void
  dismissNotification: () => void
}

export const useSyncStore = create<SyncStore>()(
  persist(
    (set) => ({
      lastSyncAt: null,
      notification: null,
      setLastSyncAt: (lastSyncAt) => set({ lastSyncAt }),
      setNotification: (notification) => set({ notification }),
      dismissNotification: () => set({ notification: null }),
    }),
    {
      name: 'strata-sync-sync',
      partialize: (s) => ({ lastSyncAt: s.lastSyncAt }),
    }
  )
)
