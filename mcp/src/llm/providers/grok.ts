/**
 * xAI Grok — Node.js streaming provider (OpenAI-compatible API).
 */
export async function streamCompletion(
  apiKey: string, model: string, systemPrompt: string,
  messages: { role: string; content: string }[],
  onChunk: (text: string) => void,
  onUsage?: (inp: number, out: number) => void,
): Promise<void> {
  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model, stream: true,
      ...(onUsage ? { stream_options: { include_usage: true } } : {}),
      messages: [{ role: 'system', content: systemPrompt }, ...messages.map(m => ({ role: m.role, content: m.content }))],
    }),
  })

  if (!res.ok) throw new Error(`Grok ${res.status}: ${await res.text()}`)
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
        const delta = evt.choices?.[0]?.delta?.content
        if (delta) onChunk(delta)
        if (evt.usage) { inputTokens = evt.usage.prompt_tokens ?? 0; outputTokens = evt.usage.completion_tokens ?? 0 }
      } catch {}
    }
  }
  if (onUsage && (inputTokens > 0 || outputTokens > 0)) onUsage(inputTokens, outputTokens)
}
