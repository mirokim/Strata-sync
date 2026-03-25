/**
 * reportClient — Conversation report generation service using AI.
 * Analyzes conversations using the model set in settingsStore.reportModelId
 * and streams a markdown report.
 */
import type { ChatMessage } from '@/types'
import { MODEL_OPTIONS, getProviderForModel } from '@/lib/modelConfig'
import { SPEAKER_CONFIG } from '@/lib/speakerConfig'
import { useSettingsStore, getApiKey } from '@/stores/settingsStore'
import { sanitizeUnicode as sanitize } from '@/lib/utils'

// ── Conversation → readable text ──────────────────────────────────────────────

function buildConversationText(messages: ChatMessage[]): string {
  return messages
    .filter(m => !m.streaming && m.content.trim())
    .map(m => {
      const label = m.role === 'user'
        ? 'User'
        : (SPEAKER_CONFIG[m.persona]?.label ?? m.persona)
      const ts = new Date(m.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
      return `[${label}] ${ts}\n${m.content.trim()}`
    })
    .join('\n\n')
}

// ── System & user prompts ─────────────────────────────────────────────────────

const SYSTEM_PROMPT =
  'You are an expert meeting minutes and report writer. ' +
  'Analyze the provided conversation and produce a clear, structured markdown report. ' +
  'Extract the key content and organize it in a practical format.'

function buildUserPrompt(conversationText: string): string {
  return (
    'Please analyze the conversation below and write an English markdown report.\n\n' +
    'Report structure:\n' +
    '1. **Key Topics** — list of main topics discussed\n' +
    '2. **Discussion Points** — summary of key content per topic\n' +
    '3. **Decisions & Proposals** — decisions made or ideas proposed\n' +
    '4. **Next Steps** — follow-up actions or action items (omit if none)\n\n' +
    '---\n\n' +
    'Conversation transcript:\n\n' +
    conversationText
  )
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Streams an AI-generated conversation report.
 * Requires settingsStore.reportModelId to be set.
 *
 * @throws Error if reportModelId is not set, provider is unrecognized, or API key is missing
 */
export async function streamAIReport(
  messages: ChatMessage[],
  onChunk: (chunk: string) => void,
): Promise<void> {
  const { reportModelId } = useSettingsStore.getState()
  if (!reportModelId) throw new Error('Report AI model is not configured.')

  const provider = getProviderForModel(reportModelId)
  if (!provider) throw new Error(`Unknown model: ${reportModelId}`)

  const apiKey = getApiKey(provider)
  if (!apiKey) throw new Error(`${provider} API key is not set.`)

  const model = MODEL_OPTIONS.find(m => m.id === reportModelId)!
  const conversationText = buildConversationText(messages)
  const userPrompt = sanitize(buildUserPrompt(conversationText))
  const systemPrompt = sanitize(SYSTEM_PROMPT)
  const apiMessages = [{ role: 'user' as const, content: userPrompt }]

  switch (model.provider) {
    case 'anthropic': {
      const { streamCompletion } = await import('./providers/anthropic')
      await streamCompletion(apiKey, reportModelId, systemPrompt, apiMessages, onChunk)
      break
    }
    case 'openai': {
      const { streamCompletion } = await import('./providers/openai')
      await streamCompletion(apiKey, reportModelId, systemPrompt, apiMessages, onChunk)
      break
    }
    case 'gemini': {
      const { streamCompletion } = await import('./providers/gemini')
      await streamCompletion(apiKey, reportModelId, systemPrompt, apiMessages, onChunk)
      break
    }
    case 'grok': {
      const { streamCompletion } = await import('./providers/grok')
      await streamCompletion(apiKey, reportModelId, systemPrompt, apiMessages, onChunk)
      break
    }
    default:
      throw new Error(`Unsupported provider: ${model.provider}`)
  }
}
