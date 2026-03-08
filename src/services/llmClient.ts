import type { ChatMessage, SpeakerId, DirectorId, Attachment, LoadedDocument } from '@/types'
import type { ConversionMeta } from '@/lib/mdConverter'
import { logger } from '@/lib/logger'
import { MODEL_OPTIONS, getProviderForModel, type ProviderId } from '@/lib/modelConfig'
import { PERSONA_PROMPTS, buildProjectContext } from '@/lib/personaPrompts'
import { selectMockResponse } from '@/data/mockResponses'
import { useSettingsStore, getApiKey } from '@/stores/settingsStore'
import {
  rerankResults,
  frontendKeywordSearch,
  buildDeepGraphContext,
  buildGlobalGraphContext,
  getGlobalContextDocIds,
  tokenizeQuery,
  directVaultSearch,
  getStrippedBody,
} from '@/lib/graphRAG'
import { useGraphStore } from '@/stores/graphStore'
import { useVaultStore } from '@/stores/vaultStore'
import { useMemoryStore } from '@/stores/memoryStore'

// ── Obsidian MD conversion (MD conversion editor pipeline) ────────────────────

/**
 * Convert raw text to an Obsidian-compatible Markdown document using Claude.
 *
 * Output format:
 *   KEYWORDS: kw1, kw2, ...
 *   (blank line)
 *   ---
 *   (frontmatter + body)
 *
 * Falls back to a simple template if no API key is configured.
 *
 * @param rawContent  The raw text to convert
 * @param meta        Document metadata (title, speaker, date, type)
 * @param onChunk     Called with each streamed token
 */
export async function convertToObsidianMD(
  rawContent: string,
  meta: ConversionMeta,
  onChunk: (chunk: string) => void
): Promise<void> {
  const { personaModels } = useSettingsStore.getState()
  const modelId = personaModels['chief_director']
  const provider = getProviderForModel(modelId)

  const fallbackOutput = [
    `KEYWORDS: ${meta.title}, ${meta.type}`,
    '',
    '---',
    `speaker: ${meta.speaker}`,
    `date: ${meta.date}`,
    `tags: [${meta.type}]`,
    `type: ${meta.type}`,
    `---`,
    '',
    `## ${meta.title}`,
    '',
    rawContent,
  ].join('\n')

  if (!provider) {
    onChunk(fallbackOutput)
    return
  }

  const apiKey = getApiKey(provider)

  if (!apiKey) {
    onChunk(fallbackOutput)
    return
  }

  const model = MODEL_OPTIONS.find((m) => m.id === modelId)!

  const systemPrompt =
    'You are a knowledge management expert at a game development studio. ' +
    'Analyze raw text and structure it in Obsidian markdown format.'

  const userMessage =
    `Please convert the following text to Obsidian markdown.\n\n` +
    `Follow this format exactly:\n` +
    `1. First line: KEYWORDS: keyword1, keyword2, keyword3 (5-10 key terms, comma-separated)\n` +
    `2. Blank line\n` +
    `3. Separator: ---\n` +
    `4. Obsidian frontmatter:\n` +
    `---\n` +
    `speaker: ${meta.speaker}\n` +
    `date: ${meta.date}\n` +
    `tags: [${meta.type}, keyword1, keyword2]\n` +
    `type: ${meta.type}\n` +
    `---\n` +
    `5. ## ${meta.title}\n` +
    `6. Use each key keyword as a ## subheading and organize related content\n\n` +
    `Title: ${meta.title}\nType: ${meta.type}\n\nSource:\n${rawContent}`

  const messages = [{ role: 'user' as const, content: sanitize(userMessage) }]
  const cleanSystemPromptMd = sanitize(systemPrompt)

  switch (model.provider) {
    case 'anthropic': {
      const { streamCompletion } = await import('./providers/anthropic')
      await streamCompletion(apiKey, modelId, cleanSystemPromptMd, messages, onChunk)
      break
    }
    case 'openai': {
      const { streamCompletion } = await import('./providers/openai')
      await streamCompletion(apiKey, modelId, cleanSystemPromptMd, messages, onChunk)
      break
    }
    case 'gemini': {
      const { streamCompletion } = await import('./providers/gemini')
      await streamCompletion(apiKey, modelId, cleanSystemPromptMd, messages, onChunk)
      break
    }
    case 'grok': {
      const { streamCompletion } = await import('./providers/grok')
      await streamCompletion(apiKey, modelId, cleanSystemPromptMd, messages, onChunk)
      break
    }
    default:
      onChunk(fallbackOutput)
  }
}

// ── Provider dispatch helper ───────────────────────────────────────────────────

/**
 * Dynamically imports a provider module.
 * Uses switch instead of template literals so Vite's bundler can statically analyze chunks.
 */
async function importProvider(provider: string) {
  switch (provider) {
    case 'anthropic': return import('./providers/anthropic')
    case 'openai':    return import('./providers/openai')
    case 'gemini':    return import('./providers/gemini')
    case 'grok':      return import('./providers/grok')
    default: throw new Error(`Unknown provider: ${provider}`)
  }
}

// ── Unicode sanitization ───────────────────────────────────────────────────────

/**
 * Remove lone Unicode surrogates from a string.
 *
 * JavaScript strings are UTF-16. Slicing document content at a byte boundary
 * (e.g. body.slice(0, 1500)) can split a surrogate pair, leaving an orphaned
 * high surrogate (U+D800–DBFF) or low surrogate (U+DC00–DFFF).
 * JSON.stringify then produces invalid JSON and Anthropic's API returns 400.
 *
 * Regex: match valid pair (keep) OR lone surrogate (remove).
 */
function sanitize(str: string): string {
  return str.replace(
    /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g,
    m => m.length === 2 ? m : ''
  )
}

// ── Message history conversion ─────────────────────────────────────────────────

function toHistoryMessages(
  history: ChatMessage[]
): { role: 'user' | 'assistant'; content: string }[] {
  return history
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
}

// ── Fallback mock stream ───────────────────────────────────────────────────────

/** Emit the mock response character-by-character with a small delay to simulate streaming */
async function streamMockResponse(
  persona: SpeakerId,
  userMessage: string,
  onChunk: (chunk: string) => void
): Promise<void> {
  const mock = selectMockResponse(persona as DirectorId, userMessage)
  const prefix = '[Mock] '
  const fullText = prefix + mock

  // Emit in small word-sized chunks to feel like streaming
  const words = fullText.split(' ')
  for (let i = 0; i < words.length; i++) {
    const chunk = (i === 0 ? '' : ' ') + words[i]
    onChunk(chunk)
    await new Promise<void>((r) => setTimeout(r, 30 + Math.random() * 20))
  }
}

// ── Graph-Augmented RAG context fetcher ──────────────────────────────────────

/**
 * Fetch relevant document chunks and enhance with graph context.
 *
 * Pipeline:
 *   1. Fetch top-8 candidates via TF-IDF (over-fetch for reranking headroom)
 *   2. Filter by minimum similarity score (> 0.3)
 *   3. Rerank by keyword overlap + speaker affinity → top 3
 *   4. Expand with graph-connected neighbor sections (wiki-link traversal)
 *   5. Format into compressed, token-efficient context string
 *
 * Failure is always non-fatal — the LLM call continues without RAG context.
 *
 * @param userMessage    The user's query text
 * @param currentSpeaker Optional current persona for speaker affinity boost
 */
/**
 * Pattern for detecting global exploration intent.
 * When matched, switches to hub-node-based full graph traversal.
 */
const GLOBAL_INTENT_RE = /전체|전반적|모든\s*문서|프로젝트\s*전체|전체적인|overview|전체\s*인사이트|전반|총체적|전체\s*피드백|big.?picture/i

// ── Multi-Agent RAG helpers ───────────────────────────────────────────────────

/** Cheapest Worker model ID per provider */
const WORKER_MODELS: Record<string, string> = {
  anthropic: 'claude-haiku-4-5-20251001',
  openai: 'gpt-4.1-mini',
  gemini: 'gemini-2.5-flash-lite',
  grok: 'grok-3-mini',
}

/**
 * Returns the cheapest Worker model for the current model's provider.
 * Workers are used for repetitive lightweight tasks such as document summarization.
 */
function getWorkerModelId(currentModelId: string): { modelId: string; provider: string } {
  const provider = getProviderForModel(currentModelId) ?? 'anthropic'
  return { modelId: WORKER_MODELS[provider] ?? currentModelId, provider }
}

/**
 * Summarizes a single document from the query's perspective using a Worker LLM.
 * Falls back to the first 300 characters of the body on API error or missing key.
 */
async function agentSummarizeDoc(
  doc: LoadedDocument,
  query: string,
  apiKey: string,
  provider: string,
  workerModelId: string,
): Promise<string> {
  const body = getStrippedBody(doc)
  const content = body.length > 8000 ? body.slice(0, 8000) : body
  const sysPrompt = 'Summarize the document from the perspective of the question in 200 characters or fewer. Output only the summary.'
  const userMsg = `Question: ${query}\n\nDocument (${doc.filename}):\n${content}`
  let result = ''
  try {
    const { streamCompletion } = await importProvider(provider)
    await streamCompletion(
      apiKey,
      workerModelId,
      sysPrompt,
      [{ role: 'user' as const, content: sanitize(userMsg) }],
      (c: string) => { result += c },
    )
  } catch { result = '' }
  return result.trim() || body.slice(0, 300)
}

/**
 * Summarizes recent conversation using an LLM.
 * Called from the "Save Summary" button in ChatPanel → stored via memoryStore.appendToMemory().
 */
export async function summarizeConversation(
  messages: ChatMessage[],
  onChunk: (chunk: string) => void,
): Promise<void> {
  const { personaModels } = useSettingsStore.getState()
  const modelId = personaModels['chief_director']
  const provider = getProviderForModel(modelId)
  const apiKey = provider ? getApiKey(provider) : undefined
  if (!apiKey || !provider) return

  const histText = messages
    .slice(-20)
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => `${m.role === 'user' ? '👤' : '🤖'} ${m.content.slice(0, 300)}`)
    .join('\n')
  const sysPrompt = 'Summarize the conversation in 500 characters or fewer, focusing on key decisions, insights, and agreed-upon content.'
  const userMsg = `Please summarize the following conversation:\n\n${histText}`

  const { streamCompletion } = await importProvider(provider)
  await streamCompletion(
    apiKey,
    modelId,
    sysPrompt,
    [{ role: 'user' as const, content: sanitize(userMsg) }],
    onChunk,
  )
}

export async function fetchRAGContext(
  userMessage: string,
  currentSpeaker?: string
): Promise<string> {
  try {
    // ── Global exploration intent: hub-node-based full graph traversal ──────────
    // Skip keyword search and collect broad context directly via hub-centered BFS
    if (GLOBAL_INTENT_RE.test(userMessage)) {
      useGraphStore.getState().setAiHighlightNodes(getGlobalContextDocIds(35, 4))
      return buildGlobalGraphContext(35, 4)
    }

    // ── Stage 1: Direct string search (attempted first) ────────────────────────
    // Space-split + numeric extraction to ensure date-format filenames ("[2026.01.28]") match
    const directHits = directVaultSearch(userMessage, 8)

    // Re-sort with newest docs first: when keyword scores are similar, promote newer docs
    // 180-day half-life recency boost (max +0.25) — 2020 documents effectively score 0
    {
      const _rdocs = useVaultStore.getState().loadedDocuments
      const _rdocMap = new Map(_rdocs?.map(d => [d.id, d]) ?? [])
      const _rnow = Date.now()
      const HALF_LIFE_MS = 180 * 24 * 60 * 60 * 1000
      const recBoost = (docId: string) => {
        const d = _rdocMap.get(docId)
        if (!d) return 0
        const ms = d.mtime ?? (d.date ? Date.parse(d.date) : NaN)
        return isNaN(ms) ? 0 : 0.25 * Math.exp(-(_rnow - ms) / HALF_LIFE_MS)
      }
      directHits.sort((a, b) => (b.score + recBoost(b.doc_id)) - (a.score + recBoost(a.doc_id)))
    }

    // If filename match (score 2x) exists, treat as "explicit document reference" query (raw score >= 2 → normalized 0.2)
    const hasStrongDirectHit = directHits.some(r => r.score >= 0.2)

    // ── Strong filename match (score >= 0.4): inject full body directly + BFS complement ──
    // score >= 0.4 = raw >= 4 = 2+ query words matched in filename
    // score >= 0.2 single match (generic words like "meeting", "document") used as BFS seed only to prevent false positives
    const strongPinnedHits = directHits.filter(r => r.score >= 0.4)
    if (strongPinnedHits.length > 0) {
      const { loadedDocuments: _docs, } = useVaultStore.getState()
      const { multiAgentRAG, personaModels } = useSettingsStore.getState()
      const docMap = new Map(_docs?.map(d => [d.id, d]) ?? [])

      // Top-1: chief reads the full body directly (up to 20K chars)
      const topDoc = docMap.get(strongPinnedHits[0].doc_id)
      const pinnedParts: string[] = ['## Directly Referenced Document (Full Content)\n']
      if (topDoc) {
        const body = getStrippedBody(topDoc)
        const truncated = body.length > 20000 ? body.slice(0, 20000).trimEnd() + '…' : body
        pinnedParts.push(`[Document] ${topDoc.filename.replace(/\.md$/i, '')}\n${truncated}\n\n`)
      }

      // Docs 2-5: Worker LLM summarizes in parallel (when multiAgentRAG setting is on)
      if (multiAgentRAG && strongPinnedHits.length > 1) {
        const currentModelId = personaModels[currentSpeaker as DirectorId] ?? personaModels['chief_director']
        const { modelId: workerModelId, provider: workerProvider } = getWorkerModelId(currentModelId)
        const workerApiKey = getApiKey(workerProvider as ProviderId)
        if (workerApiKey) {
          const summaries = await Promise.all(
            strongPinnedHits.slice(1, 5).map(hit => {
              const doc = docMap.get(hit.doc_id)
              return doc
                ? agentSummarizeDoc(doc, userMessage, workerApiKey, workerProvider, workerModelId)
                    .then(s => `[Worker Summary] ${doc.filename.replace(/\.md$/i, '')}\n${s}\n`)
                : Promise.resolve('')
            })
          )
          const summarySection = summaries.filter(Boolean).join('\n')
          if (summarySection) pinnedParts.push('\n## Related Document Summaries (Worker)\n' + summarySection)
        }
      }

      if (pinnedParts.length > 1) {
        const pinnedCtx = pinnedParts.join('')
        const bfsCtx = buildDeepGraphContext(directHits, 2, 10, tokenizeQuery(userMessage))
        logger.debug(`[RAG] Multi-agent: pinned=${pinnedCtx.length} chars, BFS=${bfsCtx.length} chars`)
        useGraphStore.getState().setAiHighlightNodes(directHits.map(r => r.doc_id))
        return pinnedCtx + (bfsCtx ? '\n' + bfsCtx : '')
      }
    }

    let seeds: import('@/types').SearchResult[]

    if (hasStrongDirectHit) {
      // Direct search results are sufficient → use as primary seeds (fallback path)
      seeds = directHits
      logger.debug(`[RAG] Direct search priority: ${seeds.map(r => r.filename).join(', ')}`)
    } else {
      // Insufficient direct match → TF-IDF keyword search fallback
      const candidates = frontendKeywordSearch(userMessage, 8, currentSpeaker)

      logger.debug(`[RAG] TF-IDF candidates: ${candidates.length} (query: "${userMessage.slice(0, 40)}")`)

      const relevant = candidates.filter(r => r.score > 0.05)
      seeds = relevant.length > 0 ? rerankResults(relevant, userMessage, 5, currentSpeaker) : []

      // Supplement with documents missed by TF-IDF in direct search
      const seedIds = new Set(seeds.map(r => r.doc_id))
      for (const hit of directHits) {
        if (!seedIds.has(hit.doc_id)) seeds.push(hit)
      }
    }

    // Always include _index.md
    const { loadedDocuments: _vaultDocs } = useVaultStore.getState()
    const indexDoc = _vaultDocs?.find(d => d.filename.toLowerCase() === '_index.md')
    if (indexDoc && !seeds.some(r => r.doc_id === indexDoc.id)) {
      const firstSection = indexDoc.sections.find(s => s.body.trim())
      seeds.unshift({
        doc_id: indexDoc.id,
        filename: indexDoc.filename,
        section_id: firstSection?.id ?? '',
        heading: firstSection?.heading ?? '',
        speaker: indexDoc.speaker,
        content: firstSection
          ? (firstSection.body.length > 600 ? firstSection.body.slice(0, 600).trimEnd() + '…' : firstSection.body)
          : '',
        score: 1.0,
        tags: indexDoc.tags ?? [],
      })
    }

    const reranked = seeds

    // Stage 2: BFS graph traversal — collect connected documents up to 3 hops from seeds
    if (reranked.length > 0) {
      useGraphStore.getState().setAiHighlightNodes(reranked.map(r => r.doc_id))
    }
    const ctx = buildDeepGraphContext(reranked, 3, 20, tokenizeQuery(userMessage))
    logger.debug(`[RAG] Context generation complete: ${ctx.length} chars`)
    return ctx
  } catch (err) {
    // RAG failure is non-fatal — continue without context
    logger.error('[RAG] fetchRAGContext error:', err)
    return ''
  }
}

// ── Main entry point ───────────────────────────────────────────────────────────

/**
 * Route a user message to the appropriate LLM provider and stream the response.
 *
 * If no API key is configured for the selected model's provider, falls back to
 * the mock response system (with a "[Mock]" prefix so the user knows).
 *
 * Relevant document chunks fetched via TF-IDF are prepended
 * to the system prompt as RAG context.
 *
 * Image attachments are sent to vision-capable providers (Anthropic, OpenAI, Gemini).
 * Text file attachments are appended to the user message as quoted context.
 *
 * @param persona      The director persona responding
 * @param userMessage  The raw user message text
 * @param history      Full conversation history (for context)
 * @param onChunk      Called with each streamed text delta
 * @param attachments  Optional files attached to the current message
 */

/**
 * For the Slack bot: collects context using the RAG pipeline (BFS+TF-IDF)
 * and generates a response with the specified persona model.
 * Called from the onAsk handler in useRagApi.ts.
 */
export async function generateSlackAnswer(
  query: string,
  directorId: string,
  history: { role: 'user' | 'assistant'; content: string }[] = [],
  images?: { data: string; mediaType: string }[],
): Promise<string> {
  const {
    personaModels, projectInfo, directorBios, customPersonas,
    personaPromptOverrides, responseInstructions, ragInstruction,
    personaDocumentIds,
  } = useSettingsStore.getState()

  // Same as streamMessage: custom persona takes priority
  const customPersona = customPersonas.find(p => p.id === directorId)
  const modelId = customPersona
    ? customPersona.modelId
    : (personaModels[directorId as DirectorId] ?? personaModels['chief_director'])
  const provider = getProviderForModel(modelId)
  if (!provider) return ''
  const apiKey = getApiKey(provider)
  if (!apiKey) return ''

  // ── System prompt construction (same order as streamMessage) ─────────────────
  const basePrompt = customPersona
    ? customPersona.systemPrompt
    : (personaPromptOverrides[directorId as DirectorId]
        ?? PERSONA_PROMPTS[directorId as DirectorId]
        ?? PERSONA_PROMPTS['chief_director'])

  const directorBio = customPersona ? undefined : directorBios[directorId as DirectorId]
  const projectContext = buildProjectContext(projectInfo, directorBio)

  // Persona document injection
  const personaDocId = personaDocumentIds[directorId]
  let personaDocContext = ''
  if (personaDocId) {
    const doc = useVaultStore.getState().loadedDocuments?.find(d => d.id === personaDocId)
    if (doc) {
      personaDocContext = `\n\n---\nThe following is persona reference material from the document "${doc.filename}". Use this content to inform the character's perspective and tone:\n\n${doc.rawContent.slice(0, 4000)}`
    }
  }

  // Long-term memory injection
  const { memoryText } = useMemoryStore.getState()
  const memoryContext = memoryText.trim()
    ? `\n\n---\n## 📌 Previous Conversation Memory\n${memoryText.trim()}\n---`
    : ''

  const ragInstructionBlock = ragInstruction.trim() ? '\n\n' + ragInstruction.trim() : ''
  const systemPrompt = projectContext + basePrompt + ragInstructionBlock + personaDocContext + memoryContext
    + (responseInstructions.trim() ? '\n\n' + responseInstructions.trim() : '')

  // ── RAG context → inject before user message (same as streamMessage) ─────────
  const ragContext = await fetchRAGContext(query, directorId)
  let fullUserMessage = query
  if (ragContext) {
    fullUserMessage = `${ragContext}The above documents are relevant materials collected by traversing the vault's WikiLink graph.\nWhen answering, refer to these materials to provide insights and specific feedback.\n\n---\n\n${query}`
  }

  // Previous conversation history (up to 20 messages = 10 turns)
  const historyMessages = history.slice(-20).map(m => ({
    role: m.role,
    content: sanitize(m.content),
  }))

  // Convert image attachments to Attachment array (common format used by providers)
  const attachments: import('@/types').Attachment[] = (images ?? []).map((img, i) => ({
    id: `slack-img-${i}`,
    name: `image${i}.${img.mediaType.split('/')[1] ?? 'png'}`,
    type: 'image' as const,
    mimeType: img.mediaType,
    dataUrl: `data:${img.mediaType};base64,${img.data}`,
    size: 0,
  }))

  let answer = ''
  const { streamCompletion } = await importProvider(provider)
  await streamCompletion(
    apiKey, modelId,
    sanitize(systemPrompt),
    [...historyMessages, { role: 'user' as const, content: sanitize(fullUserMessage) }],
    (c: string) => { answer += c },
    attachments,
  )
  return answer
}

export async function streamMessage(
  persona: SpeakerId,
  userMessage: string,
  history: ChatMessage[],
  onChunk: (chunk: string) => void,
  attachments?: Attachment[],
  overrideRagContext?: string   // bypass keyword search — used for node selection AI analysis etc.
): Promise<void> {
  const { personaModels, projectInfo, directorBios, customPersonas, personaPromptOverrides, responseInstructions, ragInstruction, personaDocumentIds } = useSettingsStore.getState()

  // Resolve persona — may be a built-in director or a custom persona
  const customPersona = customPersonas.find(p => p.id === persona)
  const modelId = customPersona
    ? customPersona.modelId
    : personaModels[persona as DirectorId]
  const provider = getProviderForModel(modelId)

  if (!provider) {
    // Model not found in catalogue — use mock
    await streamMockResponse(persona, userMessage, onChunk)
    return
  }

  const apiKey = getApiKey(provider)

  if (!apiKey) {
    // No API key configured — use mock
    await streamMockResponse(persona, userMessage, onChunk)
    return
  }

  const model = MODEL_OPTIONS.find((m) => m.id === modelId)!

  // Resolve system prompt: custom persona > built-in override > built-in default
  const basePrompt = customPersona
    ? customPersona.systemPrompt
    : (personaPromptOverrides[persona] ?? PERSONA_PROMPTS[persona as DirectorId] ?? '')

  // Director bio only applies to built-in personas
  const directorBio = customPersona ? undefined : directorBios[persona as DirectorId]
  const projectContext = buildProjectContext(projectInfo, directorBio)

  // ── Persona document injection ──────────────────────────────────────────────
  // If a vault document is linked to this persona in settings, inject it into the system prompt
  const personaDocId = personaDocumentIds[persona]
  let personaDocContext = ''
  if (personaDocId) {
    const doc = useVaultStore.getState().loadedDocuments?.find(d => d.id === personaDocId)
    if (doc) {
      personaDocContext = `\n\n---\nThe following is persona reference material from the document "${doc.filename}". Use this content to inform the character's perspective and tone:\n\n${doc.rawContent.slice(0, 4000)}`
    }
  }

  // ── AI long-term memory injection ────────────────────────────────────────────
  const { memoryText } = useMemoryStore.getState()
  const memoryContext = memoryText.trim()
    ? `\n\n---\n## 📌 Previous Conversation Memory\n${memoryText.trim()}\n---`
    : ''

  // ── Graph-Augmented RAG context injection ──────────────────────────────────
  // If overrideRagContext is provided, use it directly without keyword search (e.g. direct node selection analysis)
  const ragContext = overrideRagContext !== undefined
    ? overrideRagContext
    : await fetchRAGContext(userMessage, persona)
  const ragInstructionBlock = ragInstruction.trim() ? '\n\n' + ragInstruction.trim() : ''
  const systemPrompt = projectContext + basePrompt + ragInstructionBlock + personaDocContext + memoryContext + (responseInstructions.trim() ? '\n\n' + responseInstructions.trim() : '')

  // ── Attachment processing ───────────────────────────────────────────────────
  // Separate image attachments (→ vision API) from text attachments (→ message injection)
  const imageAttachments = attachments?.filter(a => a.type === 'image') ?? []
  const textAttachments  = attachments?.filter(a => a.type === 'text')  ?? []

  // Append text file content to user message
  let fullUserMessage = userMessage
  if (textAttachments.length > 0) {
    const textContext = textAttachments
      .map(a => `\n\n[Attached file: ${a.name}]\n${a.dataUrl}`)
      .join('')
    fullUserMessage = userMessage + textContext
  }

  // Inject graph context before the user message
  // [Direct] = direct keyword match, [1-hop]/[2-hop] = documents found via WikiLink traversal
  if (ragContext) {
    fullUserMessage = `${ragContext}The above documents are relevant materials collected by traversing the vault's WikiLink graph.\nWhen answering, refer to these materials to provide insights and specific feedback.\n\n---\n\n${fullUserMessage}`
  }

  // Build message history, excluding the current user message
  let historyMessages = toHistoryMessages(
    history.filter((m) => m.content !== userMessage || m.role !== 'user')
  )

  // ── Context compaction: if history is too long, summarize older messages and inject into system prompt ──
  const histChars = historyMessages.reduce((s, m) => s + m.content.length, 0)
  let finalSystemPrompt = systemPrompt
  if (histChars > 20_000 && historyMessages.length > 10) {
    try {
      const { modelId: wModelId, provider: wProvider } = getWorkerModelId(modelId)
      const wApiKey = getApiKey(wProvider as ProviderId)
      if (wApiKey) {
        const oldMessages = historyMessages.slice(0, -8)
        const recentMessages = historyMessages.slice(-8)
        const oldText = oldMessages
          .map(m => `${m.role}: ${m.content.slice(0, 200)}`)
          .join('\n')
        let compactSummary = ''
        const { streamCompletion: wComplete } = await importProvider(wProvider)
        await wComplete(
          wApiKey, wModelId,
          'Summarize the conversation in 300 characters.',
          [{ role: 'user' as const, content: sanitize(oldText) }],
          (c: string) => { compactSummary += c },
        )
        if (compactSummary.trim()) {
          finalSystemPrompt += `\n\n## Previous Conversation Summary (Auto-compacted)\n${compactSummary.trim()}`
          historyMessages = recentMessages
          // Also auto-save compaction summary to AI long-term memory
          const timestamp = new Date().toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
          useMemoryStore.getState().appendToMemory(`[${timestamp} Auto Summary]\n${compactSummary.trim()}`)
          logger.debug(`[compaction] ${histChars} chars → last 8 messages + summary injected + memory saved`)
        }
      }
    } catch (e) {
      logger.warn('[compaction] Failed — using full history:', e)
    }
  }

  const cleanSystemPrompt = sanitize(finalSystemPrompt)
  const allMessages = [
    ...historyMessages,
    { role: 'user' as const, content: sanitize(fullUserMessage) },
  ]

  // Dynamically import the provider module to keep bundle splitting clean
  switch (model.provider) {
    case 'anthropic': {
      const { streamCompletion } = await import('./providers/anthropic')
      await streamCompletion(apiKey, modelId, cleanSystemPrompt, allMessages, onChunk, imageAttachments)
      break
    }
    case 'openai': {
      const { streamCompletion } = await import('./providers/openai')
      await streamCompletion(apiKey, modelId, cleanSystemPrompt, allMessages, onChunk, imageAttachments)
      break
    }
    case 'gemini': {
      const { streamCompletion } = await import('./providers/gemini')
      await streamCompletion(apiKey, modelId, cleanSystemPrompt, allMessages, onChunk, imageAttachments)
      break
    }
    case 'grok': {
      const { streamCompletion } = await import('./providers/grok')
      // Grok does not support vision — notify user if images were attached
      if (imageAttachments.length > 0) {
        onChunk('[Grok does not support image analysis. Text only will be processed.]\n\n')
      }
      await streamCompletion(apiKey, modelId, cleanSystemPrompt, allMessages, onChunk)
      break
    }
    default: {
      await streamMockResponse(persona, userMessage, onChunk)
    }
  }

  // Clear chat RAG highlight (GraphPanel analysis manages its own)
  if (overrideRagContext === undefined) {
    useGraphStore.getState().setAiHighlightNodes([])
  }
}
