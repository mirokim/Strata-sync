/**
 * webSearch.ts — DuckDuckGo HTML search (via Electron IPC)
 *
 * No API key required. Search runs in the main process via Node.js https module.
 * In non-Electron environments (browser builds), automatically returns [].
 */

export interface WebSearchResult {
  title: string
  url: string
  snippet: string
}

const decodeHtml = (s: string) =>
  s.replace(/<[^>]+>/g, '')
   .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
   .replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
   .trim()

/**
 * Parse DuckDuckGo HTML response into a search result array.
 * Parses by result block to prevent title/snippet index mismatch.
 */
function parseDDGHtml(html: string, maxResults: number): WebSearchResult[] {
  if (!html) return []
  const results: WebSearchResult[] = []

  // Extract each result block, then find title + snippet within each block
  const blockRe = /<div[^>]+class="[^"]*result[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g
  const titleUrlRe = /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/
  const snippetRe  = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/

  let block: RegExpExecArray | null
  while ((block = blockRe.exec(html)) !== null && results.length < maxResults) {
    const content = block[1]
    const tm = content.match(titleUrlRe)
    if (!tm) continue
    let url = tm[1]
    const title = decodeHtml(tm[2])
    if (!title) continue

    const sm = content.match(snippetRe)
    const snippet = sm ? decodeHtml(sm[1]) : ''

    // Clean up DuckDuckGo redirect URLs
    if (url.includes('duckduckgo.com/l/?')) {
      const uddg = url.match(/uddg=([^&]+)/)
      if (uddg) url = decodeURIComponent(uddg[1])
    }

    results.push({ title, url, snippet })
  }

  // Fallback: if block parsing fails (HTML structure change), use two-array approach
  if (results.length === 0) {
    const titleUrlRe2 = /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g
    const snippetRe2  = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g
    const titleUrls: { url: string; rawTitle: string }[] = []
    const snippets: string[] = []
    let m: RegExpExecArray | null
    while ((m = titleUrlRe2.exec(html)) !== null && titleUrls.length < maxResults) titleUrls.push({ url: m[1], rawTitle: m[2] })
    while ((m = snippetRe2.exec(html)) !== null && snippets.length < maxResults) snippets.push(m[1])
    for (let i = 0; i < titleUrls.length && i < maxResults; i++) {
      let { url, rawTitle } = titleUrls[i]
      const title = decodeHtml(rawTitle)
      const snippet = decodeHtml(snippets[i] ?? '')
      if (url.includes('duckduckgo.com/l/?')) { const uddg = url.match(/uddg=([^&]+)/); if (uddg) url = decodeURIComponent(uddg[1]) }
      if (title) results.push({ title, url, snippet })
    }
  }

  return results
}

/** Convert search results to a RAG context string */
export function buildWebContext(results: WebSearchResult[], maxChars = 2000): string {
  if (!results.length) return ''
  const parts = ['## Web Search Results\n']
  let total = parts[0].length
  for (const r of results) {
    const chunk = `- **${r.title}**\n  ${r.snippet}\n  Source: ${r.url}\n\n`
    if (total + chunk.length > maxChars) break
    parts.push(chunk)
    total += chunk.length
  }
  return parts.length <= 1 ? '' : parts.join('')
}

/**
 * Search the web via DuckDuckGo.
 * Electron-only (via window.webSearchAPI IPC).
 * Returns [] on failure.
 */
export async function searchWeb(query: string, maxResults = 5): Promise<WebSearchResult[]> {
  try {
    const api = window.webSearchAPI
    if (!api) return []
    const html: string = await api.search(query)
    return parseDDGHtml(html, maxResults)
  } catch {
    return []
  }
}
