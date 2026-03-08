/**
 * Google Gemini provider.
 *
 * Key differences from OpenAI/Anthropic:
 * - REST endpoint differs per model
 * - API key sent via x-goog-api-key header (not URL parameter)
 * - Role names: 'user' stays 'user', 'assistant' becomes 'model'
 * - System prompt is a separate `systemInstruction` field
 * - Streaming uses `alt=sse` query parameter
 * - Response delta: candidates[0].content.parts[0].text
 * - Vision: inlineData parts for image attachments
 */

import { parseSSEStream } from '@/services/sseParser'
import type { Attachment } from '@/types'

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models'

// ── Content types ──────────────────────────────────────────────────────────────

interface GeminiTextPart {
  text: string
}

interface GeminiInlineDataPart {
  inlineData: { mimeType: string; data: string }
}

type GeminiPart = GeminiTextPart | GeminiInlineDataPart

interface GeminiMessage {
  role: 'user' | 'model'
  parts: GeminiPart[]
}

function mapRole(role: 'user' | 'assistant'): 'user' | 'model' {
  return role === 'assistant' ? 'model' : 'user'
}

/** Extract mime type and base64 data from a data URL */
function parseDataUrl(dataUrl: string): { mimeType: string; data: string } {
  const [header, data] = dataUrl.split(',')
  const mimeType = header.replace('data:', '').replace(';base64', '')
  return { mimeType, data }
}

/** Build Gemini parts array for a message with image attachments */
function buildVisionParts(text: string, images: Attachment[]): GeminiPart[] {
  const parts: GeminiPart[] = []
  for (const img of images) {
    const { mimeType, data } = parseDataUrl(img.dataUrl)
    parts.push({ inlineData: { mimeType, data } })
  }
  if (text) parts.push({ text })
  return parts
}

export async function streamCompletion(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: { role: 'user' | 'assistant'; content: string }[],
  onChunk: (chunk: string) => void,
  imageAttachments: Attachment[] = []
): Promise<void> {
  const url = `${BASE_URL}/${model}:streamGenerateContent?alt=sse`

  const geminiMessages: GeminiMessage[] = messages.map((m, idx) => {
    const isLastUser = m.role === 'user' && idx === messages.length - 1
    if (isLastUser && imageAttachments.length > 0) {
      return { role: 'user', parts: buildVisionParts(m.content, imageAttachments) }
    }
    return { role: mapRole(m.role), parts: [{ text: m.content }] }
  })

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: geminiMessages,
      generationConfig: {
        maxOutputTokens: 8192,
      },
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Gemini API error ${response.status}: ${errorText}`)
  }

  /**
   * Gemini streaming SSE format:
   * data: { "candidates": [{ "content": { "parts": [{ "text": "..." }], "role": "model" } }] }
   */
  function extractChunk(data: string): string | null {
    const parsed = JSON.parse(data) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> }
      }>
    }
    return parsed.candidates?.[0]?.content?.parts?.[0]?.text ?? null
  }

  for await (const chunk of parseSSEStream(response, extractChunk)) {
    onChunk(chunk)
  }
}
