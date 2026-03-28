import type { ChatMessage, SpeakerId, DirectorId, Attachment, LoadedDocument, ProviderId } from '@/types'
import type { AnthropicTool, AgentLoopOpts, AgentMsg } from '@/services/agentLoop'
import { runAgentLoop } from '@/services/agentLoop'
import type { ConversionMeta } from '@/lib/mdConverter'
import { logger } from '@/lib/logger'
import { MODEL_OPTIONS, getProviderForModel, WORKER_MODEL_IDS } from '@/lib/modelConfig'
import { PERSONA_PROMPTS, buildProjectContext } from '@/lib/personaPrompts'
import { selectMockResponse } from '@/data/mockResponses'
import { useSettingsStore, getApiKey } from '@/stores/settingsStore'
import { useUsageStore } from '@/stores/usageStore'
import {
  rerankResults,
  frontendKeywordSearch,
  buildDeepGraphContext,
  buildGlobalGraphContext,
  getGlobalContextDocIds,
  tokenizeQuery,
  directVaultSearch,
  getStrippedBody,
  deduplicateVersions,
} from '@/lib/graphRAG'
import { useGraphStore } from '@/stores/graphStore'
import { useVaultStore } from '@/stores/vaultStore'
import { useMemoryStore } from '@/stores/memoryStore'
import { vectorEmbedIndex } from '@/lib/vectorEmbedIndex'

// ── Obsidian MD conversion (MD conversion editor pipeline) ─────────────────────

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
  const mainModelId = personaModels['chief_director']
  const { modelId, provider } = getWorkerModelId(mainModelId)

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

  const systemPrompt =
    'You are a knowledge management expert at a game development studio. ' +
    'You analyze raw text and structure it into Obsidian markdown format.'

  const userMessage =
    `Please convert the following text to Obsidian markdown.\n\n` +
    `You must follow this exact format:\n` +
    `1. First line: KEYWORDS: keyword1, keyword2, keyword3 (5-10 key terms, comma separated)\n` +
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
    `6. Use each key term as a ## subheading to organize related content\n\n` +
    `Title: ${meta.title}\nType: ${meta.type}\n\nOriginal text:\n${rawContent}`

  const messages = [{ role: 'user' as const, content: sanitize(userMessage) }]

  try {
    const { streamCompletion } = await importProvider(provider)
    await streamCompletion(apiKey, modelId, sanitize(systemPrompt), messages, onChunk)
  } catch {
    onChunk(fallbackOutput)
  }
}

// ── Provider dispatch helper ───────────────────────────────────────────────────

/**
 * Dynamically imports the provider module.
 * Uses switch instead of template literals so Vite bundler can statically analyze chunks.
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
 * Fetch relevant document chunks from ChromaDB and enhance with graph context.
 *
 * Pipeline:
 *   1. Fetch top-8 candidates from ChromaDB (over-fetch for reranking headroom)
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
 * Pattern to detect full exploration intent.
 * When this pattern matches, switches to hub-node-based full graph traversal.
 */
const GLOBAL_INTENT_RE = /(?:^|\s)(전체적인|전반적|총체적|프로젝트\s*전체|전체\s*인사이트|전체\s*피드백|모든\s*문서|big.?picture|overview)(?:\s|[?.!,]|$)|^전체\s*$|^전반\s*$/i

/**
 * Recency request intent pattern.
 * When matched, re-sorts TF-IDF seeds in reverse date order and injects date warning into context.
 */
const RECENCY_INTENT_RE = /최신|최근|요즘|이번\s*달|이번\s*주|오늘|지금|현재|방금|가장\s*새|latest|recent|진행\s*방향|진행\s*상황|진행\s*현황|현재\s*상태|현황|어떻게\s*됐|어떻게\s*되고|어디까지|어떤\s*상태|업데이트|최신화/i

// ── Domain classification for 2-team sub-agent architecture ──────────────────

/** Narrative/character domain keywords */
const NARRATIVE_DOMAIN_RE = /캐릭터|스토리|세계관|나레이션|설정|배경|인물|페르소나|persona|character|story|world|narrative|lore|plot|캐릭터설정|케릭터/i
/** System/gameplay domain keywords */
const SYSTEM_DOMAIN_RE = /게임플레이|시스템|메카닉|스펙|밸런스|UI|UX|기술|아트|사운드|gameplay|mechanic|spec|balance|tech|art|sound|data|점령전|난투전|전투|combat|level|레벨|버그|패치|수치|공식|계산/i

function classifyDocDomain(doc: LoadedDocument): 'narrative' | 'system' | 'general' {
  const text = [doc.filename, doc.tags?.join(' ') ?? '', doc.speaker ?? ''].join(' ')
  if (NARRATIVE_DOMAIN_RE.test(text)) return 'narrative'
  if (SYSTEM_DOMAIN_RE.test(text)) return 'system'
  return 'general'
}

/**
 * Sub-agent: synthesizes per-domain worker summaries into a single perspective insight.
 * Streams in real-time if onChunk is provided.
 */
async function agentSynthesizeDomain(
  workerSummaries: string[],
  query: string,
  domain: 'narrative' | 'system',
  apiKey: string,
  provider: string,
  workerModelId: string,
  onChunk?: (chunk: string) => void,
): Promise<string> {
  if (workerSummaries.length === 0) return ''
  const domainName = domain === 'narrative' ? 'narrative/character' : 'system/gameplay'
  const sysPrompt =
    `You are a ${domainName} specialist sub-agent. ` +
    `Based on the worker summaries below, synthesize key insights from the "${domainName}" perspective in 200 characters or less. ` +
    `Prioritize connections and implications that people might easily miss. Output only the insight text.`
  const content = `Question: ${query}\n\nWorker summaries:\n${workerSummaries.join('\n---\n').slice(0, 4000)}`
  let result = ''
  try {
    const { streamCompletion } = await importProvider(provider)
    await streamCompletion(
      apiKey, workerModelId, sysPrompt,
      [{ role: 'user' as const, content: sanitize(content) }],
      (c: string) => { result += c; onChunk?.(c) },
    )
  } catch { result = '' }
  return result.trim()
}

// ── Multi-Agent RAG helpers ───────────────────────────────────────────────────

/** Sub-agent synthesis timeout utility — module-level singleton (avoids recreating per fetchRAGContext call) */
const withTimeout = <T>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
  Promise.race([p.catch(() => fallback), new Promise<T>(r => setTimeout(() => r(fallback), ms))])

/**
 * Returns the cheapest Worker model from the current model's provider.
 * Workers are used for repetitive lightweight tasks such as document summarization.
 */
export function getWorkerModelId(currentModelId: string): { modelId: string; provider: ProviderId } {
  const provider: ProviderId = getProviderForModel(currentModelId) ?? 'anthropic'
  return { modelId: WORKER_MODEL_IDS[provider] ?? currentModelId, provider }
}

/**
 * Summarizes a single document from the query's perspective using a Worker LLM.
 * Falls back to the first 300 chars of the body on API error or missing key.
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
  const { citationMode } = useSettingsStore.getState()
  const sysPrompt = citationMode
    ? 'Quote up to 3 sentences from the document that are directly related to the question, verbatim. Output only the quotes. If none found, respond only with "No relevant content found".'
    : 'Summarize the document from the question\'s perspective in 200 characters or less. Output only the summary.'
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
  } catch (err) {
    logger.warn(`[Worker] agentSummarizeDoc failed (${doc.filename}):`, err instanceof Error ? err.message : String(err))
    result = ''
  }
  return result.trim() || body.slice(0, 300)
}

/**
 * Main agent directly reviews vault context and determines if web search is needed.
 * Since the main model (not a Worker) makes the decision, it accurately assesses the
 * relationship between internal materials and the question.
 *
 * Response format: "NO" or "YES: <search query>"
 * max_tokens is limited short to minimize cost (only receiving a decision, answer is a separate call)
 */
async function mainAgentWebSearch(
  query: string,
  ragContext: string,
  modelId: string,
  provider: string,
  apiKey: string,
): Promise<string> {
  try {
    const decisionSys =
      'Review the question and vault materials to determine if web search is needed.\n' +
      'If internal project documents can sufficiently answer, respond NO.\n' +
      'If latest industry trends, official announcements, or external technical info is needed, respond YES.\n' +
      'Format: "NO" or "YES: <search query (10 words or less)>"'

    // Summarize only the beginning of vault materials to reduce decision cost
    const ctxPreview = ragContext
      ? `\nVault materials (beginning):\n${ragContext.slice(0, 600)}`
      : '\nVault materials: none'
    const decisionMsg = `Question: ${query}${ctxPreview}\n\nWeb search needed:`

    let decision = ''
    const { streamCompletion } = await importProvider(provider)
    await streamCompletion(
      apiKey, modelId, decisionSys,
      [{ role: 'user' as const, content: sanitize(decisionMsg) }],
      (c: string) => { decision += c },
    )

    const trimmed = decision.trim()
    if (!trimmed.toUpperCase().startsWith('YES')) return ''

    const colonIdx = trimmed.indexOf(':')
    const rawQuery = colonIdx >= 0 ? trimmed.slice(colonIdx + 1).trim() : query
    // Sanitize and limit search query length to prevent injection/abuse
    const searchQuery = rawQuery.replace(/[^\w\s\-'.,:]/g, '').slice(0, 150).trim() || query.slice(0, 150)

    const { searchWeb, buildWebContext } = await import('@/lib/webSearch')
    const results = await searchWeb(searchQuery, 5)
    logger.debug(`[webSearch] main agent decision: "${searchQuery}" → ${results.length} results`)
    return buildWebContext(results, 2000)
  } catch {
    return ''
  }
}

/**
 * Summarizes recent conversation using LLM.
 * Called from ChatPanel's "Save Summary" button → saved via memoryStore.appendToMemory().
 */
export async function summarizeConversation(
  messages: ChatMessage[],
  onChunk: (chunk: string) => void,
): Promise<void> {
  const { personaModels } = useSettingsStore.getState()
  const mainModelId = personaModels['chief_director']
  const { modelId, provider } = getWorkerModelId(mainModelId)
  const apiKey = getApiKey(provider)
  if (!apiKey) return

  const histText = messages
    .slice(-20)
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => `${m.role === 'user' ? '👤' : '🤖'} ${m.content.slice(0, 300)}`)
    .join('\n')
  const sysPrompt = 'Summarize the conversation in 500 characters or less, focusing on key decisions/insights/agreed-upon items.'
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
  currentSpeaker?: string,
  maxDocChars = 20000,
  skipWorkers = false,
  onThinkingChunk?: (chunk: string) => void,
): Promise<string> {
  // Wait if another caller is swapping loadedDocuments for multi-vault search
  if (_multiVaultSwapActive && !skipWorkers) {
    await _multiVaultSearchLock
  }
  try {
    // ── Full exploration intent: hub-node-based full graph traversal ──────────
    // Skip keyword search and directly collect broad context via hub-centric BFS
    if (GLOBAL_INTENT_RE.test(userMessage)) {
      useGraphStore.getState().setAiHighlightNodes(getGlobalContextDocIds(35, 4))
      return await buildGlobalGraphContext(35, 4)
    }

    // ── Shared docMap: reused across this function — prevents duplicate Map creation ──
    const vaultDocs = useVaultStore.getState().loadedDocuments
    const docMap = new Map(vaultDocs?.map(d => [d.id, d]) ?? [])
    const now = Date.now()
    const sc = useSettingsStore.getState().searchConfig

    // ── Small vault full injection mode ────────────────────────────────────────
    // If total vault rawContent is below fullVaultThreshold, inject everything without RAG.
    // Same approach as Claude Cowork — LLM directly references all docs without search failures.
    if (sc.fullVaultThreshold > 0 && vaultDocs?.length) {
      const totalChars = vaultDocs.reduce((sum, d) => sum + (d.rawContent?.length ?? 0), 0)
      if (totalChars <= sc.fullVaultThreshold) {
        logger.debug(`[RAG] small vault full injection: ${vaultDocs.length} docs, ${totalChars} chars`)
        useGraphStore.getState().setAiHighlightNodes(vaultDocs.map(d => d.id))
        const fullCtx = vaultDocs
          .map(d => {
            const tagLine = d.tags?.length ? ` [tags: ${d.tags.join(', ')}]` : ''
            const dateLine = d.date ? ` [date: ${d.date}]` : ''
            const header = `## [doc] ${d.filename.replace(/\.md$/i, '')}${tagLine}${dateLine}\n`
            return header + getStrippedBody(d)
          })
          .join('\n\n---\n\n')
        return fullCtx
      }
    }

    // ── Stage 1: Direct string search (tried first) ─────────────────────────────
    const _today = new Date()
    const _dateTokens = [
      String(_today.getFullYear()),
      String(_today.getMonth() + 1).padStart(2, '0'),
      String(_today.getDate()).padStart(2, '0'),
    ]

    // Recency intent detection — Stage 1 recency strategy decision
    const isRecencyQueryS1 = RECENCY_INTENT_RE.test(userMessage)

    // Date tokens are only added for recency intent queries.
    // Adding "2026", "03" etc. to normal queries causes date-named docs to receive
    // high filename scores, pushing actually relevant docs (body matches) out of top seeds.
    const searchQuery = isRecencyQueryS1 ? userMessage + ' ' + _dateTokens.join(' ') : userMessage

    const directHitsCandidates = directVaultSearch(
      searchQuery,
      isRecencyQueryS1 ? sc.directCandidatesRecency : sc.directCandidatesNormal
    )

    {
      const HALF_LIFE_MS = sc.recencyHalfLifeDays * 24 * 60 * 60 * 1000
      const RECENCY_COEFF = isRecencyQueryS1 ? sc.recencyCoeffHot : sc.recencyCoeffNormal
      const recBoost = (docId: string) => {
        const d = docMap.get(docId)
        if (!d) return 0
        const ms = (d.date ? Date.parse(d.date) : NaN) || (d.mtime ?? NaN)
        if (isNaN(ms) || ms <= 0 || ms > now) return 0
        return RECENCY_COEFF * Math.exp(-(now - ms) / HALF_LIFE_MS)
      }
      directHitsCandidates.sort((a, b) => (b.score + recBoost(b.doc_id)) - (a.score + recBoost(a.doc_id)))
    }
    const directHits = directHitsCandidates.slice(0, sc.directHitSeeds)

    const hasStrongDirectHit = directHits.some(r => r.score >= sc.minDirectHitScore)

    // ── Strong filename match (score >= 0.4): direct full body injection + BFS related doc supplement ──
    // score >= 0.4 = raw >= 4 = 2+ query words matched in filename
    // score >= 0.2 single match (generic words like "meeting", "document") used only as BFS seed to prevent false positives
    const strongPinnedHits = directHits.filter(r => r.score >= sc.minPinnedScore)
    if (strongPinnedHits.length > 0) {
      const { multiAgentRAG, personaModels } = useSettingsStore.getState()

      // Top-1: chief directly reads full body (limited by maxDocChars)
      const topDoc = docMap.get(strongPinnedHits[0].doc_id)
      const pinnedParts: string[] = ['## Directly matched documents (full content)\n']
      let hasPinnedContent = false
      // Track only doc IDs actually included in pinnedParts (failed worker docs fall back to BFS)
      const includedDocIds = new Set<string>()
      const MIN_PINNED_BODY = 100  // threshold to block stub documents (frontmatter-only docs)
      if (topDoc) {
        const body = getStrippedBody(topDoc)
        if (body.trim().length >= MIN_PINNED_BODY) {
          const truncated = body.length > maxDocChars ? body.slice(0, maxDocChars).trimEnd() + '…' : body
          pinnedParts.push(`[doc] ${topDoc.filename.replace(/\.md$/i, '')}\n${truncated}\n\n`)
          hasPinnedContent = true
          includedDocIds.add(strongPinnedHits[0].doc_id)
        }
        // else: stub document — not pinned, falls through to BFS seed
      }

      // Docs 2~N processing: strategy branches based on hit count (max 5 for RPM limits)
      const secondaryHits = strongPinnedHits.slice(1, 6)
      if (secondaryHits.length > 0) {
        if (multiAgentRAG && !skipWorkers && secondaryHits.length >= 3) {
          // 3+: Worker LLM parallel summaries (200 char compression, max 5)
          const currentModelId = personaModels[currentSpeaker as DirectorId] ?? personaModels['chief_director']
          const { modelId: workerModelId, provider: workerProvider } = getWorkerModelId(currentModelId)
          const workerApiKey = getApiKey(workerProvider)
          if (workerApiKey) {
            onThinkingChunk?.(`📚 **Processing ${secondaryHits.length} Worker agents in parallel...**\n\n`)

            const workerResults = await Promise.all(
              secondaryHits.map(hit => {
                const doc = docMap.get(hit.doc_id)
                return doc
                  ? agentSummarizeDoc(doc, userMessage, workerApiKey, workerProvider, workerModelId)
                      .then(s => ({ doc, summary: s }))
                      .catch(() => null)
                  : Promise.resolve(null)
              })
            )

            const validResults = workerResults.filter((r): r is { doc: LoadedDocument; summary: string } => r !== null && Boolean(r.summary))
            validResults.forEach(r => includedDocIds.add(r.doc.id))

            if (validResults.length > 0) {
              const summarySection = validResults
                .map(({ doc, summary }) => `[Worker summary] ${doc.filename.replace(/\.md$/i, '')}\n${summary}\n`)
                .join('\n')
              pinnedParts.push('\n## Related document summaries (Worker)\n' + summarySection)
              hasPinnedContent = true

              // ── 2-team sub-agent synthesis ────────────────────────────────────────
              const narrativeSummaries: string[] = []
              const systemSummaries: string[] = []
              for (const { doc, summary } of validResults) {
                const domain = classifyDocDomain(doc)
                const entry = `[${doc.filename.replace(/\.md$/i, '')}]\n${summary}`
                if (domain === 'narrative') narrativeSummaries.push(entry)
                else systemSummaries.push(entry)
              }

              let subAgentSection = ''

              // Sub-agent synthesis — 8 second timeout (reusing module-level withTimeout)
              if (narrativeSummaries.length >= 1) {
                onThinkingChunk?.('\n\n**[Sub-agent A — Narrative/Character perspective]**\n')
                const synthesis = await withTimeout(
                  agentSynthesizeDomain(narrativeSummaries, userMessage, 'narrative', workerApiKey, workerProvider, workerModelId, onThinkingChunk),
                  8000, '',
                )
                if (synthesis) subAgentSection += `\n### Narrative/Character perspective\n${synthesis}`
              }

              if (systemSummaries.length >= 1) {
                onThinkingChunk?.('\n\n**[Sub-agent B — System/Gameplay perspective]**\n')
                const synthesis = await withTimeout(
                  agentSynthesizeDomain(systemSummaries, userMessage, 'system', workerApiKey, workerProvider, workerModelId, onThinkingChunk),
                  8000, '',
                )
                if (synthesis) subAgentSection += `\n### System/Gameplay perspective\n${synthesis}`
              }

              if (subAgentSection) {
                pinnedParts.push('\n## Sub-agent insights\n' + subAgentSection)
                onThinkingChunk?.('\n\n---\n')
              }
            }
          }
        } else {
          // 2-3: Direct injection of first 1500 chars without Worker
          const directSections = secondaryHits
            .map(hit => {
              const doc = docMap.get(hit.doc_id)
              if (!doc) return ''
              const body = getStrippedBody(doc)
              const content = body.length > 1500 ? body.slice(0, 1500).trimEnd() + '…' : body
              return `[doc] ${doc.filename.replace(/\.md$/i, '')}\n${content}\n`
            })
            .filter(Boolean)
            .join('\n')
          if (directSections) {
            pinnedParts.push('\n## Related documents\n' + directSections)
            hasPinnedContent = true
            secondaryHits.forEach(hit => { if (docMap.has(hit.doc_id)) includedDocIds.add(hit.doc_id) })
          }
        }
      }

      if (hasPinnedContent) {
        const pinnedCtx = pinnedParts.join('')
        // Only exclude actually included docs from BFS seeds (failed worker docs are restored as BFS seeds)
        const bfsSeeds = directHits.filter(r => !includedDocIds.has(r.doc_id))
        const bfsCtx = await buildDeepGraphContext(bfsSeeds, 2, 10, tokenizeQuery(userMessage), currentSpeaker)
        logger.debug(`[RAG] Multi-agent: pinned=${pinnedCtx.length} chars, BFS=${bfsCtx.length} chars`)
        useGraphStore.getState().setAiHighlightNodes(directHits.map(r => r.doc_id))
        return pinnedCtx + (bfsCtx ? '\n' + bfsCtx : '')
      }
    }

    let seeds: import('@/types').SearchResult[]

    if (hasStrongDirectHit) {
      // Direct search results sufficient → use as priority seeds (fallback path)
      seeds = directHits
      logger.debug(`[RAG] direct search priority: ${seeds.map(r => r.filename).join(', ')}`)
    } else {
      // Insufficient direct match → full vector search priority, BM25 supplement
      let candidates: import('@/types').SearchResult[] = []
      let searchMode = 'BM25'

      const geminiKey = getApiKey('gemini')
      if (vectorEmbedIndex.isBuilt && geminiKey) {
        // ── Priority 1: full vector search (pure semantic similarity) ────────
        try {
          const vecResults = await vectorEmbedIndex.fullVectorSearch(
            userMessage, geminiKey, sc.bm25Candidates * 2, vaultDocs ?? [],
          )
          if (vecResults && vecResults.length > 0) {
            candidates = vecResults
            searchMode = 'vector'

            // Supplement with BM25 for keyword matches that vector missed (top half only)
            const bm25Results = frontendKeywordSearch(userMessage, sc.bm25Candidates, currentSpeaker)
            const vecIds = new Set(candidates.map(r => r.doc_id))
            for (const r of bm25Results) {
              if (!vecIds.has(r.doc_id) && r.score > sc.minBm25Score) {
                candidates.push(r)
              }
            }
          }
        } catch (e: unknown) {
          logger.warn('[vector] fullVectorSearch failed, BM25 fallback:', e instanceof Error ? e.message : String(e))
        }
      }

      if (candidates.length === 0) {
        // ── Priority 2: ChromaDB backend ────────────────────────────────────────
        if (typeof window !== 'undefined' && window.backendAPI) {
          try {
            const response = await window.backendAPI.search(userMessage, sc.bm25Candidates)
            candidates = response.results ?? []
            if (candidates.length > 0) searchMode = 'chromadb'
          } catch { /* backend not running */ }
        }
        // ── Priority 3: Frontend BM25 ───────────────────────────────────────────
        if (candidates.length === 0) {
          candidates = frontendKeywordSearch(userMessage, sc.bm25Candidates * 4, currentSpeaker)
        }
      }

      logger.debug(`[RAG] ${searchMode} candidates: ${candidates.length} (query: "${userMessage.slice(0, 40)}")`)

      const relevant = candidates.filter(r => r.score > (searchMode === 'vector' ? 0.1 : sc.minBm25Score))
      seeds = relevant.length > 0 ? rerankResults(relevant, userMessage, sc.rerankSeeds, currentSpeaker) : []

      // Supplement docs missed by direct search
      const seedIds = new Set(seeds.map(r => r.doc_id))
      for (const hit of directHits) {
        if (!seedIds.has(hit.doc_id)) seeds.push(hit)
      }
    }

    // Always include _index.md
    const indexDoc = vaultDocs?.find(d => d.filename.toLowerCase() === '_index.md')
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
        score: 0.15,  // Prevents PPR dominance — included in seeds but doesn't take top score
        tags: indexDoc.tags ?? [],
      })
    }

    // Version dedup: keep only the latest among v2/v3/v4 of the same document
    seeds = deduplicateVersions(seeds, docMap)

    // Recency intent detection: re-sort seeds in reverse date order so newest docs are used in BFS priority traversal
    // _index.md / currentSituation.md always stays at top (contains date info)
    const isRecencyQuery = RECENCY_INTENT_RE.test(userMessage)
    if (isRecencyQuery && seeds.length > 0) {
      const PINNED_HUB = /^(_index|currentSituation|chief[\s_]persona)/i
      const pinned = seeds.filter(r => PINNED_HUB.test(r.filename))
      const rest = seeds.filter(r => !PINNED_HUB.test(r.filename))
      rest.sort((a, b) => {
        const da = docMap.get(a.doc_id), db = docMap.get(b.doc_id)
        const ra = da ? ((da.date ? Date.parse(da.date) : NaN) || da.mtime || 0) : 0
        const rb = db ? ((db.date ? Date.parse(db.date) : NaN) || db.mtime || 0) : 0
        return rb - ra
      })
      seeds = [...pinned, ...rest]
      logger.debug(`[RAG] recency intent detected — seeds re-sorted by date: ${seeds.slice(0, 3).map(r => r.filename).join(', ')}`)
    }

    // Stage 2: BFS graph traversal — collect connected docs up to 3 hops from seeds
    if (seeds.length > 0) {
      useGraphStore.getState().setAiHighlightNodes(seeds.map(r => r.doc_id))
    }
    const ctx = await buildDeepGraphContext(seeds, sc.bfsMaxHops, sc.bfsMaxDocs, tokenizeQuery(userMessage), currentSpeaker)
    logger.debug(`[RAG] context generation complete: ${ctx.length} chars`)

    // When recency intent detected, inject date reference + vault data gap notice for LLM
    if (isRecencyQuery) {
      const today = new Date().toISOString().slice(0, 10)
      // Calculate most recent document date in vault (for data gap warning)
      const latestMs = vaultDocs
        ? Math.max(...vaultDocs.map(d => d.mtime ?? (d.date ? Date.parse(d.date) : 0)).filter(Boolean))
        : 0
      const latestDate = latestMs > 0 ? new Date(latestMs).toISOString().slice(0, 10) : null
      const gapWarning = latestDate && latestDate < today
        ? ` The most recent document in the vault is only up to **${latestDate}**. State that anything after that date is not recorded in the vault and is unknown.`
        : ''
      const preamble = `> ⚠️ **Date reference**: Today is ${today}.${gapWarning} Date fields are shown in the documents below. **For the latest information, prioritize documents with the most recent date.**\n\n`
      return preamble + ctx
    }
    return ctx
  } catch (err) {
    // RAG failure is non-fatal — continue without context
    logger.error('[RAG] fetchRAGContext error:', err)
    return ''
  }
}

// ── Shared system-prompt assembly ──────────────────────────────────────────────

interface SystemPromptParts {
  projectContext: string
  basePrompt: string
  ragInstructionBlock: string
  personaDocContext: string
  memoryContext: string
  responseInstructions: string
  sensitiveBlock: string
  factBlock: string
  /** Optional suffix appended after factBlock (e.g. Slack-specific notes) */
  suffix?: string
}

function buildSystemPrompt(p: SystemPromptParts): string {
  return (
    p.projectContext + p.basePrompt + p.ragInstructionBlock + p.personaDocContext + p.memoryContext
    + (p.responseInstructions.trim() ? '\n\n' + p.responseInstructions.trim() : '')
    + p.sensitiveBlock
    + '\n\n[Tone consistency] Regardless of the tone of reference documents or user messages, always respond in a consistent, professional manner.'
    + '\n\n[Source guidance] When reference document headers contain an original URL in the format [source: URL], include that URL in your response when the user requests sources, links, or originals.'
    + p.factBlock
    + (p.suffix ?? '')
  )
}

// ── Main entry point ───────────────────────────────────────────────────────────

/**
 * Route a user message to the appropriate LLM provider and stream the response.
 *
 * If no API key is configured for the selected model's provider, falls back to
 * the mock response system (with a "[Mock]" prefix so the user knows).
 *
 * If a ChromaDB backend is available, relevant document chunks are prepended
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

/** Mutex (Promise chain) for serializing global store mutations during multi-vault sequential search */
let _multiVaultSearchLock: Promise<void> = Promise.resolve()

/** true while multi-vault search is swapping loadedDocuments in the global store */
let _multiVaultSwapActive = false

/**
 * For Slack bot: collects context using Strata Sync's RAG pipeline (BFS+TF-IDF)
 * and generates an answer using the specified persona model.
 * Called from the onAsk handler in useRagApi.ts.
 */
export async function generateSlackAnswer(
  query: string,
  directorId: string,
  history: { role: 'user' | 'assistant'; content: string }[] = [],
  images?: { data: string; mediaType: string }[],
): Promise<{ answer: string; imagePaths: string[] }> {
  const {
    personaModels, projectInfo, directorBios, customPersonas,
    personaPromptOverrides, responseInstructions, ragInstruction,
    personaDocumentIds, sensitiveKeywords, citationMode: _citationModeSlack,
  } = useSettingsStore.getState()

  // Same as streamMessage: check custom persona first
  const customPersona = customPersonas.find(p => p.id === directorId)
  const modelId = customPersona
    ? customPersona.modelId
    : (personaModels[directorId as DirectorId] ?? personaModels['chief_director'])
  const provider = getProviderForModel(modelId)
  if (!provider) return { answer: '', imagePaths: [] }
  const apiKey = getApiKey(provider)
  if (!apiKey) return { answer: '', imagePaths: [] }

  // ── System prompt assembly (same order as streamMessage) ─────────────────
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
      personaDocContext = `\n\n---\nBelow is persona reference material from the "${doc.filename}" document. Use this content to reference the person's perspective and tone:\n\n${doc.rawContent.slice(0, 4000)}`
    }
  }

  // Long-term memory injection
  const { memoryText } = useMemoryStore.getState()
  const memoryContext = memoryText.trim()
    ? `\n\n---\n## 📌 Previous conversation memory\n${memoryText.trim()}\n---`
    : ''

  const ragInstructionBlock = ragInstruction.trim() ? '\n\n' + ragInstruction.trim() : ''
  const factBlock_slack = _citationModeSlack
    ? '\n\n[Factual compliance] You must follow these guidelines:\n1. Answers must be based solely on documents retrieved from the vault, web search results, or content directly stated by the user.\n2. Never speculate or fabricate facts not explicitly stated in documents. If uncertain, state "This content could not be confirmed in the retrieved documents."\n3. When referencing vault documents, use "retrieved documents" or "vault documents".\n4. When making inferences beyond vault quotes, you must mark the end of the sentence with **(inference)**.'
    : '\n\n[Factual compliance] You must follow these guidelines:\n1. Answers must be based solely on documents retrieved from the vault, web search results, or content directly stated by the user.\n2. Never speculate or fabricate facts not explicitly stated in documents. If uncertain, state "This content could not be confirmed in the retrieved documents."\n3. When referencing vault documents auto-retrieved via RAG, use "retrieved documents" or "vault documents" instead of "documents you provided".'
  // Inject priority processing directive when sensitive keywords match
  const matchedKeywords = sensitiveKeywords
    ? sensitiveKeywords.split(/[\n,]+/).map(k => k.trim()).filter(Boolean)
        .filter(k => query.toLowerCase().includes(k.toLowerCase()))
    : []
  const sensitiveBlock = matchedKeywords.length > 0
    ? `\n\n[Priority topic] This question contains the following key terms: ${matchedKeywords.map(k => `"${k}"`).join(', ')}. Search for information on this topic with the highest priority and answer comprehensively with all relevant details.`
    : ''

  const systemPrompt = buildSystemPrompt({
    projectContext, basePrompt, ragInstructionBlock, personaDocContext, memoryContext,
    responseInstructions, sensitiveBlock, factBlock: factBlock_slack,
    suffix: '\n\n[Slack images] This conversation takes place via a Slack bot. When relevant images are found in the vault, the bot system attaches them automatically. Never use expressions like "I cannot show images" or "I don\'t have image capabilities". For image requests, describe the relevant content in text and inform that images are automatically handled by the system.',
  })

  // ── RAG context → inject before user message (Slack: skip workers, keep BFS) ──
  // Skip RAG for short greetings/exclamations (prevents irrelevant project context injection)
  const isSmallTalk = /^(안녕|ㅎㅇ|hi|hello|hey|반가워|고마워|감사합니다|감사해|수고|고생|화이팅|파이팅|ㅋ+|ㄱ+|ㅇㅇ|ㅇㅋ|오케|굿|좋아|ㅇㄱ|ㄴㄴ|ㅠ+|ㅜ+)\s*[~!?♡]*$/i.test(query.trim())

  // Slack: per-vault parallel search then context merge (reuse TF-IDF cache, insert [source: vault name] headers)
  let _ragRaw = ''
  if (!isSmallTalk) {
    const { vaultDocsCache, loadedDocuments: _activeDocs, vaults } = useVaultStore.getState()
    // Prevent vaultDocsCache contamination: use setState directly instead of setLoadedDocuments (no cache write-back)
    const _setDocs = (docs: typeof _activeDocs) => useVaultStore.setState({ loadedDocuments: docs })
    const vaultEntries = Object.entries(vaultDocsCache)
    if (vaultEntries.length <= 1) {
      // Single vault → existing method
      _ragRaw = await fetchRAGContext(query, directorId, 8000, true)
    } else {
      // Multiple vaults → sequential per-vault search then merge (reuse each vault's TF-IDF cache)
      // Mutex: serialize so concurrent Slack messages don't interleave store mutations
      // Promise chain approach — FIFO order guarantee without busy-wait
      let releaseLock!: () => void
      const prevLock = _multiVaultSearchLock
      _multiVaultSearchLock = new Promise<void>(r => { releaseLock = r })
      await prevLock

      const perVaultLimit = Math.floor(6000 / vaultEntries.length)
      const parts: string[] = []
      _multiVaultSwapActive = true
      try {
        for (const [vaultId, docs] of vaultEntries) {
          const label = vaults[vaultId]?.label ?? vaultId
          _setDocs(docs)
          const ctx = await fetchRAGContext(query, directorId, perVaultLimit, true)
          if (ctx.trim()) parts.push(`\n# [source: ${label}]\n${ctx}`)
        }
      } finally {
        _setDocs(_activeDocs)  // always restore to active vault, even on exception
        _multiVaultSwapActive = false
        releaseLock()
      }
      _ragRaw = parts.join('\n')
    }
  }

  // In small vault full injection mode, allow up to fullVaultThreshold; normal RAG caps at 10K (30K TPM limit handling)
  const _fvt = useSettingsStore.getState().searchConfig.fullVaultThreshold
  const _isFullVault = _fvt > 0 && _ragRaw.length > 0 && _ragRaw.length <= _fvt
  const _ragCap = _isFullVault ? _fvt : 10000
  const ragContext = _ragRaw.length > _ragCap ? _ragRaw.slice(0, _ragCap).trimEnd() + '\n…(context truncated)' : _ragRaw

  // Web search (main agent autonomous decision, only when enabled in settings)
  const { webSearch: _webSearchEnabled } = useSettingsStore.getState()
  let webCtx = ''
  if (_webSearchEnabled && typeof window !== 'undefined' && (window as any).webSearchAPI) {
    webCtx = await mainAgentWebSearch(query, ragContext, modelId, provider, apiKey)
  }

  const combinedCtx = [ragContext, webCtx].filter(Boolean).join('\n')
  let fullUserMessage = query
  if (combinedCtx) {
    const srcLabel = ragContext && webCtx
      ? 'vault WikiLink graph and web search'
      : ragContext ? 'vault WikiLink graph' : 'web search'
    fullUserMessage = `${combinedCtx}The above materials were collected via ${srcLabel}.\nPlease reference these materials when answering to provide insights and specific feedback.\n\n---\n\n${query}`
  }

  // Previous conversation history (Slack: max 6 messages = 3 turns, TPM savings)
  const historyMessages = history.slice(-6)
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({
      role: m.role as 'user' | 'assistant',
      content: sanitize(m.content),
    }))

  // Convert to Attachment array when images are attached (common format used by providers)
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

  // Collect related image paths from top RAG result documents (for automatic vault image attachment)
  const { imagePathRegistry, loadedDocuments: allDocs } = useVaultStore.getState()
  const imagePaths: string[] = []
  if (imagePathRegistry && allDocs) {
    const docMap = new Map(allDocs.map(d => [d.id, d]))
    const _imgToday = new Date()
    const _imgDateQ = query + ' ' + _imgToday.getFullYear() + ' ' + String(_imgToday.getMonth() + 1).padStart(2, '0') + ' ' + String(_imgToday.getDate()).padStart(2, '0')
    const topHits = directVaultSearch(_imgDateQ, 5)
    const seen = new Set<string>()

    // Priority 1: imageRefs from matched documents (markdown embed images)
    for (const hit of topHits) {
      const doc = docMap.get(hit.doc_id)
      if (!doc?.imageRefs?.length) continue
      for (const ref of doc.imageRefs) {
        const basename = ref.split(/[/\\]/).pop() ?? ref
        const entry = imagePathRegistry[ref] ?? imagePathRegistry[basename]
        if (entry?.absolutePath && !seen.has(entry.absolutePath)) {
          seen.add(entry.absolutePath)
          imagePaths.push(entry.absolutePath)
          if (imagePaths.length >= 3) break
        }
      }
      if (imagePaths.length >= 3) break
    }

    // Priority 2: match query words in imageRegistry filenames (when only standalone image files exist without embeds)
    if (imagePaths.length < 3) {
      const qWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 1)
      for (const [name, entry] of Object.entries(imagePathRegistry)) {
        const n = name.toLowerCase()
        if (qWords.some(w => n.includes(w)) && !seen.has(entry.absolutePath)) {
          seen.add(entry.absolutePath)
          imagePaths.push(entry.absolutePath)
          if (imagePaths.length >= 3) break
        }
      }
    }
  }

  return { answer, imagePaths }
}

export async function streamMessage(
  persona: SpeakerId,
  userMessage: string,
  history: ChatMessage[],
  onChunk: (chunk: string) => void,
  attachments?: Attachment[],
  overrideRagContext?: string,   // bypass keyword search — used for node selection AI analysis etc.
  onThinkingChunk?: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const { personaModels, projectInfo, directorBios, customPersonas, personaPromptOverrides, responseInstructions, ragInstruction, personaDocumentIds, sensitiveKeywords, webSearch: webSearchEnabled, citationMode } = useSettingsStore.getState()

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

  const model = MODEL_OPTIONS.find((m) => m.id === modelId)
  if (!model) { logger.error(`[LLM] unknown model ID: ${modelId}`); onChunk('Model config error: unknown model.'); return }

  // Resolve system prompt: custom persona > built-in override > built-in default
  const basePrompt = customPersona
    ? customPersona.systemPrompt
    : (personaPromptOverrides[persona] ?? PERSONA_PROMPTS[persona as DirectorId] ?? '')

  // Director bio only applies to built-in personas
  const directorBio = customPersona ? undefined : directorBios[persona as DirectorId]
  const projectContext = buildProjectContext(projectInfo, directorBio)

  // ── Persona document injection ──────────────────────────────────────────────
  // If a vault document is linked to this persona in settings, inject into system prompt
  const personaDocId = personaDocumentIds[persona]
  let personaDocContext = ''
  if (personaDocId) {
    const doc = useVaultStore.getState().loadedDocuments?.find(d => d.id === personaDocId)
    if (doc) {
      personaDocContext = `\n\n---\nBelow is persona reference material from the "${doc.filename}" document. Use this content to reference the person's perspective and tone:\n\n${doc.rawContent.slice(0, 4000)}`
    }
  }

  // ── AI long-term memory injection ────────────────────────────────────────────
  const { memoryText } = useMemoryStore.getState()
  const memoryContext = memoryText.trim()
    ? `\n\n---\n## 📌 Previous conversation memory\n${memoryText.trim()}\n---`
    : ''

  // ── Graph-Augmented RAG context injection ──────────────────────────────────
  // If overrideRagContext is provided, use as-is without keyword search (e.g., direct node selection analysis)
  const ragContext = overrideRagContext !== undefined
    ? overrideRagContext
    : await fetchRAGContext(userMessage, persona, 20000, false, onThinkingChunk)

  // ── Web search (main agent autonomous decision — normal chat, only when enabled) ──
  let webCtx = ''
  if (overrideRagContext === undefined && webSearchEnabled && typeof window !== 'undefined' && (window as any).webSearchAPI) {
    webCtx = await mainAgentWebSearch(userMessage, ragContext, modelId, provider, apiKey)
  }

  const ragInstructionBlock = ragInstruction.trim() ? '\n\n' + ragInstruction.trim() : ''
  const factBlock = citationMode
    ? '\n\n[Factual compliance] You must follow these guidelines:\n1. Answers must be based solely on documents retrieved from the vault, web search results, or content directly stated by the user.\n2. Never speculate or fabricate facts not explicitly stated in documents. If uncertain, state "This content could not be confirmed in the retrieved documents."\n3. When referencing vault documents, use "retrieved documents" or "vault documents".\n4. When making inferences beyond vault quotes, you must mark the end of the sentence with **(inference)**.'
    : '\n\n[Factual compliance] You must follow these guidelines:\n1. Answers must be based solely on documents retrieved from the vault, web search results, or content directly stated by the user.\n2. Never speculate or fabricate facts not explicitly stated in documents. If uncertain, state "This content could not be confirmed in the retrieved documents."\n3. When referencing vault documents auto-retrieved via RAG, use "retrieved documents" or "vault documents" instead of "documents you provided".'
  // Inject priority processing directive when sensitive keywords match
  const _matchedKw = sensitiveKeywords
    ? sensitiveKeywords.split(/[\n,]+/).map(k => k.trim()).filter(Boolean)
        .filter(k => userMessage.toLowerCase().includes(k.toLowerCase()))
    : []
  const _sensitiveBlock = _matchedKw.length > 0
    ? `\n\n[Priority topic] This question contains the following key terms: ${_matchedKw.map(k => `"${k}"`).join(', ')}. Search for information on this topic with the highest priority and answer comprehensively with all relevant details.`
    : ''

  const systemPrompt = buildSystemPrompt({
    projectContext, basePrompt, ragInstructionBlock, personaDocContext, memoryContext,
    responseInstructions, sensitiveBlock: _sensitiveBlock, factBlock,
  })

  // ── Attachment processing ───────────────────────────────────────────────────
  // Separate image attachments (→ vision API) from text attachments (→ message injection)
  const imageAttachments = attachments?.filter(a => a.type === 'image') ?? []
  const textAttachments  = attachments?.filter(a => a.type === 'text')  ?? []

  // Append text file content to user message
  let fullUserMessage = userMessage
  if (textAttachments.length > 0) {
    const TEXT_ATTACH_MAX = 8000  // max chars per attachment (~2K tokens)
    const textContext = textAttachments
      .map(a => {
        const content = a.dataUrl.length > TEXT_ATTACH_MAX
          ? a.dataUrl.slice(0, TEXT_ATTACH_MAX) + '\n…(content truncated)'
          : a.dataUrl
        return `\n\n[Attached file: ${a.name}]\n${content}`
      })
      .join('')
    fullUserMessage = userMessage + textContext
  }

  // Inject RAG context + web search results before user message
  const combinedCtx = [ragContext, webCtx].filter(Boolean).join('\n')
  if (combinedCtx) {
    const srcLabel = ragContext && webCtx
      ? 'vault WikiLink graph and web search'
      : ragContext ? 'vault WikiLink graph' : 'web search'
    fullUserMessage = `${combinedCtx}The above materials were collected via ${srcLabel}.\nPlease reference these materials when answering to provide insights and specific feedback.\n\n---\n\n${fullUserMessage}`
  }

  // Build message history, excluding the current user message
  let historyMessages = toHistoryMessages(
    history.filter((m) => m.content !== userMessage || m.role !== 'user')
  )

  // ── Context compaction: when history is too long, summarize old conversations and inject into system prompt ──
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
          finalSystemPrompt += `\n\n## Previous conversation summary (auto-compaction)\n${compactSummary.trim()}`
          historyMessages = recentMessages
          // Also auto-save compaction summary to AI long-term memory
          const timestamp = new Date().toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
          useMemoryStore.getState().appendToMemory(`[${timestamp} auto summary]\n${compactSummary.trim()}`)
          logger.debug(`[compaction] ${histChars} chars → latest 8 messages + summary injection + memory save`)
        }
      }
    } catch (e) {
      logger.warn('[compaction] failed — using full history:', e)
    }
  }

  const cleanSystemPrompt = sanitize(finalSystemPrompt)
  const allMessages = [
    ...historyMessages,
    { role: 'user' as const, content: sanitize(fullUserMessage) },
  ]

  // Record token usage into the session usage store
  const onUsage = (inputTokens: number, outputTokens: number) => {
    useUsageStore.getState().recordUsage(modelId, inputTokens, outputTokens, 'chat')
  }

  // Dynamically import the provider module to keep bundle splitting clean
  switch (model.provider) {
    case 'anthropic': {
      const { streamCompletion } = await import('./providers/anthropic')
      await streamCompletion(apiKey, modelId, cleanSystemPrompt, allMessages, onChunk, imageAttachments, onUsage, signal)
      break
    }
    case 'openai': {
      const { streamCompletion } = await import('./providers/openai')
      await streamCompletion(apiKey, modelId, cleanSystemPrompt, allMessages, onChunk, imageAttachments, onUsage, signal)
      break
    }
    case 'gemini': {
      const { streamCompletion } = await import('./providers/gemini')
      await streamCompletion(apiKey, modelId, cleanSystemPrompt, allMessages, onChunk, imageAttachments, onUsage, signal)
      break
    }
    case 'grok': {
      const { streamCompletion } = await import('./providers/grok')
      // Grok does not support vision — notify user if images were attached
      if (imageAttachments.length > 0) {
        onChunk('[Grok does not support image analysis. Only text will be processed.]\n\n')
      }
      await streamCompletion(apiKey, modelId, cleanSystemPrompt, allMessages, onChunk, [], onUsage, signal)
      break
    }
    default: {
      await streamMockResponse(persona, userMessage, onChunk)
    }
  }

  // Clear chat RAG highlight (GraphPanel analysis is self-managed)
  if (overrideRagContext === undefined) {
    useGraphStore.getState().setAiHighlightNodes([])
  }
}

// ── Raw LLM stream (Edit Agent용) ─────────────────────────────────────────────

/**
 * Bare-metal LLM call without RAG/persona overhead.
 * Used by the Edit Agent runner for file refinement tasks.
 *
 * Automatically records token usage to usageStore.
 *
 * @param modelId      Full model ID (e.g. 'claude-sonnet-4-6')
 * @param systemPrompt System prompt string
 * @param messages     Message history
 * @param onChunk      Streaming text callback
 */
export async function streamMessageRaw(
  modelId: string,
  systemPrompt: string,
  messages: { role: 'user' | 'assistant'; content: string }[],
  onChunk: (chunk: string) => void,
): Promise<void> {
  const provider = getProviderForModel(modelId)
  if (!provider) throw new Error(`[streamMessageRaw] Unknown model: ${modelId}`)
  const apiKey = getApiKey(provider)
  if (!apiKey) throw new Error(`[streamMessageRaw] No API key for provider: ${provider}`)

  const onUsage = (inputTokens: number, outputTokens: number) => {
    useUsageStore.getState().recordUsage(modelId, inputTokens, outputTokens, 'editAgent')
  }

  const sanitizedMessages = messages.map(m => ({ role: m.role, content: sanitize(m.content) }))
  const cleanSys = sanitize(systemPrompt)

  // Cast to a generic signature to avoid provider union type intersection issues
  type RawStream = (
    apiKey: string, model: string, sys: string,
    messages: { role: 'user' | 'assistant'; content: string }[],
    onChunk: (chunk: string) => void,
    imageAttachments?: Attachment[],
    onUsage?: (inputTokens: number, outputTokens: number) => void,
  ) => Promise<void>
  const { streamCompletion } = await importProvider(provider)
  await (streamCompletion as RawStream)(apiKey, modelId, cleanSys, sanitizedMessages, onChunk, [], onUsage)
}

// ── Tool-enabled chat (Chat Agent + Edit Agent tools) ─────────────────────────

/**
 * Like streamMessage but runs an Anthropic tool-use agentic loop when tools are provided.
 * For non-Anthropic providers falls back to plain streamMessage (no tools).
 *
 * tools / executeTool are passed from the caller (chatStore) to avoid
 * a circular dependency with editAgentRunner.
 */
export async function streamMessageWithTools(
  persona: SpeakerId,
  userMessage: string,
  history: ChatMessage[],
  onChunk: (chunk: string) => void,
  onToolCall: (name: string, input: unknown, result: string) => void,
  tools: AnthropicTool[],
  executeTool: AgentLoopOpts['executeTool'],
  attachments?: Attachment[],
  overrideRagContext?: string,
  onThinkingChunk?: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const {
    personaModels, projectInfo, directorBios, customPersonas,
    personaPromptOverrides, responseInstructions, ragInstruction,
    personaDocumentIds, sensitiveKeywords, webSearch: webSearchEnabled, citationMode,
  } = useSettingsStore.getState()

  const customPersona = customPersonas.find(p => p.id === persona)
  const modelId = customPersona
    ? customPersona.modelId
    : personaModels[persona as DirectorId]
  const provider = getProviderForModel(modelId)

  if (!provider) {
    await streamMockResponse(persona, userMessage, onChunk)
    return
  }

  const apiKey = getApiKey(provider)
  if (!apiKey) {
    await streamMockResponse(persona, userMessage, onChunk)
    return
  }

  // Non-Anthropic: tools not supported — fall back to regular streaming
  if (provider !== 'anthropic') {
    await streamMessage(persona, userMessage, history, onChunk, attachments, overrideRagContext, onThinkingChunk, signal)
    return
  }

  // ── Build system prompt (identical logic to streamMessage) ──────────────────
  const basePrompt = customPersona
    ? customPersona.systemPrompt
    : (personaPromptOverrides[persona] ?? PERSONA_PROMPTS[persona as DirectorId] ?? '')

  const directorBio = customPersona ? undefined : directorBios[persona as DirectorId]
  const projectContext = buildProjectContext(projectInfo, directorBio)

  const personaDocId = personaDocumentIds[persona]
  let personaDocContext = ''
  if (personaDocId) {
    const doc = useVaultStore.getState().loadedDocuments?.find(d => d.id === personaDocId)
    if (doc) {
      personaDocContext = `\n\n---\nBelow is persona reference material from the "${doc.filename}" document. Use this content to reference the person's perspective and tone:\n\n${doc.rawContent.slice(0, 4000)}`
    }
  }

  const { memoryText } = useMemoryStore.getState()
  const memoryContext = memoryText.trim()
    ? `\n\n---\n## 📌 Previous conversation memory\n${memoryText.trim()}\n---`
    : ''

  const ragContext = overrideRagContext !== undefined
    ? overrideRagContext
    : await fetchRAGContext(userMessage, persona, 20000, false, onThinkingChunk)

  let webCtx = ''
  if (overrideRagContext === undefined && webSearchEnabled && typeof window !== 'undefined' && (window as any).webSearchAPI) {
    webCtx = await mainAgentWebSearch(userMessage, ragContext, modelId, provider, apiKey)
  }

  const ragInstructionBlock = ragInstruction.trim() ? '\n\n' + ragInstruction.trim() : ''
  const factBlock = citationMode
    ? '\n\n[Factual compliance] You must follow these guidelines:\n1. Answers must be based solely on documents retrieved from the vault, web search results, or content directly stated by the user.\n2. Never speculate or fabricate facts not explicitly stated in documents. If uncertain, state "This content could not be confirmed in the retrieved documents."\n3. When referencing vault documents, use "retrieved documents" or "vault documents".\n4. When making inferences beyond vault quotes, you must mark the end of the sentence with **(inference)**.'
    : '\n\n[Factual compliance] You must follow these guidelines:\n1. Answers must be based solely on documents retrieved from the vault, web search results, or content directly stated by the user.\n2. Never speculate or fabricate facts not explicitly stated in documents. If uncertain, state "This content could not be confirmed in the retrieved documents."\n3. When referencing vault documents auto-retrieved via RAG, use "retrieved documents" or "vault documents" instead of "documents you provided".'

  const _matchedKw = sensitiveKeywords
    ? sensitiveKeywords.split(/[\n,]+/).map(k => k.trim()).filter(Boolean)
        .filter(k => userMessage.toLowerCase().includes(k.toLowerCase()))
    : []
  const _sensitiveBlock = _matchedKw.length > 0
    ? `\n\n[Priority topic] This question contains the following key terms: ${_matchedKw.map(k => `"${k}"`).join(', ')}. Search for information on this topic with the highest priority and answer comprehensively with all relevant details.`
    : ''

  const { vaultPath } = useVaultStore.getState()

  // Tool capability notice in system prompt — include vault path so LLM uses correct absolute paths
  const vaultPathHint = vaultPath
    ? `\nVault path: ${vaultPath} — file tool paths must be absolute paths starting with this path. Example: ${vaultPath}/active/filename.md`
    : ''
  const toolNotice = `\n\n[Tools available] You can directly use vault tools for file read/write, Jira issue management, Confluence page creation/editing, etc. When users request document creation, issue filing, or file modification, actively utilize tools.${vaultPathHint}`

  const systemPrompt = buildSystemPrompt({
    projectContext, basePrompt, ragInstructionBlock, personaDocContext, memoryContext,
    responseInstructions, sensitiveBlock: _sensitiveBlock, factBlock, suffix: toolNotice,
  })

  // ── Build message context with RAG ─────────────────────────────────────────
  let fullUserMessage = userMessage

  const textAttachments = attachments?.filter(a => a.type === 'text') ?? []
  if (textAttachments.length > 0) {
    const TEXT_ATTACH_MAX = 12000
    const textContext = textAttachments
      .map(a => {
        const content = a.dataUrl.length > TEXT_ATTACH_MAX
          ? a.dataUrl.slice(0, TEXT_ATTACH_MAX) + '\n…(content truncated)'
          : a.dataUrl
        return `\n\n[Attached file: ${a.name}]\n${content}`
      })
      .join('')
    fullUserMessage = userMessage + textContext
  }

  const combinedCtx = [ragContext, webCtx].filter(Boolean).join('\n')
  if (combinedCtx) {
    const srcLabel = ragContext && webCtx
      ? 'vault WikiLink graph and web search'
      : ragContext ? 'vault WikiLink graph' : 'web search'
    fullUserMessage = `${combinedCtx}The above materials were collected via ${srcLabel}.\nPlease reference these materials when answering to provide insights and specific feedback.\n\n---\n\n${fullUserMessage}`
  }

  const historyMessages: AgentMsg[] = toHistoryMessages(
    history.filter((m) => m.content !== userMessage || m.role !== 'user')
  ).map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }) as AgentMsg)

  await runAgentLoop({
    systemPrompt: sanitize(systemPrompt),
    messages: [...historyMessages, { role: 'user' as const, content: sanitize(fullUserMessage) }],
    tools,
    executeTool,
    modelId,
    apiKey,
    vaultPath: vaultPath ?? '',
    usageCategory: 'chat',
    onChunk,
    onToolCall,
    signal,
  })

  if (overrideRagContext === undefined) {
    useGraphStore.getState().setAiHighlightNodes([])
  }
}
