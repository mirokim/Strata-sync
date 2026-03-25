import { parseSSEStream } from '@/services/sseParser'
import type { Attachment } from '@/types'

const API_URL = 'https://api.anthropic.com/v1/messages'
const API_VERSION = '2023-06-01'

function getMaxTokens(model: string): number {
  if (model.includes('opus')) return 8192
  if (model.includes('sonnet')) return 8192
  return 4096 // haiku and others
}

// ── Content types ──────────────────────────────────────────────────────────────

type AnthropicTextPart = { type: 'text'; text: string }
type AnthropicImagePart = {
  type: 'image'
  source: { type: 'base64'; media_type: string; data: string }
}
type AnthropicContentPart = AnthropicTextPart | AnthropicImagePart
type AnthropicContent = string | AnthropicContentPart[]

interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: AnthropicContent
}

/** Extract base64 data from a data URL like "data:image/png;base64,XXXX" */
function dataUrlToBase64(dataUrl: string): { mimeType: string; data: string } {
  const [header, data] = dataUrl.split(',')
  const mimeType = header.replace('data:', '').replace(';base64', '')
  return { mimeType, data }
}

/** Build the content for the last user message when image attachments are present */
function buildVisionContent(
  text: string,
  images: Attachment[]
): AnthropicContentPart[] {
  const parts: AnthropicContentPart[] = []
  // Images first (Anthropic recommends this order)
  for (const img of images) {
    const { mimeType, data } = dataUrlToBase64(img.dataUrl)
    parts.push({
      type: 'image',
      source: { type: 'base64', media_type: mimeType, data },
    })
  }
  if (text) parts.push({ type: 'text', text })
  return parts
}

/**
 * Stream a completion from Anthropic Claude.
 * Supports vision (image attachments) for multimodal prompts.
 */
export async function streamCompletion(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: { role: 'user' | 'assistant'; content: string }[],
  onChunk: (chunk: string) => void,
  imageAttachments: Attachment[] = [],
  onUsage?: (inputTokens: number, outputTokens: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  // Build Anthropic messages array; upgrade the last user message if images present
  const anthropicMessages: AnthropicMessage[] = messages.map((m, idx) => {
    const isLastUser = m.role === 'user' && idx === messages.length - 1
    if (isLastUser && imageAttachments.length > 0) {
      return { role: 'user', content: buildVisionContent(m.content, imageAttachments) }
    }
    return { role: m.role, content: m.content }
  })

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': API_VERSION,
    },
    body: JSON.stringify({
      model,
      max_tokens: getMaxTokens(model),
      system: systemPrompt,
      messages: anthropicMessages,
      stream: true,
    }),
    signal,
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Anthropic API error ${response.status}: ${errorText}`)
  }

  /**
   * Anthropic streaming event types:
   * - content_block_delta: { type, index, delta: { type: 'text_delta', text: '...' } }
   * - message_delta: { type, delta: { stop_reason }, usage: { output_tokens } }
   * - message_start: { type, message: { usage: { input_tokens, output_tokens } } }
   * - message_stop: stream end
   */
  let inputTokens = 0
  let outputTokens = 0

  function extractChunk(data: string): string | null {
    const parsed = JSON.parse(data) as {
      type: string
      delta?: { type: string; text?: string }
      usage?: { output_tokens?: number }
      message?: { usage?: { input_tokens?: number; output_tokens?: number } }
    }
    if (parsed.type === 'message_start' && parsed.message?.usage) {
      inputTokens = parsed.message.usage.input_tokens ?? 0
      outputTokens = parsed.message.usage.output_tokens ?? 0
    } else if (parsed.type === 'message_delta' && parsed.usage) {
      outputTokens = parsed.usage.output_tokens ?? outputTokens
    } else if (
      parsed.type === 'content_block_delta' &&
      parsed.delta?.type === 'text_delta' &&
      parsed.delta.text
    ) {
      return parsed.delta.text
    }
    return null
  }

  for await (const chunk of parseSSEStream(response, extractChunk)) {
    onChunk(chunk)
  }

  if (onUsage && (inputTokens > 0 || outputTokens > 0)) {
    onUsage(inputTokens, outputTokens)
  }
}
