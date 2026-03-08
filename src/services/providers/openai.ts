import { parseSSEStream } from '@/services/sseParser'
import type { Attachment } from '@/types'

const API_URL = 'https://api.openai.com/v1/chat/completions'

// ── Content types ──────────────────────────────────────────────────────────────

type OpenAITextPart    = { type: 'text'; text: string }
type OpenAIImagePart   = { type: 'image_url'; image_url: { url: string } }
type OpenAIContentPart = OpenAITextPart | OpenAIImagePart
type OpenAIContent     = string | OpenAIContentPart[]

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant'
  content: OpenAIContent
}

/** Build vision content parts for a user message with image attachments */
function buildVisionContent(text: string, images: Attachment[]): OpenAIContentPart[] {
  const parts: OpenAIContentPart[] = []
  for (const img of images) {
    // dataUrl is already a valid data URL: "data:image/png;base64,..."
    parts.push({ type: 'image_url', image_url: { url: img.dataUrl } })
  }
  if (text) parts.push({ type: 'text', text })
  return parts
}

/**
 * Stream a completion from OpenAI.
 * Supports vision (image attachments) via the gpt-4o / gpt-4-vision endpoint.
 * Injects the system prompt as the first message.
 */
export async function streamCompletion(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: { role: 'user' | 'assistant'; content: string }[],
  onChunk: (chunk: string) => void,
  imageAttachments: Attachment[] = []
): Promise<void> {
  const fullMessages: OpenAIMessage[] = [
    { role: 'system', content: systemPrompt },
    ...messages.map((m, idx) => {
      const isLastUser = m.role === 'user' && idx === messages.length - 1
      if (isLastUser && imageAttachments.length > 0) {
        return { role: 'user' as const, content: buildVisionContent(m.content, imageAttachments) }
      }
      return { role: m.role as 'user' | 'assistant', content: m.content }
    }),
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
    throw new Error(`OpenAI API error ${response.status}: ${errorText}`)
  }

  /**
   * OpenAI streaming delta format:
   * { choices: [{ delta: { content: '...' } }] }
   */
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
