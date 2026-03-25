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
      appendToMemory: (text) => set(s => {
        const combined = s.memoryText ? s.memoryText + '\n\n' + text : text
        // Cap at 10,000 chars to prevent context bloat (keep most recent content)
        return { memoryText: combined.length > 10000 ? combined.slice(combined.length - 10000) : combined }
      }),
      clearMemory: () => set({ memoryText: '' }),
    }),
    { name: 'strata-sync-ai-memory' }
  )
)
