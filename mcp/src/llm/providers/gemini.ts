/**
 * Google Gemini — Node.js streaming provider.
 */
export async function streamCompletion(
  apiKey: string, model: string, systemPrompt: string,
  messages: { role: string; content: string }[],
  onChunk: (text: string) => void,
  onUsage?: (inp: number, out: number) => void,
): Promise<void> {
  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents,
      generationConfig: { maxOutputTokens: 8192 },
    }),
  })

  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`)
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
      try {
        const evt = JSON.parse(line.slice(6).trim())
        const text = evt.candidates?.[0]?.content?.parts?.[0]?.text
        if (text) onChunk(text)
        if (evt.usageMetadata) {
          inputTokens = evt.usageMetadata.promptTokenCount ?? 0
          outputTokens = evt.usageMetadata.candidatesTokenCount ?? 0
        }
      } catch {}
    }
  }
  if (onUsage && (inputTokens > 0 || outputTokens > 0)) onUsage(inputTokens, outputTokens)
}
