/**
 * trashStore — session-scoped soft-delete buffer.
 * Not persisted. Cleared on app restart.
 */

import { create } from 'zustand'

export interface TrashItem {
  id: string
  filename: string
  absolutePath: string
  folderPath: string
  content: string
  deletedAt: number  // ms timestamp
}

interface TrashState {
  items: TrashItem[]
  push: (item: Omit<TrashItem, 'id' | 'deletedAt'>) => void
  remove: (id: string) => void
  clear: () => void
}

export const useTrashStore = create<TrashState>()((set) => ({
  items: [],
  push: (item) =>
    set((s) => ({
      items: [
        { ...item, id: `${Date.now()}-${Math.random()}`, deletedAt: Date.now() },
        ...s.items,
      ],
    })),
  remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
  clear: () => set({ items: [] }),
}))
