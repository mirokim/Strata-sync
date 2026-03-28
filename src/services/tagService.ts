/**
 * tagService.ts
 *
 * AI tag suggestion: Analyzes document filename + content (first 300 chars) using the configured model
 * and returns suitable tags from the user-defined tagPresets list as a JSON array.
 * Returns an empty array ([]) when uncertain — displayed as "uncategorized" in the sidebar.
 *
 * Supported providers: anthropic, openai, gemini, grok
 */

import matter from 'gray-matter'
import type { LoadedDocument } from '@/types'
import { useSettingsStore, getApiKey } from '@/stores/settingsStore'
import { getWorkerModelId } from '@/services/llmClient'

const SYSTEM_PROMPT = `You are a document classification expert.
From the provided tag list, select only the appropriate tags for the given document and respond with a JSON array only.
Your response must be a valid JSON array. Example: ["combat", "skill"]
If unsure, return an empty array [].
Do not include any explanation or other text.`

/** Calls streamCompletion for the given provider and returns the full response string. */
async function callStream(
  provider: string,
  apiKey: string,
  modelId: string,
  userMessage: string,
  systemPrompt: string = SYSTEM_PROMPT,
): Promise<string> {
  let result = ''
  const onChunk = (c: string) => { result += c }
  const msgs: { role: 'user' | 'assistant'; content: string }[] = [
    { role: 'user', content: userMessage },
  ]

  if (provider === 'anthropic') {
    const { streamCompletion } = await import('./providers/anthropic')
    await streamCompletion(apiKey, modelId, systemPrompt, msgs, onChunk)
  } else if (provider === 'openai') {
    const { streamCompletion } = await import('./providers/openai')
    await streamCompletion(apiKey, modelId, systemPrompt, msgs, onChunk)
  } else if (provider === 'gemini') {
    const { streamCompletion } = await import('./providers/gemini')
    await streamCompletion(apiKey, modelId, systemPrompt, msgs, onChunk)
  } else if (provider === 'grok') {
    const { streamCompletion } = await import('./providers/grok')
    await streamCompletion(apiKey, modelId, systemPrompt, msgs, onChunk)
  }

  return result
}

/**
 * Suggests suitable tags for a given document using AI.
 * Returns [] immediately if tagPresets is empty or no API key is available.
 */
export async function suggestTagsForDoc(
  docFilename: string,
  docContent: string
): Promise<string[]> {
  const state = useSettingsStore.getState()
  const { tagPresets, personaModels } = state

  if (tagPresets.length === 0) return []

  const mainModelId = personaModels['chief_director']
  if (!mainModelId) return []

  const { modelId, provider } = getWorkerModelId(mainModelId)
  const apiKey = getApiKey(provider)
  if (!apiKey) return []

  const contentPreview = docContent.replace(/^---[\s\S]*?---\n*/m, '').slice(0, 300)
  const userMessage = `Filename: ${docFilename}
Content (beginning):
${contentPreview}

Allowed tag list: ${tagPresets.join(', ')}

Select suitable tags for this document only from the above list and return as a JSON array.`

  let result = ''
  try {
    result = await callStream(provider, apiKey, modelId, userMessage)
  } catch {
    return []
  }

  // Parse JSON array + filter only tags that exist in tagPresets
  try {
    const match = result.match(/\[[\s\S]*\]/)
    if (!match) return []
    const parsed = JSON.parse(match[0])
    if (!Array.isArray(parsed)) return []
    return parsed.filter((t): t is string =>
      typeof t === 'string' && tagPresets.includes(t)
    )
  } catch {
    return []
  }
}

const SPEAKER_OPTIONS = [
  { id: 'chief_director',  desc: 'Overall planning/direction documents' },
  { id: 'art_director',    desc: 'Art/design related documents' },
  { id: 'plan_director',   desc: 'Planning/level design documents' },
  { id: 'level_director',  desc: 'Level/map design documents' },
  { id: 'prog_director',   desc: 'Programming/technical documents' },
]

const SPEAKER_SYSTEM = `You are a document owner classification expert.
Select the most appropriate role for the given document from the list below and respond with the ID only.
List:
${SPEAKER_OPTIONS.map(s => `- ${s.id}: ${s.desc}`).join('\n')}
Your response must be exactly one of the above IDs, on a single line. ID only, no explanation.`

/**
 * Suggests the most suitable speaker (persona) ID for a document using AI.
 * Returns null on failure.
 */
export async function suggestSpeakerForDoc(
  docFilename: string,
  docContent: string,
): Promise<string | null> {
  const state = useSettingsStore.getState()
  const { personaModels } = state

  const mainModelId = personaModels['chief_director']
  if (!mainModelId) return null

  const { modelId, provider } = getWorkerModelId(mainModelId)
  const apiKey = getApiKey(provider)
  if (!apiKey) return null

  const contentPreview = docContent.replace(/^---[\s\S]*?---\n*/m, '').slice(0, 400)
  const userMessage = `Filename: ${docFilename}\nContent:\n${contentPreview}\n\nReturn the most appropriate role ID.`

  try {
    const result = await callStream(provider, apiKey, modelId, userMessage, SPEAKER_SYSTEM)
    const speakerId = result.trim().toLowerCase()
    return SPEAKER_OPTIONS.some(s => s.id === speakerId) ? speakerId : null
  } catch {
    return null
  }
}

// Returns the full string with the YAML frontmatter tags field updated.
function applyTagsToContent(rawContent: string, newTags: string[]): string {
  const trimmed = rawContent.trimStart()
  if (!trimmed.startsWith('---')) {
    if (newTags.length === 0) return rawContent
    return `---\ntags: [${newTags.join(', ')}]\n---\n\n${rawContent}`
  }
  const parsed = matter(rawContent)
  if (newTags.length > 0) parsed.data.tags = newTags
  else delete parsed.data.tags
  return matter.stringify(parsed.content, parsed.data)
}

export interface BulkTagProgress {
  current: number
  total: number
  docName: string
  done: boolean
}

/**
 * Bulk-assigns AI tags to all documents in the vault.
 * Calls suggestTagsForDoc for each document — updates frontmatter and saves if tags are returned.
 * Skips documents with no tags or errors (preserves existing tags).
 */
export async function bulkAssignTagsToAllDocs(
  docs: LoadedDocument[],
  onProgress: (p: BulkTagProgress) => void,
): Promise<{ saved: number; skipped: number }> {
  if (!docs.length) return { saved: 0, skipped: 0 }

  let saved = 0
  let skipped = 0

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i]
    onProgress({ current: i + 1, total: docs.length, docName: doc.filename, done: false })

    try {
      const tags = await suggestTagsForDoc(doc.filename, doc.rawContent)
      if (tags.length > 0 && window.vaultAPI) {
        const newRaw = applyTagsToContent(doc.rawContent, tags)
        await window.vaultAPI.saveFile(doc.absolutePath, newRaw)
        saved++
      } else {
        skipped++
      }
    } catch {
      skipped++
    }
  }

  onProgress({ current: docs.length, total: docs.length, docName: '', done: true })
  return { saved, skipped }
}
