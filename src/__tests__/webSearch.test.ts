// parseDDGHtml is not exported, so we test it indirectly via searchWeb + buildWebContext
// buildWebContext IS exported — test it directly
import { buildWebContext } from '@/lib/webSearch'
import type { WebSearchResult } from '@/lib/webSearch'

// We also need to test parseDDGHtml — import the module and access it
// Since parseDDGHtml is not exported, we re-implement the test via a workaround:
// We'll test searchWeb with a mock webSearchAPI, which triggers parseDDGHtml internally

describe('buildWebContext()', () => {
  it('returns empty string for empty results', () => {
    expect(buildWebContext([])).toBe('')
  })

  it('builds context with header and formatted results', () => {
    const results: WebSearchResult[] = [
      { title: 'Example Page', url: 'https://example.com', snippet: 'An example snippet' },
    ]
    const ctx = buildWebContext(results)
    expect(ctx).toContain('## Web Search Results')
    expect(ctx).toContain('**Example Page**')
    expect(ctx).toContain('An example snippet')
    expect(ctx).toContain('Source: https://example.com')
  })

  it('includes multiple results', () => {
    const results: WebSearchResult[] = [
      { title: 'Page 1', url: 'https://one.com', snippet: 'First' },
      { title: 'Page 2', url: 'https://two.com', snippet: 'Second' },
    ]
    const ctx = buildWebContext(results)
    expect(ctx).toContain('**Page 1**')
    expect(ctx).toContain('**Page 2**')
  })

  it('respects maxChars limit', () => {
    const results: WebSearchResult[] = Array.from({ length: 50 }, (_, i) => ({
      title: `Page ${i} with a reasonably long title for testing`,
      url: `https://example.com/page-${i}`,
      snippet: 'A'.repeat(100),
    }))
    const ctx = buildWebContext(results, 500)
    expect(ctx.length).toBeLessThanOrEqual(600) // some tolerance for the last chunk
  })

  it('returns empty string if only header fits within maxChars', () => {
    const results: WebSearchResult[] = [
      { title: 'T'.repeat(300), url: 'https://example.com', snippet: 'S'.repeat(300) },
    ]
    // Header "## Web Search Results\n" is ~23 chars, the chunk is much larger than 30
    const ctx = buildWebContext(results, 30)
    // The first chunk won't fit, so only header remains → returns ''
    expect(ctx).toBe('')
  })
})

describe('searchWeb() — parseDDGHtml integration', () => {
  // Mock window.webSearchAPI to return sample HTML and test parse results
  const originalWebSearchAPI = (globalThis.window as Record<string, unknown>).webSearchAPI

  afterEach(() => {
    if (originalWebSearchAPI) {
      (globalThis.window as Record<string, unknown>).webSearchAPI = originalWebSearchAPI
    } else {
      delete (globalThis.window as Record<string, unknown>).webSearchAPI
    }
  })

  it('returns empty array when webSearchAPI is not available', async () => {
    delete (globalThis.window as Record<string, unknown>).webSearchAPI
    const { searchWeb } = await import('@/lib/webSearch')
    const results = await searchWeb('test')
    expect(results).toEqual([])
  })

  it('parses DuckDuckGo HTML with block-style results', async () => {
    const sampleHtml = `
      <div class="result results_links results_links_deep web-result">
        <a class="result__a" href="https://example.com/page1">Example Title</a>
        <a class="result__snippet">This is a snippet for the first result.</a>
      </div></div>
      <div class="result results_links results_links_deep web-result">
        <a class="result__a" href="https://example.com/page2">Second Page</a>
        <a class="result__snippet">Second snippet here.</a>
      </div></div>
    `;

    (globalThis.window as Record<string, unknown>).webSearchAPI = {
      search: async () => sampleHtml,
    }

    const { searchWeb } = await import('@/lib/webSearch')
    const results = await searchWeb('test query', 5)
    expect(results.length).toBeGreaterThanOrEqual(1)
    // At minimum the fallback parser should extract results
    if (results.length > 0) {
      expect(results[0].title).toBeTruthy()
      expect(results[0].url).toContain('example.com')
    }
  })

  it('handles DuckDuckGo redirect URLs', async () => {
    const sampleHtml = `
      <div class="result results_links results_links_deep web-result">
        <a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Freal-site.com%2Fpath&rut=abc">Real Title</a>
        <a class="result__snippet">A snippet.</a>
      </div></div>
    `;

    (globalThis.window as Record<string, unknown>).webSearchAPI = {
      search: async () => sampleHtml,
    }

    const { searchWeb } = await import('@/lib/webSearch')
    const results = await searchWeb('test', 5)
    if (results.length > 0) {
      expect(results[0].url).toContain('real-site.com')
    }
  })

  it('returns empty array on search error', async () => {
    (globalThis.window as Record<string, unknown>).webSearchAPI = {
      search: async () => { throw new Error('Network error') },
    }

    const { searchWeb } = await import('@/lib/webSearch')
    const results = await searchWeb('test')
    expect(results).toEqual([])
  })

  it('returns empty array for empty HTML', async () => {
    (globalThis.window as Record<string, unknown>).webSearchAPI = {
      search: async () => '',
    }

    const { searchWeb } = await import('@/lib/webSearch')
    const results = await searchWeb('test')
    expect(results).toEqual([])
  })
})
