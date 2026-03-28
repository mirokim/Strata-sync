/**
 * LLM Client for MCP server — resolves provider from model ID and streams.
 */
import { getApiKey, getConfig } from '../config.js'

type StreamFn = (
  apiKey: string, model: string, system: string,
  messages: { role: string; content: string }[],
  onChunk: (text: string) => void,
  onUsage?: (inp: number, out: number) => void,
) => Promise<void>

const PROVIDER_MAP: Record<string, string> = {
  'claude': 'anthropic', 'gpt': 'openai', 'o3': 'openai', 'o4': 'openai',
  'gemini': 'gemini', 'grok': 'grok',
}

export function resolveProvider(modelId: string): string {
  for (const [prefix, provider] of Object.entries(PROVIDER_MAP)) {
    if (modelId.startsWith(prefix)) return provider
  }
  return 'anthropic' // default
}

async function getStreamFn(provider: string): Promise<StreamFn> {
  switch (provider) {
    case 'anthropic': return (await import('./providers/anthropic.js')).streamCompletion
    case 'openai': return (await import('./providers/openai.js')).streamCompletion
    case 'gemini': return (await import('./providers/gemini.js')).streamCompletion
    case 'grok': return (await import('./providers/grok.js')).streamCompletion
    default: throw new Error(`Unknown provider: ${provider}`)
  }
}

/** Usage tracking */
export interface UsageRecord {
  timestamp: string
  modelId: string
  inputTokens: number
  outputTokens: number
  costUsd: number
  caller: string
}

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-6': { input: 15.0, output: 75.0 },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5-20251001': { input: 0.8, output: 4.0 },
  'gpt-4.1': { input: 2.0, output: 8.0 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4o': { input: 2.5, output: 10.0 },
  'o3': { input: 10.0, output: 40.0 },
  'o4-mini': { input: 1.1, output: 4.4 },
  'gemini-2.5-pro': { input: 1.25, output: 10.0 },
  'gemini-2.5-flash': { input: 0.15, output: 0.6 },
  'grok-3': { input: 3.0, output: 15.0 },
  'grok-3-mini': { input: 0.3, output: 0.5 },
}

const _usageLog: UsageRecord[] = []
let _totalCost = 0
let _totalInput = 0
let _totalOutput = 0

function recordUsage(modelId: string, input: number, output: number, caller: string) {
  const p = MODEL_PRICING[modelId]
  const cost = p ? (input / 1e6) * p.input + (output / 1e6) * p.output : 0
  _usageLog.push({ timestamp: new Date().toISOString(), modelId, inputTokens: input, outputTokens: output, costUsd: cost, caller })
  _totalCost += cost
  _totalInput += input
  _totalOutput += output
}

export function getUsageSummary() {
  return { totalInputTokens: _totalInput, totalOutputTokens: _totalOutput, totalCostUsd: _totalCost, callCount: _usageLog.length }
}
export function getUsageLog(limit = 100) { return _usageLog.slice(-limit) }

/**
 * Stream a message to any model. Returns the complete response text.
 */
export async function chat(
  modelId: string, systemPrompt: string,
  messages: { role: string; content: string }[],
  caller = 'chat',
): Promise<string> {
  const provider = resolveProvider(modelId)
  const apiKey = getApiKey(provider)
  if (!apiKey) throw new Error(`No API key for ${provider}. Set it in mcp-config.json`)

  const streamFn = await getStreamFn(provider)
  let result = ''
  await streamFn(apiKey, modelId, systemPrompt, messages, (chunk) => { result += chunk },
    (inp, out) => recordUsage(modelId, inp, out, caller))
  return result
}

/**
 * Chat with a persona — uses persona prompts and project context.
 */
export async function chatWithPersona(
  persona: string, userMessage: string,
  history: { role: string; content: string }[] = [],
  ragContext?: string,
): Promise<string> {
  const config = getConfig()
  const modelId = config.personaModels[persona] ?? config.personaModels['chief_director'] ?? 'claude-sonnet-4-6'

  // Build system prompt
  const { getPersonaPrompt } = await import('../persona.js')
  let system = getPersonaPrompt(persona)
  if (config.responseInstructions) system += `\n\n${config.responseInstructions}`
  if (ragContext) system += `\n\n=== Related Document Context ===\n${ragContext}\n=== End of Context ===`

  const messages = [...history, { role: 'user', content: userMessage }]
  return chat(modelId, system, messages, 'chat')
}
