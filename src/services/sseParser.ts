/**
 * Shared SSE (Server-Sent Events) streaming parser.
 *
 * Uses TextDecoder in streaming mode to correctly handle multi-byte UTF-8
 * characters (e.g. Korean text) split across chunk boundaries.
 *
 * @param response  - The fetch Response with a streaming body
 * @param extractChunk - Provider-specific function that parses a `data:` line
 *                       and returns the text delta, or null to skip the line.
 * @yields Text deltas as they arrive
 */
export async function* parseSSEStream(
  response: Response,
  extractChunk: (data: string) => string | null
): AsyncGenerator<string> {
  if (!response.body) {
    throw new Error('Response body is null — cannot stream')
  }

  const reader = response.body.getReader()
  // { stream: true } in decode() allows correct handling of multi-byte sequences split across reads
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // Split on newlines — SSE events are newline-delimited
      const lines = buffer.split('\n')
      // Keep the last (potentially incomplete) line in the buffer
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trimEnd()
        if (!trimmed.startsWith('data: ')) continue

        const data = trimmed.slice(6) // remove "data: " prefix
        if (data === '[DONE]') return

        try {
          const chunk = extractChunk(data)
          if (chunk) yield chunk
        } catch {
          // Ignore malformed JSON lines (common during stream start/end)
        }
      }
    }

    // Flush the decoder for any remaining bytes
    const remaining = decoder.decode(undefined, { stream: false })
    if (remaining) buffer += remaining

    // Process any final buffered line
    if (buffer.startsWith('data: ')) {
      const data = buffer.slice(6)
      if (data !== '[DONE]') {
        try {
          const chunk = extractChunk(data)
          if (chunk) yield chunk
        } catch {
          // Ignore
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}
