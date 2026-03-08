import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface MemoryState {
  memoryText: string
  setMemoryText: (text: string) => void
  appendToMemory: (text: string) => void
  clearMemory: () => void
}

/**
 * AI long-term memory store.
 * Persisted to localStorage and injected into the system prompt across all conversation sessions.
 */
export const useMemoryStore = create<MemoryState>()(
  persist(
    (set) => ({
      memoryText: '',
      setMemoryText: (text) => set({ memoryText: text }),
      appendToMemory: (text) => set(s => ({ memoryText: s.memoryText ? s.memoryText + '\n\n' + text : text })),
      clearMemory: () => set({ memoryText: '' }),
    }),
    { name: 'strata-sync-ai-memory' }
  )
)
