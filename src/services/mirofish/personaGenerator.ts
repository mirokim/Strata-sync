/**
 * personaGenerator.ts — Auto-generate simulation personas via LLM
 *
 * Takes a topic and returns a diverse array of personas as JSON.
 */

import { getProviderForModel, MODEL_OPTIONS } from '@/lib/modelConfig'
import { getApiKey } from '@/stores/settingsStore'
import type { MirofishPersona } from './types'

const SYSTEM_PROMPT = `
You are a user research expert at a game development company.
Generate user personas from real gamer perspectives for the given game content/feature topic.
Output ONLY a JSON array in the format below. Do not include any other text.
`.trim()

function buildUserPrompt(topic: string, count: number, context?: string, segment?: string): string {
  const contextBlock = context
    ? `\n\n[Reference Document — reflect this content when designing personas]\n${context.slice(0, 2000)}`
    : ''
  const segmentBlock = segment
    ? `\n\nTarget segment: "${segment}" — compose personas only from this segment's user types.`
    : ''
  return `
Generate ${count} user personas as a JSON array that would react to the following game-related topic.

Topic: "${topic}"${contextBlock}${segmentBlock}

Personas must be real game users. Example roles:
Core gamer, hardcore raider, long-term MMO player, competitive PvP player, mobile casual player,
story-focused player, social guild player, F2P player, whale spender, returning player,
streamer/content creator, game community moderator, parent (of child gamer), game journalist

JSON format:
[
  {
    "id": "unique_ID (snake_case English)",
    "name": "persona name (nickname style)",
    "role": "user type (English, see examples above)",
    "stance": "supportive | opposing | neutral | observer (pick one)",
    "activityLevel": 1.0,
    "influenceWeight": 0.1~1.0 (community influence — higher for streamers/mods, lower for regular users),
    "systemPrompt": "This user's play style, key interests, and tone in 3-4 sentences. Include specific play habits and pain points."
  }
]

Requirements:
- Stance distribution: supportive 30-40%, opposing 30-40%, neutral/observer the rest
- Prioritize user types directly related to the topic
- systemPrompt should be specific like real community reactions
`.trim()
}

/** Max personas to generate per LLM call (prevents token truncation) */
const BATCH_SIZE = 10

async function generateBatch(
  topic: string,
  batchCount: number,
  modelId: string,
  provider: string,
  apiKey: string,
  existingCount: number,
  context?: string,
  segment?: string,
): Promise<MirofishPersona[]> {
  let fullText = ''
  const messages = [{ role: 'user' as const, content: buildUserPrompt(topic, batchCount, context, segment) }]

  switch (provider) {
    case 'anthropic': {
      const { streamCompletion } = await import('../providers/anthropic')
      await streamCompletion(apiKey, modelId, SYSTEM_PROMPT, messages, c => { fullText += c })
      break
    }
    case 'openai': {
      const { streamCompletion } = await import('../providers/openai')
      await streamCompletion(apiKey, modelId, SYSTEM_PROMPT, messages, c => { fullText += c })
      break
    }
    case 'gemini': {
      const { streamCompletion } = await import('../providers/gemini')
      await streamCompletion(apiKey, modelId, SYSTEM_PROMPT, messages, c => { fullText += c })
      break
    }
    default:
      return []
  }

  const match = fullText.match(/\[[\s\S]*\]/)
  if (!match) throw new Error('No JSON array found')
  const parsed = JSON.parse(match[0]) as MirofishPersona[]
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('Empty array')

  // Prevent duplicate IDs within batch
  return parsed.map((p, i) => ({ ...p, id: p.id || `persona_${existingCount + i + 1}` }))
}

export async function generatePersonas(
  topic: string,
  count: number,
  modelId: string,
  context?: string,
  segment?: string,
): Promise<MirofishPersona[]> {
  const provider = getProviderForModel(modelId)
  if (!provider) throw new Error(`Cannot find provider for model "${modelId}"`)

  const apiKey = getApiKey(provider)
  if (!apiKey) throw new Error(`${provider} API key is not configured`)

  const model = MODEL_OPTIONS.find(m => m.id === modelId)
  if (!model) throw new Error(`Cannot find model "${modelId}"`)

  const results: MirofishPersona[] = []
  const seenIds = new Set<string>()
  const MAX_ITERATIONS = 5  // prevent infinite loop

  // If count > BATCH_SIZE, generate in batches of BATCH_SIZE
  let iterations = 0
  while (results.length < count && iterations < MAX_ITERATIONS) {
    iterations++
    const batchCount = Math.min(BATCH_SIZE, count - results.length)
    const batch = await generateBatch(topic, batchCount, modelId, model.provider, apiKey, results.length, context, segment)

    // Deduplicate IDs across batches
    for (const p of batch) {
      if (seenIds.has(p.id)) {
        p.id = `${p.id}_${results.length}`
      }
      seenIds.add(p.id)
      results.push(p)
      if (results.length >= count) break
    }

    if (batch.length < batchCount) break
  }

  if (results.length === 0) throw new Error('Persona generation failed: LLM returned empty array')
  return results.slice(0, count)
}
