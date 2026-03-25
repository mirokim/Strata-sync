import { create } from 'zustand'
import type { ChatMessage, SpeakerId, Attachment } from '@/types'
import { generateId } from '@/lib/utils'
import { STREAM_STAGGER_MS } from '@/lib/constants'
import { streamMessage } from '@/services/llmClient'
import { SPEAKER_IDS } from '@/lib/speakerConfig'

const DEFAULT_PERSONA = SPEAKER_IDS[0]

// Module-level abort controller — replaced each sendMessage, aborted by stopStreaming
let _activeAbortController: AbortController | null = null

// Chunk batch buffer — flush every 50ms in a single setState to reduce React re-renders
const _pendingChunks = new Map<string, string>()
const _pendingThinkingChunks = new Map<string, string>()
let _flushTimer: ReturnType<typeof setTimeout> | null = null
let _flushSet: ((fn: (s: ChatState) => Partial<ChatState> | ChatState) => void) | null = null

function _scheduleFlush() {
  if (_flushTimer !== null) return
  _flushTimer = setTimeout(() => {
    _flushTimer = null
    if ((_pendingChunks.size === 0 && _pendingThinkingChunks.size === 0) || !_flushSet) return
    const snapshot = new Map(_pendingChunks)
    const snapshotThinking = new Map(_pendingThinkingChunks)
    _pendingChunks.clear()
    _pendingThinkingChunks.clear()
    _flushSet((state) => {
      const messages = state.messages.slice()
      let changed = false
      for (const [id, chunk] of snapshot) {
        const idx = messages.findIndex((m) => m.id === id)
        if (idx === -1) continue
        messages[idx] = { ...messages[idx], content: messages[idx].content + chunk }
        changed = true
      }
      for (const [id, chunk] of snapshotThinking) {
        const idx = messages.findIndex((m) => m.id === id)
        if (idx === -1) continue
        messages[idx] = { ...messages[idx], thinking: (messages[idx].thinking ?? '') + chunk }
        changed = true
      }
      return changed ? { messages } : state
    })
  }, 50)
}

interface ChatState {
  activePersonas: SpeakerId[]
  messages: ChatMessage[]
  isLoading: boolean

  togglePersona: (id: SpeakerId) => void
  setPersonas: (ids: SpeakerId[]) => void
  /** Append a streaming chunk to an existing assistant message */
  appendChunk: (messageId: string, chunk: string) => void
  /** Append a thinking/sub-agent chunk to an existing assistant message */
  appendThinkingChunk: (messageId: string, chunk: string) => void
  /** Mark a streaming message as finished */
  finishStreaming: (messageId: string) => void
  sendMessage: (text: string, attachments?: Attachment[]) => Promise<void>
  /** Abort any in-flight streaming requests */
  stopStreaming: () => void
  clearMessages: () => void
  /** Restore previous session from IndexedDB */
  restoreSession: () => Promise<void>
}

export const useChatStore = create<ChatState>()((set, get) => {
  _flushSet = set as typeof _flushSet
  return {
  activePersonas: [DEFAULT_PERSONA],
  messages: [],
  isLoading: false,

  togglePersona: (id) =>
    set((state) => ({
      activePersonas: state.activePersonas.includes(id)
        ? state.activePersonas.filter((p) => p !== id)
        : [...state.activePersonas, id],
    })),

  setPersonas: (ids) => set({ activePersonas: ids }),

  appendChunk: (messageId, chunk) => {
    // Buffer chunks and apply every 50ms — prevents per-chunk setState
    _pendingChunks.set(messageId, (_pendingChunks.get(messageId) ?? '') + chunk)
    _scheduleFlush()
  },

  appendThinkingChunk: (messageId, chunk) => {
    // Buffer chunks and apply every 50ms — same batch pattern as appendChunk
    _pendingThinkingChunks.set(messageId, (_pendingThinkingChunks.get(messageId) ?? '') + chunk)
    _scheduleFlush()
  },

  finishStreaming: (messageId) => {
    // Flush any remaining buffered chunks immediately, then mark streaming: false
    if (_flushTimer !== null) {
      clearTimeout(_flushTimer)
      _flushTimer = null
    }
    set((state) => {
      const messages = state.messages.slice()
      let changed = false
      // Flush remaining content buffer
      const pending = _pendingChunks.get(messageId)
      if (pending) {
        _pendingChunks.delete(messageId)
        const idx = messages.findIndex((m) => m.id === messageId)
        if (idx !== -1) {
          messages[idx] = { ...messages[idx], content: messages[idx].content + pending }
          changed = true
        }
      }
      // Flush remaining thinking buffer
      const pendingThinking = _pendingThinkingChunks.get(messageId)
      if (pendingThinking) {
        _pendingThinkingChunks.delete(messageId)
        const idx = messages.findIndex((m) => m.id === messageId)
        if (idx !== -1) {
          messages[idx] = { ...messages[idx], thinking: (messages[idx].thinking ?? '') + pendingThinking }
          changed = true
        }
      }
      const idx = messages.findIndex((m) => m.id === messageId)
      if (idx !== -1) {
        messages[idx] = { ...messages[idx], streaming: false }
        changed = true
      }
      return changed ? { messages } : state
    })
  },

  sendMessage: async (text: string, attachments?: Attachment[]) => {
    const { activePersonas } = get()
    const trimmed = text.trim()
    if (!trimmed && (!attachments || attachments.length === 0)) return

    // Create a fresh abort controller for this request
    _activeAbortController?.abort()
    const abortController = new AbortController()
    _activeAbortController = abortController
    const signal = abortController.signal

    // Add user message (include attachments if provided)
    const userMsg: ChatMessage = {
      id: generateId(),
      persona: activePersonas[0] ?? DEFAULT_PERSONA,
      role: 'user',
      content: trimmed,
      timestamp: Date.now(),
      attachments: attachments?.length ? attachments : undefined,
    }
    set((state) => ({ messages: [...state.messages, userMsg], isLoading: true }))

    const personasToRespond =
      activePersonas.length > 0 ? activePersonas : ([DEFAULT_PERSONA] as SpeakerId[])

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
      // Snapshot history before adding placeholder — prevents empty placeholders leaking into concurrent streams
      const history = get().messages.slice()
      set((state) => ({ messages: [...state.messages, assistantMsg] }))

      try {
        await streamMessage(persona, trimmed, history, (chunk) => {
          get().appendChunk(assistantMsgId, chunk)
        }, attachments, undefined, (chunk) => {
          get().appendThinkingChunk(assistantMsgId, chunk)
        }, signal)
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          // User stopped streaming — mark message as finished without appending error
        } else {
          const errMsg = err instanceof Error ? err.message : String(err)
          const friendlyMsg = errMsg.includes('401') ? '[Error] API key is invalid. Please check your API key in settings.'
            : errMsg.includes('429') ? '[Error] API rate limit exceeded. Please try again later.'
            : errMsg.includes('network') || errMsg.includes('fetch') ? '[Error] Please check your network connection.'
            : `[Error] ${errMsg}`
          get().appendChunk(assistantMsgId, friendlyMsg)
        }
      } finally {
        get().finishStreaming(assistantMsgId)
      }
    })

    // allSettled: each persona streams to completion independently; one failure doesn't abort others
    await Promise.allSettled(streamingPromises)
    // Only clear isLoading if this is still the active controller (stopStreaming may have already cleared it)
    if (_activeAbortController === abortController) {
      _activeAbortController = null
      set({ isLoading: false })
    }
  },

  stopStreaming: () => {
    _activeAbortController?.abort()
    _activeAbortController = null
    set({ isLoading: false })
  },

  clearMessages: () => {
    // Clear pending chunk flush timer to avoid stale writes
    if (_flushTimer !== null) {
      clearTimeout(_flushTimer)
      _flushTimer = null
    }
    _pendingChunks.clear()
    _pendingThinkingChunks.clear()
    // Clear the auto-save debounce timer
    if (_saveChatTimer) {
      clearTimeout(_saveChatTimer)
      _saveChatTimer = null
    }
    set({ messages: [], isLoading: false })
    // Clear persisted session if chatSessionDb is available
    try {
      import('@/lib/chatSessionDb').then(m => m.clearChatSession()).catch(() => {})
    } catch { /* chatSessionDb may not exist yet */ }
  },

  restoreSession: async () => {
    try {
      const { loadChatSession } = await import('@/lib/chatSessionDb')
      const messages = await loadChatSession()
      if (messages.length > 0) set({ messages })
    } catch {
      // chatSessionDb not available — skip session restore
    }
  },
} // return
}) // create

// Auto-persist messages to IndexedDB (debounced, skip while streaming)
let _saveChatTimer: ReturnType<typeof setTimeout> | null = null
useChatStore.subscribe((state) => {
  const { messages } = state
  if (messages.some(m => m.streaming)) return
  if (_saveChatTimer) clearTimeout(_saveChatTimer)
  _saveChatTimer = setTimeout(() => {
    import('@/lib/chatSessionDb').then(m => m.saveChatSession(messages)).catch(() => {})
  }, 800)
})

