/**
 * xAI Grok provider.
 *
 * Grok uses the OpenAI-compatible chat completions API,
 * with a different base URL: https://api.x.ai/v1
 */

import { parseSSEStream } from '@/services/sseParser'

const API_URL = 'https://api.x.ai/v1/chat/completions'

interface GrokMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export async function streamCompletion(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: { role: 'user' | 'assistant'; content: string }[],
  onChunk: (chunk: string) => void
): Promise<void> {
  const fullMessages: GrokMessage[] = [
    { role: 'system', content: systemPrompt },
    ...messages,
  ]

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: fullMessages,
      stream: true,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Grok API error ${response.status}: ${errorText}`)
  }

  // Same delta format as OpenAI
  function extractChunk(data: string): string | null {
    const parsed = JSON.parse(data) as {
      choices?: Array<{ delta?: { content?: string } }>
    }
    return parsed.choices?.[0]?.delta?.content ?? null
  }

  for await (const chunk of parseSSEStream(response, extractChunk)) {
    onChunk(chunk)
  }
}
