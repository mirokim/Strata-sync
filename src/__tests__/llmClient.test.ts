import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import type { ChatMessage, SpeakerId } from '@/types'
import { useSettingsStore } from '@/stores/settingsStore'
import { useVaultStore } from '@/stores/vaultStore'
import { useGraphStore } from '@/stores/graphStore'
import { DEFAULT_PERSONA_MODELS } from '@/lib/modelConfig'

// ── SSE stream helpers ─────────────────────────────────────────────────────────

/** Create a ReadableStream that emits SSE data lines */
function makeSSEStream(dataLines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const line of dataLines) {
        controller.enqueue(encoder.encode(line))
      }
      controller.close()
    },
  })
}

function makeAnthropicStream(texts: string[]): ReadableStream<Uint8Array> {
  const lines = texts.map(
    (text) =>
      `data: ${JSON.stringify({
        type: 'content_block_delta',
        delta: { type: 'text_delta', text },
      })}\n`
  )
  lines.push('data: [DONE]\n')
  return makeSSEStream(lines)
}

function makeOpenAIStream(texts: string[]): ReadableStream<Uint8Array> {
  const lines = texts.map(
    (text) =>
      `data: ${JSON.stringify({
        choices: [{ delta: { content: text } }],
      })}\n`
  )
  lines.push('data: [DONE]\n')
  return makeSSEStream(lines)
}

function makeGeminiStream(texts: string[]): ReadableStream<Uint8Array> {
  const lines = texts.map(
    (text) =>
      `data: ${JSON.stringify({
        candidates: [{ content: { parts: [{ text }] } }],
      })}\n`
  )
  // Gemini does not emit [DONE] — stream just closes
  return makeSSEStream(lines)
}

// ── Mock fetch ─────────────────────────────────────────────────────────────────

let _mockFetchResponse: Response | null = null

vi.mock('cross-fetch', () => ({ default: vi.fn() }))

// We patch globalThis.fetch
function mockFetch(stream: ReadableStream<Uint8Array>, ok = true) {
  _mockFetchResponse = new Response(stream, {
    status: ok ? 200 : 401,
    headers: { 'Content-Type': 'text/event-stream' },
  })
  globalThis.fetch = vi.fn().mockResolvedValue(_mockFetchResponse)
}

// ── Store reset helpers ────────────────────────────────────────────────────────

function resetSettings() {
  useSettingsStore.setState({
    personaModels: { ...DEFAULT_PERSONA_MODELS },
    settingsPanelOpen: false,
  })
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('llmClient — streamMessage', () => {
  beforeEach(() => {
    resetSettings()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  // ── Mock fallback (no API key) ─────────────────────────────────────────────

  it('falls back to mock response when no API key is set', async () => {
    // No env key set → import.meta.env.VITE_ANTHROPIC_API_KEY is undefined
    vi.stubEnv('VITE_ANTHROPIC_API_KEY', '')

    const { streamMessage } = await import('@/services/llmClient')
    const chunks: string[] = []
    await streamMessage('chief_director', 'test message', [], (c) => chunks.push(c))

    const fullText = chunks.join('')
    expect(fullText).toContain('[Mock]')
    expect(fullText.length).toBeGreaterThan(10)
  })

  it('falls back to mock for art_director with no OpenAI key', async () => {
    vi.stubEnv('VITE_OPENAI_API_KEY', '')

    const { streamMessage } = await import('@/services/llmClient')
    const chunks: string[] = []
    await streamMessage('art_director', 'color palette related', [], (c) => chunks.push(c))

    expect(chunks.join('')).toContain('[Mock]')
  })

  // ── Anthropic streaming ────────────────────────────────────────────────────

  it('streams Anthropic response when API key is set', async () => {
    vi.stubEnv('VITE_ANTHROPIC_API_KEY', 'test-anthropic-key')
    // chief_director uses Anthropic by default
    mockFetch(makeAnthropicStream(['hello', ' world', '!']))

    const { streamMessage } = await import('@/services/llmClient')
    const chunks: string[] = []
    await streamMessage('chief_director', 'test', [], (c) => chunks.push(c))

    expect(chunks).toEqual(['hello', ' world', '!'])
    expect(globalThis.fetch).toHaveBeenCalledOnce()

    // Verify correct endpoint
    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toContain('anthropic.com')
  })

  it('sends system prompt and user message to Anthropic', async () => {
    vi.stubEnv('VITE_ANTHROPIC_API_KEY', 'test-key')
    mockFetch(makeAnthropicStream(['response']))

    const { streamMessage } = await import('@/services/llmClient')
    await streamMessage('chief_director', 'question here', [], () => {})

    const [, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const body = JSON.parse((options as RequestInit).body as string)

    expect(body.system).toContain('Chief Director')
    expect(body.messages).toContainEqual({ role: 'user', content: 'question here' })
    expect(body.stream).toBe(true)
  })

  // ── OpenAI streaming ───────────────────────────────────────────────────────

  it('streams OpenAI response when API key is set', async () => {
    vi.stubEnv('VITE_OPENAI_API_KEY', 'test-openai-key')
    // art_director uses OpenAI by default
    mockFetch(makeOpenAIStream(['art', ' direction']))

    const { streamMessage } = await import('@/services/llmClient')
    const chunks: string[] = []
    await streamMessage('art_director', 'visual', [], (c) => chunks.push(c))

    expect(chunks).toEqual(['art', ' direction'])
    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toContain('openai.com')
  })

  // ── Gemini streaming ───────────────────────────────────────────────────────

  it('streams Gemini response when API key is set', async () => {
    vi.stubEnv('VITE_GEMINI_API_KEY', 'test-gemini-key')
    // plan_director uses Gemini by default
    mockFetch(makeGeminiStream(['plan', ' opinion']))

    const { streamMessage } = await import('@/services/llmClient')
    const chunks: string[] = []
    await streamMessage('plan_director', 'feature priority', [], (c) => chunks.push(c))

    expect(chunks).toEqual(['plan', ' opinion'])
    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toContain('generativelanguage.googleapis.com')
  })

  it('sends API key via x-goog-api-key header for Gemini', async () => {
    vi.stubEnv('VITE_GEMINI_API_KEY', 'my-gemini-key')
    mockFetch(makeGeminiStream(['ok']))

    const { streamMessage } = await import('@/services/llmClient')
    await streamMessage('plan_director', 'test', [], () => {})

    const [url, opts] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).not.toContain('key=')
    expect(opts.headers['x-goog-api-key']).toBe('my-gemini-key')
  })

  // ── Grok streaming ─────────────────────────────────────────────────────────

  it('streams Grok response when API key is set', async () => {
    vi.stubEnv('VITE_GROK_API_KEY', 'test-grok-key')
    // level_director uses Grok by default
    mockFetch(makeOpenAIStream(['level', ' design']))

    const { streamMessage } = await import('@/services/llmClient')
    const chunks: string[] = []
    await streamMessage('level_director', 'level structure', [], (c) => chunks.push(c))

    expect(chunks).toEqual(['level', ' design'])
    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toContain('x.ai')
  })

  // ── Custom model routing ───────────────────────────────────────────────────

  it('uses the model selected in settingsStore', async () => {
    vi.stubEnv('VITE_OPENAI_API_KEY', 'test-openai-key')
    // Override chief_director to use OpenAI gpt-4o
    useSettingsStore.setState({
      personaModels: { ...DEFAULT_PERSONA_MODELS, chief_director: 'gpt-4o' },
      settingsPanelOpen: false,
    })
    mockFetch(makeOpenAIStream(['gpt response']))

    const { streamMessage } = await import('@/services/llmClient')
    const chunks: string[] = []
    await streamMessage('chief_director', 'question', [], (c) => chunks.push(c))

    const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toContain('openai.com')
    const body = JSON.parse((options as RequestInit).body as string)
    expect(body.model).toBe('gpt-4o')
  })

  // ── Error handling ─────────────────────────────────────────────────────────

  it('does not throw when API returns non-200; onChunk not called with extra content', async () => {
    vi.stubEnv('VITE_ANTHROPIC_API_KEY', 'test-key')
    // Return 401 error response
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('Unauthorized', { status: 401 })
    )

    const { streamMessage } = await import('@/services/llmClient')
    // streamMessage itself throws; callers catch it
    await expect(
      streamMessage('chief_director', 'question', [], () => {})
    ).rejects.toThrow(/401/)
  })

  // ── History passing ────────────────────────────────────────────────────────

  it('includes history messages in the request body', async () => {
    vi.stubEnv('VITE_ANTHROPIC_API_KEY', 'test-key')
    mockFetch(makeAnthropicStream(['response']))

    const history: ChatMessage[] = [
      {
        id: 'h1',
        persona: 'chief_director',
        role: 'user',
        content: 'previous question',
        timestamp: 1000,
      },
      {
        id: 'h2',
        persona: 'chief_director',
        role: 'assistant',
        content: 'previous response',
        timestamp: 1001,
      },
    ]

    const { streamMessage } = await import('@/services/llmClient')
    await streamMessage('chief_director', 'new question', history, () => {})

    const [, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const body = JSON.parse((options as RequestInit).body as string)

    expect(body.messages).toContainEqual({ role: 'user', content: 'previous question' })
    expect(body.messages).toContainEqual({ role: 'assistant', content: 'previous response' })
    expect(body.messages).toContainEqual({ role: 'user', content: 'new question' })
  })
})

// ── fetchRAGContext ────────────────────────────────────────────────────────────

const RAG_MOCK_DOC = {
  id: 'art_001',
  filename: 'art.md',
  folderPath: '',
  speaker: 'art_director',
  date: '2025-01-01',
  tags: ['art'],
  links: [],
  rawContent: 'Dark fantasy visual style.',
  sections: [
    {
      id: 'art_001_s1',
      heading: 'Art Concept',
      body: 'Dark fantasy visual style.',
      wikiLinks: [],
    },
  ],
  mtime: Date.now(),
}

describe('fetchRAGContext()', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    // Seed vault + graph stores for buildDeepGraphContext to work
    useVaultStore.setState({ loadedDocuments: [RAG_MOCK_DOC] })
    useGraphStore.setState({ links: [] })
  })

  afterEach(() => {
    if ('backendAPI' in window) {
      // @ts-expect-error — test teardown
      delete window.backendAPI
    }
    useVaultStore.setState({ loadedDocuments: null })
  })

  it('returns empty string when backendAPI is unavailable and vault is empty', async () => {
    useVaultStore.setState({ loadedDocuments: null })
    const { fetchRAGContext } = await import('@/services/llmClient')
    const result = await fetchRAGContext('test query')
    expect(result).toBe('')
  })

  it('returns empty string when vault is empty and query matches nothing', async () => {
    useVaultStore.setState({ loadedDocuments: [] })
    const { fetchRAGContext } = await import('@/services/llmClient')
    const result = await fetchRAGContext('unrelated query xyz')
    expect(result).toBe('')
  })

    it('directVaultSearch path: strong filename match (score>=0.4) returns pinned content', async () => {
    // Seed vault with a document whose filename contains query terms
    const feedbackDoc = {
      id: 'feedback_2026',
      filename: '[2026.01.28] 피드백 회의.md',
      folderPath: '',
      speaker: 'chief_director',
      date: '2026-01-28',
      tags: [],
      links: [],
      // Korean content is intentional: tests Korean filename matching and particle stripping
      rawContent: '피드백 내용입니다.',
      sections: [{ id: 'fb_s1', heading: '피드백', body: '피드백 내용입니다.', wikiLinks: [] }],
      mtime: Date.now(),
    }
    useVaultStore.setState({ loadedDocuments: [feedbackDoc] })
    const { fetchRAGContext } = await import('@/services/llmClient')
    const result = await fetchRAGContext('2026 01 28 피드백')
    // Should contain pinned content section header
    expect(result).toContain('Directly Referenced Document')
    expect(result).toContain('피드백 내용입니다.')
  })
})

// ── sseParser unit tests ──────────────────────────────────────────────────────

describe('parseSSEStream', () => {
  it('yields text deltas from a simple SSE stream', async () => {
    const { parseSSEStream } = await import('@/services/sseParser')
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"text":"hello"}\n'))
        controller.enqueue(encoder.encode('data: {"text":" world"}\n'))
        controller.enqueue(encoder.encode('data: [DONE]\n'))
        controller.close()
      },
    })
    const response = new Response(stream)
    const chunks: string[] = []
    for await (const chunk of parseSSEStream(response, (d) => {
      const p = JSON.parse(d) as { text?: string }
      return p.text ?? null
    })) {
      chunks.push(chunk)
    }
    expect(chunks).toEqual(['hello', ' world'])
  })

  it('handles multi-byte UTF-8 (Korean) split across chunks', async () => {
    const { parseSSEStream } = await import('@/services/sseParser')
    const encoder = new TextEncoder()

    // '안녕' encoded as UTF-8 bytes: [ec, 95, 88, eb, 85, 95]
    const koreanBytes = encoder.encode('안녕')
    // Split the data line across two reads
    const fullLine = encoder.encode('data: {"t":"안녕"}\n')
    const mid = Math.floor(fullLine.length / 2)
    const part1 = fullLine.slice(0, mid)
    const part2 = fullLine.slice(mid)
    // Suppress unused variable warning
    void koreanBytes

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(part1)
        controller.enqueue(part2)
        controller.enqueue(encoder.encode('data: [DONE]\n'))
        controller.close()
      },
    })
    const response = new Response(stream)
    const chunks: string[] = []
    for await (const chunk of parseSSEStream(response, (d) => {
      const p = JSON.parse(d) as { t?: string }
      return p.t ?? null
    })) {
      chunks.push(chunk)
    }
    expect(chunks.join('')).toBe('안녕')
  })

  it('skips lines without "data: " prefix', async () => {
    const { parseSSEStream } = await import('@/services/sseParser')
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(': comment line\n'))
        controller.enqueue(encoder.encode('event: message\n'))
        controller.enqueue(encoder.encode('data: {"v":"ok"}\n'))
        controller.enqueue(encoder.encode('data: [DONE]\n'))
        controller.close()
      },
    })
    const response = new Response(stream)
    const chunks: string[] = []
    for await (const chunk of parseSSEStream(response, (d) => {
      const p = JSON.parse(d) as { v?: string }
      return p.v ?? null
    })) {
      chunks.push(chunk)
    }
    expect(chunks).toEqual(['ok'])
  })

  it('throws when response body is null', async () => {
    const { parseSSEStream } = await import('@/services/sseParser')
    const response = new Response(null)
    const gen = parseSSEStream(response, () => null)
    await expect(gen.next()).rejects.toThrow('Response body is null')
  })
})
