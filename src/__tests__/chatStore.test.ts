import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { useChatStore } from '@/stores/chatStore'

// ── Mock llmClient ─────────────────────────────────────────────────────────────
// Use module-level state variable pattern (see MEMORY.md)

let _mockChunks: string[] = ['[Mock] test response']
let _mockShouldThrow = false

vi.mock('@/services/llmClient', () => ({
  streamMessage: async (
    _persona: unknown,
    _userMessage: unknown,
    _history: unknown,
    onChunk: (chunk: string) => void
  ) => {
    if (_mockShouldThrow) {
      throw new Error('Mock LLM error')
    }
    for (const chunk of _mockChunks) {
      onChunk(chunk)
    }
  },
}))

// ── Helpers ────────────────────────────────────────────────────────────────────

function resetStore() {
  useChatStore.setState({
    activePersonas: ['chief_director'],
    messages: [],
    isLoading: false,
  })
}

function resetMockState() {
  _mockChunks = ['[Mock] test response']
  _mockShouldThrow = false
}

/** Flush the 50ms chunk batch timer so buffered chunks are applied to state */
function flushChunkBuffer() {
  vi.advanceTimersByTime(50)
}

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers()
  resetStore()
  resetMockState()
})

afterEach(() => {
  vi.useRealTimers()
})

// ── togglePersona ──────────────────────────────────────────────────────────────

describe('useChatStore — togglePersona()', () => {
  it('adds a persona when not active', () => {
    useChatStore.getState().togglePersona('art_director')
    expect(useChatStore.getState().activePersonas).toContain('art_director')
  })

  it('removes a persona when already active', () => {
    useChatStore.getState().togglePersona('chief_director')
    expect(useChatStore.getState().activePersonas).not.toContain('chief_director')
  })

  it('supports multi-select', () => {
    useChatStore.getState().togglePersona('art_director')
    useChatStore.getState().togglePersona('plan_director')
    const { activePersonas } = useChatStore.getState()
    expect(activePersonas).toContain('chief_director')
    expect(activePersonas).toContain('art_director')
    expect(activePersonas).toContain('plan_director')
  })

  it('toggles off each added persona', () => {
    useChatStore.getState().togglePersona('art_director')
    useChatStore.getState().togglePersona('art_director')
    expect(useChatStore.getState().activePersonas).not.toContain('art_director')
  })
})

// ── setPersonas ────────────────────────────────────────────────────────────────

describe('useChatStore — setPersonas()', () => {
  it('replaces all active personas', () => {
    useChatStore.getState().setPersonas(['prog_director', 'level_director'])
    const { activePersonas } = useChatStore.getState()
    expect(activePersonas).toEqual(['prog_director', 'level_director'])
  })
})

// ── appendChunk / finishStreaming ──────────────────────────────────────────────

describe('useChatStore — appendChunk() / finishStreaming()', () => {
  it('appendChunk appends text to the target message after flush', () => {
    useChatStore.setState({
      messages: [
        { id: 'msg1', persona: 'chief_director', role: 'assistant', content: 'Hello', timestamp: 1, streaming: true },
      ],
      activePersonas: ['chief_director'],
      isLoading: true,
    })
    useChatStore.getState().appendChunk('msg1', ' World')
    flushChunkBuffer()
    const msg = useChatStore.getState().messages[0]
    expect(msg.content).toBe('Hello World')
  })

  it('appendChunk only affects the target message', () => {
    useChatStore.setState({
      messages: [
        { id: 'msg1', persona: 'chief_director', role: 'assistant', content: 'A', timestamp: 1, streaming: true },
        { id: 'msg2', persona: 'art_director',   role: 'assistant', content: 'B', timestamp: 2, streaming: true },
      ],
      activePersonas: ['chief_director'],
      isLoading: true,
    })
    useChatStore.getState().appendChunk('msg1', '-appended')
    flushChunkBuffer()
    const msgs = useChatStore.getState().messages
    expect(msgs[0].content).toBe('A-appended')
    expect(msgs[1].content).toBe('B') // unchanged
  })

  it('finishStreaming sets streaming: false on the target message', () => {
    useChatStore.setState({
      messages: [
        { id: 'msg1', persona: 'chief_director', role: 'assistant', content: 'text', timestamp: 1, streaming: true },
      ],
      activePersonas: ['chief_director'],
      isLoading: false,
    })
    useChatStore.getState().finishStreaming('msg1')
    expect(useChatStore.getState().messages[0].streaming).toBe(false)
  })
})

// ── sendMessage ────────────────────────────────────────────────────────────────

describe('useChatStore — sendMessage()', () => {
  it('adds a user message immediately', async () => {
    const promise = useChatStore.getState().sendMessage('test message')
    const { messages } = useChatStore.getState()
    expect(messages.length).toBeGreaterThanOrEqual(1)
    expect(messages[0].role).toBe('user')
    expect(messages[0].content).toBe('test message')
    await vi.runAllTimersAsync()
    await promise
  })

  it('sets isLoading to true while waiting', async () => {
    const promise = useChatStore.getState().sendMessage('loading test')
    expect(useChatStore.getState().isLoading).toBe(true)
    await vi.runAllTimersAsync()
    await promise
    expect(useChatStore.getState().isLoading).toBe(false)
  })

  it('adds assistant message for each active persona', async () => {
    useChatStore.getState().setPersonas(['chief_director', 'art_director'])
    const promise = useChatStore.getState().sendMessage('multi persona')
    await vi.runAllTimersAsync()
    await promise
    const { messages } = useChatStore.getState()
    const assistantMessages = messages.filter((m) => m.role === 'assistant')
    expect(assistantMessages).toHaveLength(2)
    expect(assistantMessages.some((m) => m.persona === 'chief_director')).toBe(true)
    expect(assistantMessages.some((m) => m.persona === 'art_director')).toBe(true)
  })

  it('does nothing for empty/whitespace messages', async () => {
    await useChatStore.getState().sendMessage('   ')
    expect(useChatStore.getState().messages).toHaveLength(0)
  })

  it('assistant message content is non-empty after streaming completes', async () => {
    _mockChunks = ['response', ' content', ' done']
    const promise = useChatStore.getState().sendMessage('help')
    await vi.runAllTimersAsync()
    await promise
    const assistantMsgs = useChatStore.getState().messages.filter((m) => m.role === 'assistant')
    for (const msg of assistantMsgs) {
      expect(msg.content.length).toBeGreaterThan(0)
    }
  })

  it('assistant message has streaming: false after completion', async () => {
    const promise = useChatStore.getState().sendMessage('test')
    await vi.runAllTimersAsync()
    await promise
    const assistantMsgs = useChatStore.getState().messages.filter((m) => m.role === 'assistant')
    for (const msg of assistantMsgs) {
      expect(msg.streaming).toBe(false)
    }
  })

  it('assistant message accumulates chunks correctly', async () => {
    _mockChunks = ['chunk1', ' chunk2', ' chunk3']
    const promise = useChatStore.getState().sendMessage('stream test')
    await vi.runAllTimersAsync()
    await promise
    const assistantMsg = useChatStore.getState().messages.find((m) => m.role === 'assistant')
    expect(assistantMsg?.content).toBe('chunk1 chunk2 chunk3')
  })

  it('on error, assistant message contains error prefix', async () => {
    _mockShouldThrow = true
    const promise = useChatStore.getState().sendMessage('error test')
    await vi.runAllTimersAsync()
    await promise
    const assistantMsg = useChatStore.getState().messages.find((m) => m.role === 'assistant')
    expect(assistantMsg?.content).toContain('[Error]')
    expect(assistantMsg?.streaming).toBe(false)
  })
})

// ── stopStreaming ──────────────────────────────────────────────────────────────

describe('useChatStore — stopStreaming()', () => {
  it('sets isLoading to false', () => {
    useChatStore.setState({ isLoading: true })
    useChatStore.getState().stopStreaming()
    expect(useChatStore.getState().isLoading).toBe(false)
  })

  it('can be called safely when nothing is streaming', () => {
    useChatStore.setState({ isLoading: false, messages: [] })
    expect(() => useChatStore.getState().stopStreaming()).not.toThrow()
    expect(useChatStore.getState().isLoading).toBe(false)
  })
})

// ── appendThinkingChunk ─────────────────────────────────────────────────────────

describe('useChatStore — appendThinkingChunk()', () => {
  it('appends thinking content to the correct message after flush', () => {
    useChatStore.setState({
      messages: [
        { id: 'msg1', persona: 'chief_director', role: 'assistant', content: '', timestamp: 1, streaming: true },
      ],
      activePersonas: ['chief_director'],
      isLoading: true,
    })
    useChatStore.getState().appendThinkingChunk('msg1', 'thinking step 1')
    flushChunkBuffer()
    const msg = useChatStore.getState().messages[0]
    expect(msg.thinking).toBe('thinking step 1')
  })

  it('accumulates multiple thinking chunks', () => {
    useChatStore.setState({
      messages: [
        { id: 'msg1', persona: 'chief_director', role: 'assistant', content: '', timestamp: 1, streaming: true },
      ],
      activePersonas: ['chief_director'],
      isLoading: true,
    })
    useChatStore.getState().appendThinkingChunk('msg1', 'part1')
    useChatStore.getState().appendThinkingChunk('msg1', ' part2')
    flushChunkBuffer()
    const msg = useChatStore.getState().messages[0]
    expect(msg.thinking).toBe('part1 part2')
  })

  it('does not affect content field', () => {
    useChatStore.setState({
      messages: [
        { id: 'msg1', persona: 'chief_director', role: 'assistant', content: 'original', timestamp: 1, streaming: true },
      ],
      activePersonas: ['chief_director'],
      isLoading: true,
    })
    useChatStore.getState().appendThinkingChunk('msg1', 'thinking...')
    flushChunkBuffer()
    const msg = useChatStore.getState().messages[0]
    expect(msg.content).toBe('original')
    expect(msg.thinking).toBe('thinking...')
  })

  it('finishStreaming flushes pending thinking chunks', () => {
    useChatStore.setState({
      messages: [
        { id: 'msg1', persona: 'chief_director', role: 'assistant', content: '', timestamp: 1, streaming: true },
      ],
      activePersonas: ['chief_director'],
      isLoading: true,
    })
    useChatStore.getState().appendThinkingChunk('msg1', 'buffered thinking')
    // Do NOT flush — finishStreaming should flush remaining thinking chunks itself
    useChatStore.getState().finishStreaming('msg1')
    const msg = useChatStore.getState().messages[0]
    expect(msg.thinking).toBe('buffered thinking')
    expect(msg.streaming).toBe(false)
  })
})

// ── Chunk batching behavior ─────────────────────────────────────────────────────

describe('useChatStore — chunk batching', () => {
  it('chunks are buffered until flush timer fires', () => {
    useChatStore.setState({
      messages: [
        { id: 'msg1', persona: 'chief_director', role: 'assistant', content: '', timestamp: 1, streaming: true },
      ],
      activePersonas: ['chief_director'],
      isLoading: true,
    })
    useChatStore.getState().appendChunk('msg1', 'hello')
    // Before flush, content is still empty
    expect(useChatStore.getState().messages[0].content).toBe('')
    // After flush, content is updated
    flushChunkBuffer()
    expect(useChatStore.getState().messages[0].content).toBe('hello')
  })

  it('multiple chunks within same flush window are batched together', () => {
    useChatStore.setState({
      messages: [
        { id: 'msg1', persona: 'chief_director', role: 'assistant', content: '', timestamp: 1, streaming: true },
      ],
      activePersonas: ['chief_director'],
      isLoading: true,
    })
    useChatStore.getState().appendChunk('msg1', 'a')
    useChatStore.getState().appendChunk('msg1', 'b')
    useChatStore.getState().appendChunk('msg1', 'c')
    flushChunkBuffer()
    expect(useChatStore.getState().messages[0].content).toBe('abc')
  })
})

// ── clearMessages ──────────────────────────────────────────────────────────────

describe('useChatStore — clearMessages()', () => {
  it('clears all messages', async () => {
    const promise = useChatStore.getState().sendMessage('msg 1')
    await vi.runAllTimersAsync()
    await promise
    useChatStore.getState().clearMessages()
    expect(useChatStore.getState().messages).toHaveLength(0)
  })

  it('resets isLoading to false', () => {
    useChatStore.setState({ isLoading: true })
    useChatStore.getState().clearMessages()
    expect(useChatStore.getState().isLoading).toBe(false)
  })
})
