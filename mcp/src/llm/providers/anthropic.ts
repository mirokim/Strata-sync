/**
 * Anthropic Claude — Node.js streaming provider.
 */
export async function streamCompletion(
  apiKey: string, model: string, systemPrompt: string,
  messages: { role: string; content: string }[],
  onChunk: (text: string) => void,
  onUsage?: (inp: number, out: number) => void,
): Promise<void> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model, max_tokens: 8192, system: systemPrompt,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      stream: true,
    }),
  })

  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`)
  if (!res.body) throw new Error('No response body')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let inputTokens = 0, outputTokens = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (data === '[DONE]') continue
      try {
        const evt = JSON.parse(data)
        if (evt.type === 'content_block_delta' && evt.delta?.text) onChunk(evt.delta.text)
        if (evt.type === 'message_start' && evt.message?.usage) inputTokens = evt.message.usage.input_tokens ?? 0
        if (evt.type === 'message_delta' && evt.usage) outputTokens = evt.usage.output_tokens ?? 0
      } catch {}
    }
  }
  if (onUsage && (inputTokens > 0 || outputTokens > 0)) onUsage(inputTokens, outputTokens)
}
