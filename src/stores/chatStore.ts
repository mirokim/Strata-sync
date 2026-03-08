import { create } from 'zustand'
import type { ChatMessage, SpeakerId, Attachment } from '@/types'
import { generateId } from '@/lib/utils'
import { STREAM_STAGGER_MS } from '@/lib/constants'
import { streamMessage } from '@/services/llmClient'
import { SPEAKER_IDS } from '@/lib/speakerConfig'

interface ChatState {
  activePersonas: SpeakerId[]
  messages: ChatMessage[]
  isLoading: boolean

  togglePersona: (id: SpeakerId) => void
  setPersonas: (ids: SpeakerId[]) => void
  /** Append a streaming chunk to an existing assistant message */
  appendChunk: (messageId: string, chunk: string) => void
  /** Mark a streaming message as finished */
  finishStreaming: (messageId: string) => void
  sendMessage: (text: string, attachments?: Attachment[]) => Promise<void>
  clearMessages: () => void
}

export const useChatStore = create<ChatState>()((set, get) => ({
  activePersonas: ['chief_director'],
  messages: [],
  isLoading: false,

  togglePersona: (id) =>
    set((state) => ({
      activePersonas: state.activePersonas.includes(id)
        ? state.activePersonas.filter((p) => p !== id)
        : [...state.activePersonas, id],
    })),

  setPersonas: (ids) => set({ activePersonas: ids }),

  appendChunk: (messageId, chunk) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === messageId ? { ...m, content: m.content + chunk } : m
      ),
    })),

  finishStreaming: (messageId) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === messageId ? { ...m, streaming: false } : m
      ),
    })),

  sendMessage: async (text: string, attachments?: Attachment[]) => {
    const { activePersonas } = get()
    const trimmed = text.trim()
    if (!trimmed && (!attachments || attachments.length === 0)) return

    // Add user message (include attachments if provided)
    const userMsg: ChatMessage = {
      id: generateId(),
      persona: activePersonas[0] ?? 'chief_director',
      role: 'user',
      content: trimmed,
      timestamp: Date.now(),
      attachments: attachments?.length ? attachments : undefined,
    }
    set((state) => ({ messages: [...state.messages, userMsg], isLoading: true }))

    const personasToRespond =
      activePersonas.length > 0 ? activePersonas : (['chief_director'] as SpeakerId[])

    // Stream all personas concurrently (with small staggered start)
    const streamingPromises = personasToRespond.map(async (persona, i) => {
      // Small staggered delay so messages appear sequentially
      await new Promise<void>((r) => setTimeout(r, i * STREAM_STAGGER_MS))

      // Create placeholder message with streaming: true
      const assistantMsgId = generateId()
      const assistantMsg: ChatMessage = {
        id: assistantMsgId,
        persona,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        streaming: true,
      }
      set((state) => ({ messages: [...state.messages, assistantMsg] }))

      // Get current history at this point (excludes the just-created assistant msg)
      const history = get().messages.filter((m) => m.id !== assistantMsgId)

      try {
        await streamMessage(persona, trimmed, history, (chunk) => {
          get().appendChunk(assistantMsgId, chunk)
        }, attachments)
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        get().appendChunk(assistantMsgId, `[Error] ${errMsg}`)
      } finally {
        get().finishStreaming(assistantMsgId)
      }
    })

    await Promise.all(streamingPromises)
    set({ isLoading: false })
  },

  clearMessages: () => set({ messages: [], isLoading: false }),
}))

export { SPEAKER_IDS }
