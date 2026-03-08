/**
 * tagService.ts
 *
 * AI tag suggestions: analyzes a document's filename + content (first 300 chars)
 * using the configured model and returns suitable tags from the user-defined
 * tagPresets list as a JSON array.
 * Returns an empty array ([]) when uncertain → shown as "Untagged" in the sidebar.
 *
 * Supported providers: anthropic, openai, gemini, grok
 */

import matter from 'gray-matter'
import type { LoadedDocument } from '@/types'
import { useSettingsStore, getApiKey } from '@/stores/settingsStore'
import { getProviderForModel } from '@/lib/modelConfig'

const SYSTEM_PROMPT = `You are a document classification expert.
For the given document, select only the suitable tags from the provided list and respond with a JSON array only.
The response must be a valid JSON array. Example: ["combat", "skill"]
If unsure, return an empty array [].
Never include explanations or any other text.`

/** Calls the appropriate streamCompletion for the provider and returns the full response string. */
async function callStream(
  provider: string,
  apiKey: string,
  modelId: string,
  userMessage: string,
): Promise<string> {
  let result = ''
  const onChunk = (c: string) => { result += c }
  const msgs: { role: 'user' | 'assistant'; content: string }[] = [
    { role: 'user', content: userMessage },
  ]

  if (provider === 'anthropic') {
    const { streamCompletion } = await import('./providers/anthropic')
    await streamCompletion(apiKey, modelId, SYSTEM_PROMPT, msgs, onChunk)
  } else if (provider === 'openai') {
    const { streamCompletion } = await import('./providers/openai')
    await streamCompletion(apiKey, modelId, SYSTEM_PROMPT, msgs, onChunk)
  } else if (provider === 'gemini') {
    const { streamCompletion } = await import('./providers/gemini')
    await streamCompletion(apiKey, modelId, SYSTEM_PROMPT, msgs, onChunk)
  } else if (provider === 'grok') {
    const { streamCompletion } = await import('./providers/grok')
    await streamCompletion(apiKey, modelId, SYSTEM_PROMPT, msgs, onChunk)
  }

  return result
}

/**
 * Suggests suitable tags for a given document using AI.
 * Returns [] immediately if tagPresets is empty or API key is not set.
 */
export async function suggestTagsForDoc(
  docFilename: string,
  docContent: string
): Promise<string[]> {
  const state = useSettingsStore.getState()
  const { tagPresets, personaModels } = state

  if (tagPresets.length === 0) return []

  const modelId = personaModels['chief_director']
  if (!modelId) return []

  const provider = getProviderForModel(modelId)
  if (!provider) return []

  const apiKey = getApiKey(provider)
  if (!apiKey) return []

  const contentPreview = docContent.replace(/^---[\s\S]*?---\n*/m, '').slice(0, 300)
  const userMessage = `Filename: ${docFilename}
Content (beginning):
${contentPreview}

Allowed tag list: ${tagPresets.join(', ')}

Return only tags suitable for this document from the list above as a JSON array.`

  let result = ''
  try {
    result = await callStream(provider, apiKey, modelId, userMessage)
  } catch {
    return []
  }

  // Parse JSON array and filter to only tags present in tagPresets
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
 * Bulk assigns AI tags to all documents in the vault.
 * Calls suggestTagsForDoc for each document → updates frontmatter and saves if tags are found.
 * Documents with no tags or errors are skipped (existing tags preserved).
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
