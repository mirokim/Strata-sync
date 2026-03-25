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
  onChunk: (chunk: string) => void,
  _imageAttachments: unknown[] = [],   // unused — Grok does not support vision
  onUsage?: (inputTokens: number, outputTokens: number) => void,
  signal?: AbortSignal,
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
      ...(onUsage ? { stream_options: { include_usage: true } } : {}),
    }),
    signal,
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Grok API error ${response.status}: ${errorText}`)
  }

  // Same delta format as OpenAI; usage in final chunk when stream_options.include_usage=true
  let inputTokens = 0
  let outputTokens = 0

  function extractChunk(data: string): string | null {
    const parsed = JSON.parse(data) as {
      choices?: Array<{ delta?: { content?: string } }>
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }
    if (parsed.usage) {
      inputTokens = parsed.usage.prompt_tokens ?? 0
      outputTokens = parsed.usage.completion_tokens ?? 0
    }
    return parsed.choices?.[0]?.delta?.content ?? null
  }

  for await (const chunk of parseSSEStream(response, extractChunk)) {
    onChunk(chunk)
  }

  if (onUsage && (inputTokens > 0 || outputTokens > 0)) {
    onUsage(inputTokens, outputTokens)
  }
}
