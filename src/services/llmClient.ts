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

// ── Obsidian MD conversion (MD 변환 에디터 파이프라인) ─────────────────────────

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
    '당신은 게임 개발 스튜디오의 지식 관리 전문가입니다. ' +
    '원문 텍스트를 분석하고 Obsidian 마크다운 형식으로 구조화합니다.'

  const userMessage =
    `다음 텍스트를 Obsidian 마크다운으로 변환해주세요.\n\n` +
    `반드시 아래 형식을 정확히 따르세요:\n` +
    `1. 첫 줄: KEYWORDS: 키워드1, 키워드2, 키워드3 (핵심 키워드 5~10개, 쉼표 구분)\n` +
    `2. 빈 줄\n` +
    `3. 구분선: ---\n` +
    `4. Obsidian frontmatter:\n` +
    `---\n` +
    `speaker: ${meta.speaker}\n` +
    `date: ${meta.date}\n` +
    `tags: [${meta.type}, 키워드1, 키워드2]\n` +
    `type: ${meta.type}\n` +
    `---\n` +
    `5. ## ${meta.title}\n` +
    `6. 각 핵심 키워드를 ## 소제목으로 사용하여 관련 내용 정리\n\n` +
    `제목: ${meta.title}\n유형: ${meta.type}\n\n원문:\n${rawContent}`

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
 * 프로바이더 모듈을 동적 import합니다.
 * 템플릿 리터럴 대신 switch로 분기하여 Vite 번들러가 청크를 정적 분석할 수 있도록 합니다.
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
 * 전체 탐색 인텐트를 감지하는 패턴.
 * 이 패턴이 매칭되면 허브 노드 기반 전체 그래프 탐색으로 전환.
 */
const GLOBAL_INTENT_RE = /(?:^|\s)(전체적인|전반적|총체적|프로젝트\s*전체|전체\s*인사이트|전체\s*피드백|모든\s*문서|big.?picture|overview)(?:\s|[?.!,]|$)|^전체\s*$|^전반\s*$/i

/**
 * 최신 정보 요청 인텐트 패턴.
 * 매칭 시 TF-IDF 시드를 날짜 역순으로 재정렬하고 컨텍스트에 날짜 경고 주입.
 */
const RECENCY_INTENT_RE = /최신|최근|요즘|이번\s*달|이번\s*주|오늘|지금|현재|방금|가장\s*새|latest|recent|진행\s*방향|진행\s*상황|진행\s*현황|현재\s*상태|현황|어떻게\s*됐|어떻게\s*되고|어디까지|어떤\s*상태|업데이트|최신화/i

// ── Domain classification for 2-team sub-agent architecture ──────────────────

/** 내러티브/캐릭터 도메인 키워드 */
const NARRATIVE_DOMAIN_RE = /캐릭터|스토리|세계관|나레이션|설정|배경|인물|페르소나|persona|character|story|world|narrative|lore|plot|캐릭터설정|케릭터/i
/** 시스템/게임플레이 도메인 키워드 */
const SYSTEM_DOMAIN_RE = /게임플레이|시스템|메카닉|스펙|밸런스|UI|UX|기술|아트|사운드|gameplay|mechanic|spec|balance|tech|art|sound|data|점령전|난투전|전투|combat|level|레벨|버그|패치|수치|공식|계산/i

function classifyDocDomain(doc: LoadedDocument): 'narrative' | 'system' | 'general' {
  const text = [doc.filename, doc.tags?.join(' ') ?? '', doc.speaker ?? ''].join(' ')
  if (NARRATIVE_DOMAIN_RE.test(text)) return 'narrative'
  if (SYSTEM_DOMAIN_RE.test(text)) return 'system'
  return 'general'
}

/**
 * 서브 에이전트: 도메인별 워커 요약본들을 하나의 관점 인사이트로 합성합니다.
 * onChunk가 제공되면 실시간 스트리밍.
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
  const domainName = domain === 'narrative' ? '내러티브/캐릭터' : '시스템/게임플레이'
  const sysPrompt =
    `당신은 ${domainName} 전문 서브 에이전트입니다. ` +
    `아래 워커 요약들을 바탕으로 "${domainName}" 관점의 핵심 인사이트를 200자 이내로 합성하세요. ` +
    `사람이 놓치기 쉬운 연결고리나 함의를 우선 포함하세요. 인사이트 텍스트만 출력하세요.`
  const content = `질문: ${query}\n\n워커 요약:\n${workerSummaries.join('\n---\n').slice(0, 4000)}`
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

/** 서브에이전트 합성 타임아웃 유틸 — 모듈 레벨 싱글톤 (fetchRAGContext 매 호출마다 재생성 방지) */
const withTimeout = <T>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
  Promise.race([p.catch(() => fallback), new Promise<T>(r => setTimeout(() => r(fallback), ms))])

/**
 * 현재 모델의 프로바이더에서 가장 저렴한 Worker 모델을 반환합니다.
 * Worker는 문서 요약 등 반복적인 경량 작업에 사용됩니다.
 */
export function getWorkerModelId(currentModelId: string): { modelId: string; provider: ProviderId } {
  const provider: ProviderId = getProviderForModel(currentModelId) ?? 'anthropic'
  return { modelId: WORKER_MODEL_IDS[provider] ?? currentModelId, provider }
}

/**
 * Worker LLM으로 단일 문서를 쿼리 관점에서 요약합니다.
 * API 오류나 키 없을 때는 본문 앞 300자로 폴백합니다.
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
    ? '문서에서 질문과 직접 관련된 문장을 원문 그대로 최대 3문장 인용하세요. 인용문만 출력하고, 없으면 "관련 내용 없음"이라고만 답하세요.'
    : '문서를 질문 관점에서 핵심만 200자 이내로 요약하세요. 요약만 출력하세요.'
  const userMsg = `질문: ${query}\n\n문서(${doc.filename}):\n${content}`
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
    logger.warn(`[Worker] agentSummarizeDoc 실패 (${doc.filename}):`, err instanceof Error ? err.message : String(err))
    result = ''
  }
  return result.trim() || body.slice(0, 300)
}

/**
 * 메인 에이전트가 vault context를 직접 보고 웹 검색 필요 여부를 판단.
 * Worker가 아닌 메인 모델이 결정하므로 내부 자료와 질문의 관계를 정확히 파악.
 *
 * 응답 형식: "NO" 또는 "YES: <검색어>"
 * max_tokens를 짧게 제한해 비용 최소화 (결정만 받고 답변은 별도 호출)
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
      '질문과 볼트 자료를 검토하여 웹 검색이 필요한지 판단하세요.\n' +
      '내부 프로젝트 문서로 충분히 답할 수 있으면 NO.\n' +
      '최신 업계 동향, 공식 발표, 외부 기술 정보가 필요하면 YES.\n' +
      '형식: "NO" 또는 "YES: <검색어 (영어/한국어 10단어 이내)>"'

    // 볼트 자료 앞부분만 요약해서 판단 비용 절감
    const ctxPreview = ragContext
      ? `\n볼트 자료 (앞부분):\n${ragContext.slice(0, 600)}`
      : '\n볼트 자료: 없음'
    const decisionMsg = `질문: ${query}${ctxPreview}\n\n웹 검색 필요 여부:`

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
    logger.debug(`[웹검색] 메인 에이전트 결정: "${searchQuery}" → ${results.length}건`)
    return buildWebContext(results, 2000)
  } catch {
    return ''
  }
}

/**
 * 최근 대화를 LLM으로 요약합니다.
 * ChatPanel의 "요약 저장" 버튼에서 호출 → memoryStore.appendToMemory()로 저장.
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
  const sysPrompt = '대화를 500자 이내로 핵심 결정사항/인사이트/합의된 내용 중심으로 요약하세요.'
  const userMsg = `다음 대화를 요약해주세요:\n\n${histText}`

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
    // ── 전체 탐색 인텐트: 허브 노드 기반 전체 그래프 탐색 ──────────────────
    // 키워드 검색을 건너뛰고 바로 허브 중심 BFS로 광범위한 컨텍스트 수집
    if (GLOBAL_INTENT_RE.test(userMessage)) {
      useGraphStore.getState().setAiHighlightNodes(getGlobalContextDocIds(35, 4))
      return await buildGlobalGraphContext(35, 4)
    }

    // ── 공유 docMap: 이 함수 전체에서 재사용 — 중복 Map 생성 방지 ──────────────
    const vaultDocs = useVaultStore.getState().loadedDocuments
    const docMap = new Map(vaultDocs?.map(d => [d.id, d]) ?? [])
    const now = Date.now()
    const sc = useSettingsStore.getState().searchConfig

    // ── 소형 볼트 전체 주입 모드 ────────────────────────────────────────────────
    // 볼트 전체 rawContent 합산이 fullVaultThreshold 이하이면 RAG 없이 전부 주입.
    // Claude Cowork와 동일한 방식 — 검색 실패 없이 모든 문서를 LLM이 직접 참조.
    if (sc.fullVaultThreshold > 0 && vaultDocs?.length) {
      const totalChars = vaultDocs.reduce((sum, d) => sum + (d.rawContent?.length ?? 0), 0)
      if (totalChars <= sc.fullVaultThreshold) {
        logger.debug(`[RAG] 소형 볼트 전체 주입: ${vaultDocs.length}개 문서, ${totalChars}자`)
        useGraphStore.getState().setAiHighlightNodes(vaultDocs.map(d => d.id))
        const fullCtx = vaultDocs
          .map(d => {
            const tagLine = d.tags?.length ? ` [태그: ${d.tags.join(', ')}]` : ''
            const dateLine = d.date ? ` [날짜: ${d.date}]` : ''
            const header = `## [문서] ${d.filename.replace(/\.md$/i, '')}${tagLine}${dateLine}\n`
            return header + getStrippedBody(d)
          })
          .join('\n\n---\n\n')
        return fullCtx
      }
    }

    // ── Stage 1: 직접 문자열 검색 (우선 시도) ─────────────────────────────────
    const _today = new Date()
    const _dateTokens = [
      String(_today.getFullYear()),
      String(_today.getMonth() + 1).padStart(2, '0'),
      String(_today.getDate()).padStart(2, '0'),
    ]

    // "최신/최근/요즘" 인텐트 감지 — Stage 1 recency 전략 결정
    const isRecencyQueryS1 = RECENCY_INTENT_RE.test(userMessage)

    // 날짜 토큰은 최신 인텐트 쿼리에만 추가.
    // 일반 쿼리에 "2026", "03" 등을 추가하면 날짜 파일명 문서들이 높은 파일명 점수를
    // 받아 실제 관련 문서(본문 매칭)를 상위 시드에서 밀어내는 오탐지 발생.
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

    // ── 강한 파일명 매칭 (score >= 0.4): 전체 본문 직접 주입 + BFS 연관 문서 보완 ──
    // score >= 0.4 = raw >= 4 = 파일명에 쿼리 단어 2개 이상 매칭
    // score >= 0.2 단일 매칭("회의", "문서" 등 일반 단어)은 오탐지 방지를 위해 BFS 시드로만 사용
    const strongPinnedHits = directHits.filter(r => r.score >= sc.minPinnedScore)
    if (strongPinnedHits.length > 0) {
      const { multiAgentRAG, personaModels } = useSettingsStore.getState()

      // Top-1: chief가 전체 본문 직접 읽음 (maxDocChars 제한)
      const topDoc = docMap.get(strongPinnedHits[0].doc_id)
      const pinnedParts: string[] = ['## 직접 지목된 문서 (전체 내용)\n']
      let hasPinnedContent = false
      // 실제로 pinnedParts에 포함된 doc ID만 추적 (실패한 워커 doc은 BFS에 포함)
      const includedDocIds = new Set<string>()
      const MIN_PINNED_BODY = 100  // 스텁 문서(프론트매터만 있는 문서) 차단 임계값
      if (topDoc) {
        const body = getStrippedBody(topDoc)
        if (body.trim().length >= MIN_PINNED_BODY) {
          const truncated = body.length > maxDocChars ? body.slice(0, maxDocChars).trimEnd() + '…' : body
          pinnedParts.push(`[문서] ${topDoc.filename.replace(/\.md$/i, '')}\n${truncated}\n\n`)
          hasPinnedContent = true
          includedDocIds.add(strongPinnedHits[0].doc_id)
        }
        // else: 스텁 문서 — pinned 처리하지 않고 BFS 시드로 fallthrough
      }

      // Docs 2~N 처리: 히트 수에 따라 전략 분기 (최대 5개로 RPM 제한)
      const secondaryHits = strongPinnedHits.slice(1, 6)
      if (secondaryHits.length > 0) {
        if (multiAgentRAG && !skipWorkers && secondaryHits.length >= 3) {
          // 3개 이상: Worker LLM 병렬 요약 (200자 압축, max 5개)
          const currentModelId = personaModels[currentSpeaker as DirectorId] ?? personaModels['chief_director']
          const { modelId: workerModelId, provider: workerProvider } = getWorkerModelId(currentModelId)
          const workerApiKey = getApiKey(workerProvider)
          if (workerApiKey) {
            onThinkingChunk?.(`📚 **Worker 에이전트 ${secondaryHits.length}개 병렬 처리 중...**\n\n`)

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
                .map(({ doc, summary }) => `[Worker 요약] ${doc.filename.replace(/\.md$/i, '')}\n${summary}\n`)
                .join('\n')
              pinnedParts.push('\n## 연관 문서 요약 (Worker)\n' + summarySection)
              hasPinnedContent = true

              // ── 2팀 서브에이전트 합성 ────────────────────────────────────────────
              const narrativeSummaries: string[] = []
              const systemSummaries: string[] = []
              for (const { doc, summary } of validResults) {
                const domain = classifyDocDomain(doc)
                const entry = `[${doc.filename.replace(/\.md$/i, '')}]\n${summary}`
                if (domain === 'narrative') narrativeSummaries.push(entry)
                else systemSummaries.push(entry)
              }

              let subAgentSection = ''

              // 서브에이전트 합성 — 8초 타임아웃 (모듈 레벨 withTimeout 재사용)
              if (narrativeSummaries.length >= 1) {
                onThinkingChunk?.('\n\n**[서브 에이전트 A — 내러티브/캐릭터 관점]**\n')
                const synthesis = await withTimeout(
                  agentSynthesizeDomain(narrativeSummaries, userMessage, 'narrative', workerApiKey, workerProvider, workerModelId, onThinkingChunk),
                  8000, '',
                )
                if (synthesis) subAgentSection += `\n### 내러티브/캐릭터 관점\n${synthesis}`
              }

              if (systemSummaries.length >= 1) {
                onThinkingChunk?.('\n\n**[서브 에이전트 B — 시스템/게임플레이 관점]**\n')
                const synthesis = await withTimeout(
                  agentSynthesizeDomain(systemSummaries, userMessage, 'system', workerApiKey, workerProvider, workerModelId, onThinkingChunk),
                  8000, '',
                )
                if (synthesis) subAgentSection += `\n### 시스템/게임플레이 관점\n${synthesis}`
              }

              if (subAgentSection) {
                pinnedParts.push('\n## 서브 에이전트 인사이트\n' + subAgentSection)
                onThinkingChunk?.('\n\n---\n')
              }
            }
          }
        } else {
          // 2~3개: Worker 없이 앞 1500자 직접 주입
          const directSections = secondaryHits
            .map(hit => {
              const doc = docMap.get(hit.doc_id)
              if (!doc) return ''
              const body = getStrippedBody(doc)
              const content = body.length > 1500 ? body.slice(0, 1500).trimEnd() + '…' : body
              return `[문서] ${doc.filename.replace(/\.md$/i, '')}\n${content}\n`
            })
            .filter(Boolean)
            .join('\n')
          if (directSections) {
            pinnedParts.push('\n## 연관 문서\n' + directSections)
            hasPinnedContent = true
            secondaryHits.forEach(hit => { if (docMap.has(hit.doc_id)) includedDocIds.add(hit.doc_id) })
          }
        }
      }

      if (hasPinnedContent) {
        const pinnedCtx = pinnedParts.join('')
        // 실제로 포함된 문서만 BFS 시드에서 제외 (실패한 워커 문서는 BFS 시드로 복원)
        const bfsSeeds = directHits.filter(r => !includedDocIds.has(r.doc_id))
        const bfsCtx = await buildDeepGraphContext(bfsSeeds, 2, 10, tokenizeQuery(userMessage), currentSpeaker)
        logger.debug(`[RAG] Multi-agent: pinned=${pinnedCtx.length}자, BFS=${bfsCtx.length}자`)
        useGraphStore.getState().setAiHighlightNodes(directHits.map(r => r.doc_id))
        return pinnedCtx + (bfsCtx ? '\n' + bfsCtx : '')
      }
    }

    let seeds: import('@/types').SearchResult[]

    if (hasStrongDirectHit) {
      // 직접 검색 결과가 충분 → 이를 우선 시드로 사용 (폴백 경로)
      seeds = directHits
      logger.debug(`[RAG] 직접 검색 우선: ${seeds.map(r => r.filename).join(', ')}`)
    } else {
      // 직접 매칭 미흡 → 벡터 전체 검색 우선, BM25 보완
      let candidates: import('@/types').SearchResult[] = []
      let searchMode = 'BM25'

      const geminiKey = getApiKey('gemini')
      if (vectorEmbedIndex.isBuilt && geminiKey) {
        // ── 1순위: 전체 벡터 검색 (순수 의미 유사도) ────────────────────────
        try {
          const vecResults = await vectorEmbedIndex.fullVectorSearch(
            userMessage, geminiKey, sc.bm25Candidates * 2, vaultDocs ?? [],
          )
          if (vecResults && vecResults.length > 0) {
            candidates = vecResults
            searchMode = 'vector'

            // BM25로 벡터가 놓친 키워드 매칭 문서 보완 (상위 절반만)
            const bm25Results = frontendKeywordSearch(userMessage, sc.bm25Candidates, currentSpeaker)
            const vecIds = new Set(candidates.map(r => r.doc_id))
            for (const r of bm25Results) {
              if (!vecIds.has(r.doc_id) && r.score > sc.minBm25Score) {
                candidates.push(r)
              }
            }
          }
        } catch (e: unknown) {
          logger.warn('[vector] fullVectorSearch 실패, BM25 폴백:', e instanceof Error ? e.message : String(e))
        }
      }

      if (candidates.length === 0) {
        // ── 2순위: ChromaDB 백엔드 ────────────────────────────────────────────
        if (typeof window !== 'undefined' && window.backendAPI) {
          try {
            const response = await window.backendAPI.search(userMessage, sc.bm25Candidates)
            candidates = response.results ?? []
            if (candidates.length > 0) searchMode = 'chromadb'
          } catch { /* backend not running */ }
        }
        // ── 3순위: 프론트엔드 BM25 ───────────────────────────────────────────
        if (candidates.length === 0) {
          candidates = frontendKeywordSearch(userMessage, sc.bm25Candidates * 4, currentSpeaker)
        }
      }

      logger.debug(`[RAG] ${searchMode} 후보: ${candidates.length}개 (쿼리: "${userMessage.slice(0, 40)}")`)

      const relevant = candidates.filter(r => r.score > (searchMode === 'vector' ? 0.1 : sc.minBm25Score))
      seeds = relevant.length > 0 ? rerankResults(relevant, userMessage, sc.rerankSeeds, currentSpeaker) : []

      // 직접 검색에서 놓친 문서 보완
      const seedIds = new Set(seeds.map(r => r.doc_id))
      for (const hit of directHits) {
        if (!seedIds.has(hit.doc_id)) seeds.push(hit)
      }
    }

    // _index.md 항상 포함
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
        score: 0.15,  // PPR 지배 방지 — seed에 포함되지만 최상위 점수 차지하지 않음
        tags: indexDoc.tags ?? [],
      })
    }

    // 버전 중복 제거: 동일 문서의 v2/v3/v4 중 최신만 유지
    seeds = deduplicateVersions(seeds, docMap)

    // 최신 인텐트 감지: 시드를 날짜 역순으로 재정렬해 최신 문서가 BFS 우선 탐색에 사용되도록
    // _index.md / currentSituation.md 는 항상 상단 유지 (날짜 정보 포함)
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
      logger.debug(`[RAG] 최신 인텐트 감지 — 시드 날짜순 재정렬: ${seeds.slice(0, 3).map(r => r.filename).join(', ')}`)
    }

    // Stage 2: BFS 그래프 탐색 — 시드에서 최대 3홉까지 연결 문서 수집
    if (seeds.length > 0) {
      useGraphStore.getState().setAiHighlightNodes(seeds.map(r => r.doc_id))
    }
    const ctx = await buildDeepGraphContext(seeds, sc.bfsMaxHops, sc.bfsMaxDocs, tokenizeQuery(userMessage), currentSpeaker)
    logger.debug(`[RAG] 컨텍스트 생성 완료: ${ctx.length}자`)

    // 최신 인텐트 시 LLM에게 날짜 기준 + 볼트 데이터 공백 안내 주입
    if (isRecencyQuery) {
      const today = new Date().toISOString().slice(0, 10)
      // 볼트에서 가장 최근 문서 날짜 계산 (데이터 공백 경고용)
      const latestMs = vaultDocs
        ? Math.max(...vaultDocs.map(d => d.mtime ?? (d.date ? Date.parse(d.date) : 0)).filter(Boolean))
        : 0
      const latestDate = latestMs > 0 ? new Date(latestMs).toISOString().slice(0, 10) : null
      const gapWarning = latestDate && latestDate < today
        ? ` 볼트의 가장 최신 문서는 **${latestDate}**까지만 있습니다. 그 이후 상황은 볼트에 기록이 없으므로 알 수 없다고 명시하세요.`
        : ''
      const preamble = `> ⚠️ **날짜 기준**: 오늘은 ${today}입니다.${gapWarning} 아래 문서에 date 필드가 표시되어 있습니다. **최신 정보를 원하면 가장 최근 date를 가진 문서를 우선하세요.**\n\n`
      return preamble + ctx
    }
    return ctx
  } catch (err) {
    // RAG failure is non-fatal — continue without context
    logger.error('[RAG] fetchRAGContext 오류:', err)
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
    + '\n\n[말투 고정] 참고 문서나 사용자 메시지의 문체에 관계없이 항상 전문적인 존댓말(~합니다/~습니다 체)로 일관되게 답변하세요.'
    + '\n\n[출처 안내] 참고 문서 헤더에 [출처: URL] 형태로 원본 URL이 포함된 경우, 사용자가 출처·링크·원문을 요청하면 해당 URL을 답변에 포함하세요.'
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

/** 멀티볼트 순차 탐색 중 전역 store 변이를 직렬화하기 위한 뮤텍스 (Promise 체인) */
let _multiVaultSearchLock: Promise<void> = Promise.resolve()

/** true while multi-vault search is swapping loadedDocuments in the global store */
let _multiVaultSwapActive = false

/**
 * Slack 봇용: 렘브란트 맵의 RAG 파이프라인(BFS+TF-IDF)으로 컨텍스트를 수집하고
 * 지정 페르소나 모델로 답변을 생성해 반환한다.
 * useRagApi.ts의 onAsk 핸들러에서 호출됨.
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

  // streamMessage와 동일: 커스텀 페르소나 우선 확인
  const customPersona = customPersonas.find(p => p.id === directorId)
  const modelId = customPersona
    ? customPersona.modelId
    : (personaModels[directorId as DirectorId] ?? personaModels['chief_director'])
  const provider = getProviderForModel(modelId)
  if (!provider) return { answer: '', imagePaths: [] }
  const apiKey = getApiKey(provider)
  if (!apiKey) return { answer: '', imagePaths: [] }

  // ── 시스템 프롬프트 구성 (streamMessage와 동일 순서) ─────────────────────
  const basePrompt = customPersona
    ? customPersona.systemPrompt
    : (personaPromptOverrides[directorId as DirectorId]
        ?? PERSONA_PROMPTS[directorId as DirectorId]
        ?? PERSONA_PROMPTS['chief_director'])

  const directorBio = customPersona ? undefined : directorBios[directorId as DirectorId]
  const projectContext = buildProjectContext(projectInfo, directorBio)

  // 페르소나 문서 주입
  const personaDocId = personaDocumentIds[directorId]
  let personaDocContext = ''
  if (personaDocId) {
    const doc = useVaultStore.getState().loadedDocuments?.find(d => d.id === personaDocId)
    if (doc) {
      personaDocContext = `\n\n---\n아래는 "${doc.filename}" 문서에서 가져온 페르소나 참고 자료입니다. 이 내용을 바탕으로 해당 인물의 관점과 어투를 참고하세요:\n\n${doc.rawContent.slice(0, 4000)}`
    }
  }

  // 장기 기억 주입
  const { memoryText } = useMemoryStore.getState()
  const memoryContext = memoryText.trim()
    ? `\n\n---\n## 📌 이전 대화 기억\n${memoryText.trim()}\n---`
    : ''

  const ragInstructionBlock = ragInstruction.trim() ? '\n\n' + ragInstruction.trim() : ''
  const factBlock_slack = _citationModeSlack
    ? '\n\n[사실 준수] 아래 지침을 반드시 따르세요:\n1. 답변은 오직 볼트에서 검색된 문서, 웹 검색 결과, 또는 사용자가 직접 말한 내용만을 근거로 합니다.\n2. 문서에 명시되지 않은 사실은 절대 추측하거나 만들어내지 마세요. 불확실하면 "해당 내용은 검색된 문서에서 확인되지 않습니다"라고 명시하세요.\n3. 볼트 문서를 언급할 때는 "검색된 문서" 또는 "볼트 문서"라고 표현하세요.\n4. 볼트 인용문 외 내용을 추론할 때는 반드시 문장 끝에 **(추론)** 을 표시하세요.'
    : '\n\n[사실 준수] 아래 지침을 반드시 따르세요:\n1. 답변은 오직 볼트에서 검색된 문서, 웹 검색 결과, 또는 사용자가 직접 말한 내용만을 근거로 합니다.\n2. 문서에 명시되지 않은 사실은 절대 추측하거나 만들어내지 마세요. 불확실하면 "해당 내용은 검색된 문서에서 확인되지 않습니다"라고 명시하세요.\n3. RAG로 자동 검색된 볼트 문서를 언급할 때는 "제공해주신 문서"가 아닌 "검색된 문서" 또는 "볼트 문서"라고 표현하세요.'
  // 민감 키워드 매칭 시 우선 처리 지시 주입
  const matchedKeywords = sensitiveKeywords
    ? sensitiveKeywords.split(/[\n,]+/).map(k => k.trim()).filter(Boolean)
        .filter(k => query.toLowerCase().includes(k.toLowerCase()))
    : []
  const sensitiveBlock = matchedKeywords.length > 0
    ? `\n\n[우선 주제] 이 질문은 다음 핵심 키워드를 포함합니다: ${matchedKeywords.map(k => `"${k}"`).join(', ')}. 이 주제에 관한 정보를 최우선으로 검색하고, 관련 내용을 빠짐없이 상세하게 답변하세요.`
    : ''

  const systemPrompt = buildSystemPrompt({
    projectContext, basePrompt, ragInstructionBlock, personaDocContext, memoryContext,
    responseInstructions, sensitiveBlock, factBlock: factBlock_slack,
    suffix: '\n\n[Slack 이미지] 이 대화는 Slack 봇을 통해 이루어집니다. 볼트에서 관련 이미지가 발견되면 봇 시스템이 자동으로 첨부합니다. "이미지를 보여줄 수 없다"거나 "이미지 기능이 없다"는 표현은 절대 사용하지 마세요. 이미지 요청에는 관련 내용을 텍스트로 설명하고, 이미지는 시스템이 자동 처리한다고 안내하세요.',
  })

  // ── RAG context → 유저 메시지 앞에 주입 (Slack: worker 생략, BFS 유지) ──────
  // 짧은 인사/감탄사는 RAG 생략 (엉뚱한 프로젝트 컨텍스트 주입 방지)
  const isSmallTalk = /^(안녕|ㅎㅇ|hi|hello|hey|반가워|고마워|감사합니다|감사해|수고|고생|화이팅|파이팅|ㅋ+|ㄱ+|ㅇㅇ|ㅇㅋ|오케|굿|좋아|ㅇㄱ|ㄴㄴ|ㅠ+|ㅜ+)\s*[~!?♡]*$/i.test(query.trim())

  // Slack: 볼트별 병렬 검색 후 컨텍스트 병합 (TF-IDF 캐시 재활용, [출처: 볼트명] 헤더 삽입)
  let _ragRaw = ''
  if (!isSmallTalk) {
    const { vaultDocsCache, loadedDocuments: _activeDocs, vaults } = useVaultStore.getState()
    // vaultDocsCache 오염 방지: setLoadedDocuments 대신 setState 직접 사용 (캐시 write-back 없음)
    const _setDocs = (docs: typeof _activeDocs) => useVaultStore.setState({ loadedDocuments: docs })
    const vaultEntries = Object.entries(vaultDocsCache)
    if (vaultEntries.length <= 1) {
      // 볼트 1개 → 기존 방식
      _ragRaw = await fetchRAGContext(query, directorId, 8000, true)
    } else {
      // 볼트 여러 개 → 볼트별 순차 검색 후 병합 (각 볼트 TF-IDF 캐시 그대로 활용)
      // 뮤텍스: 동시 슬랙 메시지가 store 변이를 인터리브하지 않도록 직렬화
      // Promise 체인 방식 — busy-wait 없이 FIFO 순서 보장
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
          if (ctx.trim()) parts.push(`\n# [출처: ${label}]\n${ctx}`)
        }
      } finally {
        _setDocs(_activeDocs)  // 예외 발생 시에도 활성 볼트로 반드시 복원
        _multiVaultSwapActive = false
        releaseLock()
      }
      _ragRaw = parts.join('\n')
    }
  }

  // 소형 볼트 전체 주입 모드에서는 fullVaultThreshold까지 허용; 일반 RAG는 10K 캡 (30K TPM 한도 대응)
  const _fvt = useSettingsStore.getState().searchConfig.fullVaultThreshold
  const _isFullVault = _fvt > 0 && _ragRaw.length > 0 && _ragRaw.length <= _fvt
  const _ragCap = _isFullVault ? _fvt : 10000
  const ragContext = _ragRaw.length > _ragCap ? _ragRaw.slice(0, _ragCap).trimEnd() + '\n…(컨텍스트 축약)' : _ragRaw

  // 웹 검색 (메인 에이전트 자율 판단, 설정 on일 때만)
  const { webSearch: _webSearchEnabled } = useSettingsStore.getState()
  let webCtx = ''
  if (_webSearchEnabled && typeof window !== 'undefined' && (window as any).webSearchAPI) {
    webCtx = await mainAgentWebSearch(query, ragContext, modelId, provider, apiKey)
  }

  const combinedCtx = [ragContext, webCtx].filter(Boolean).join('\n')
  let fullUserMessage = query
  if (combinedCtx) {
    const srcLabel = ragContext && webCtx
      ? '볼트 WikiLink 그래프와 웹 검색'
      : ragContext ? '볼트 WikiLink 그래프' : '웹 검색'
    fullUserMessage = `${combinedCtx}위 자료는 ${srcLabel}으로 수집한 관련 자료입니다.\n답변 시 이 자료들을 참고하여 인사이트와 구체적인 피드백을 제공하세요.\n\n---\n\n${query}`
  }

  // 이전 대화 히스토리 (Slack: 최대 6개 메시지 = 3턴, TPM 절약)
  const historyMessages = history.slice(-6)
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({
      role: m.role as 'user' | 'assistant',
      content: sanitize(m.content),
    }))

  // 이미지 첨부 시 Attachment 배열로 변환 (providers가 공통으로 사용하는 형식)
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

  // RAG 결과 상위 문서에서 연관 이미지 경로 수집 (볼트 이미지 자동 첨부용)
  const { imagePathRegistry, loadedDocuments: allDocs } = useVaultStore.getState()
  const imagePaths: string[] = []
  if (imagePathRegistry && allDocs) {
    const docMap = new Map(allDocs.map(d => [d.id, d]))
    const _imgToday = new Date()
    const _imgDateQ = query + ' ' + _imgToday.getFullYear() + ' ' + String(_imgToday.getMonth() + 1).padStart(2, '0') + ' ' + String(_imgToday.getDate()).padStart(2, '0')
    const topHits = directVaultSearch(_imgDateQ, 5)
    const seen = new Set<string>()

    // 1순위: 매칭된 문서의 imageRefs (마크다운 임베드 이미지)
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

    // 2순위: imageRegistry 파일명에서 쿼리 단어 매칭 (임베드 없이 독립 이미지 파일만 있는 경우)
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
  overrideRagContext?: string,   // 키워드 검색 우회 — 노드 선택 AI 분석 등에 사용
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
  if (!model) { logger.error(`[LLM] 알 수 없는 모델 ID: ${modelId}`); onChunk('모델 설정 오류: 알 수 없는 모델입니다.'); return }

  // Resolve system prompt: custom persona > built-in override > built-in default
  const basePrompt = customPersona
    ? customPersona.systemPrompt
    : (personaPromptOverrides[persona] ?? PERSONA_PROMPTS[persona as DirectorId] ?? '')

  // Director bio only applies to built-in personas
  const directorBio = customPersona ? undefined : directorBios[persona as DirectorId]
  const projectContext = buildProjectContext(projectInfo, directorBio)

  // ── Persona document injection ──────────────────────────────────────────────
  // 설정에서 이 페르소나에 연결된 볼트 문서가 있으면 시스템 프롬프트에 주입
  const personaDocId = personaDocumentIds[persona]
  let personaDocContext = ''
  if (personaDocId) {
    const doc = useVaultStore.getState().loadedDocuments?.find(d => d.id === personaDocId)
    if (doc) {
      personaDocContext = `\n\n---\n아래는 "${doc.filename}" 문서에서 가져온 페르소나 참고 자료입니다. 이 내용을 바탕으로 해당 인물의 관점과 어투를 참고하세요:\n\n${doc.rawContent.slice(0, 4000)}`
    }
  }

  // ── AI 장기 기억 주입 ────────────────────────────────────────────────────────
  const { memoryText } = useMemoryStore.getState()
  const memoryContext = memoryText.trim()
    ? `\n\n---\n## 📌 이전 대화 기억\n${memoryText.trim()}\n---`
    : ''

  // ── Graph-Augmented RAG context injection ──────────────────────────────────
  // overrideRagContext가 있으면 키워드 검색 없이 그대로 사용 (노드 직접 선택 분석 등)
  const ragContext = overrideRagContext !== undefined
    ? overrideRagContext
    : await fetchRAGContext(userMessage, persona, 20000, false, onThinkingChunk)

  // ── 웹 검색 (메인 에이전트 자율 판단 — 일반 채팅, 설정 on일 때만) ────────────
  let webCtx = ''
  if (overrideRagContext === undefined && webSearchEnabled && typeof window !== 'undefined' && (window as any).webSearchAPI) {
    webCtx = await mainAgentWebSearch(userMessage, ragContext, modelId, provider, apiKey)
  }

  const ragInstructionBlock = ragInstruction.trim() ? '\n\n' + ragInstruction.trim() : ''
  const factBlock = citationMode
    ? '\n\n[사실 준수] 아래 지침을 반드시 따르세요:\n1. 답변은 오직 볼트에서 검색된 문서, 웹 검색 결과, 또는 사용자가 직접 말한 내용만을 근거로 합니다.\n2. 문서에 명시되지 않은 사실은 절대 추측하거나 만들어내지 마세요. 불확실하면 "해당 내용은 검색된 문서에서 확인되지 않습니다"라고 명시하세요.\n3. 볼트 문서를 언급할 때는 "검색된 문서" 또는 "볼트 문서"라고 표현하세요.\n4. 볼트 인용문 외 내용을 추론할 때는 반드시 문장 끝에 **(추론)** 을 표시하세요.'
    : '\n\n[사실 준수] 아래 지침을 반드시 따르세요:\n1. 답변은 오직 볼트에서 검색된 문서, 웹 검색 결과, 또는 사용자가 직접 말한 내용만을 근거로 합니다.\n2. 문서에 명시되지 않은 사실은 절대 추측하거나 만들어내지 마세요. 불확실하면 "해당 내용은 검색된 문서에서 확인되지 않습니다"라고 명시하세요.\n3. RAG로 자동 검색된 볼트 문서를 언급할 때는 "제공해주신 문서"가 아닌 "검색된 문서" 또는 "볼트 문서"라고 표현하세요.'
  // 민감 키워드 매칭 시 우선 처리 지시 주입
  const _matchedKw = sensitiveKeywords
    ? sensitiveKeywords.split(/[\n,]+/).map(k => k.trim()).filter(Boolean)
        .filter(k => userMessage.toLowerCase().includes(k.toLowerCase()))
    : []
  const _sensitiveBlock = _matchedKw.length > 0
    ? `\n\n[우선 주제] 이 질문은 다음 핵심 키워드를 포함합니다: ${_matchedKw.map(k => `"${k}"`).join(', ')}. 이 주제에 관한 정보를 최우선으로 검색하고, 관련 내용을 빠짐없이 상세하게 답변하세요.`
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
    const TEXT_ATTACH_MAX = 8000  // 첨부 파일당 최대 글자수 (~2K 토큰)
    const textContext = textAttachments
      .map(a => {
        const content = a.dataUrl.length > TEXT_ATTACH_MAX
          ? a.dataUrl.slice(0, TEXT_ATTACH_MAX) + '\n…(내용 축약됨)'
          : a.dataUrl
        return `\n\n[첨부 파일: ${a.name}]\n${content}`
      })
      .join('')
    fullUserMessage = userMessage + textContext
  }

  // RAG 컨텍스트 + 웹 검색 결과를 사용자 메시지 앞에 주입
  const combinedCtx = [ragContext, webCtx].filter(Boolean).join('\n')
  if (combinedCtx) {
    const srcLabel = ragContext && webCtx
      ? '볼트 WikiLink 그래프와 웹 검색'
      : ragContext ? '볼트 WikiLink 그래프' : '웹 검색'
    fullUserMessage = `${combinedCtx}위 자료는 ${srcLabel}으로 수집한 관련 자료입니다.\n답변 시 이 자료들을 참고하여 인사이트와 구체적인 피드백을 제공하세요.\n\n---\n\n${fullUserMessage}`
  }

  // Build message history, excluding the current user message
  let historyMessages = toHistoryMessages(
    history.filter((m) => m.content !== userMessage || m.role !== 'user')
  )

  // ── Context compaction: 히스토리가 너무 길면 오래된 대화를 요약해서 시스템 프롬프트에 주입 ──
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
          '대화 내용을 300자로 요약하세요.',
          [{ role: 'user' as const, content: sanitize(oldText) }],
          (c: string) => { compactSummary += c },
        )
        if (compactSummary.trim()) {
          finalSystemPrompt += `\n\n## 이전 대화 요약 (자동 컴팩션)\n${compactSummary.trim()}`
          historyMessages = recentMessages
          // 컴팩션 요약을 AI 장기 기억에도 자동 저장
          const timestamp = new Date().toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
          useMemoryStore.getState().appendToMemory(`[${timestamp} 자동 요약]\n${compactSummary.trim()}`)
          logger.debug(`[컴팩션] ${histChars}자 → 최근 8개 메시지 + 요약 주입 + 기억 저장`)
        }
      }
    } catch (e) {
      logger.warn('[컴팩션] 실패 — 전체 히스토리 사용:', e)
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
        onChunk('[Grok은 이미지 분석을 지원하지 않습니다. 텍스트만 처리됩니다.]\n\n')
      }
      await streamCompletion(apiKey, modelId, cleanSystemPrompt, allMessages, onChunk, [], onUsage, signal)
      break
    }
    default: {
      await streamMockResponse(persona, userMessage, onChunk)
    }
  }

  // 채팅 RAG 하이라이트 클리어 (GraphPanel 분석은 자체 관리)
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
      personaDocContext = `\n\n---\n아래는 "${doc.filename}" 문서에서 가져온 페르소나 참고 자료입니다. 이 내용을 바탕으로 해당 인물의 관점과 어투를 참고하세요:\n\n${doc.rawContent.slice(0, 4000)}`
    }
  }

  const { memoryText } = useMemoryStore.getState()
  const memoryContext = memoryText.trim()
    ? `\n\n---\n## 📌 이전 대화 기억\n${memoryText.trim()}\n---`
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
    ? '\n\n[사실 준수] 아래 지침을 반드시 따르세요:\n1. 답변은 오직 볼트에서 검색된 문서, 웹 검색 결과, 또는 사용자가 직접 말한 내용만을 근거로 합니다.\n2. 문서에 명시되지 않은 사실은 절대 추측하거나 만들어내지 마세요. 불확실하면 "해당 내용은 검색된 문서에서 확인되지 않습니다"라고 명시하세요.\n3. 볼트 문서를 언급할 때는 "검색된 문서" 또는 "볼트 문서"라고 표현하세요.\n4. 볼트 인용문 외 내용을 추론할 때는 반드시 문장 끝에 **(추론)** 을 표시하세요.'
    : '\n\n[사실 준수] 아래 지침을 반드시 따르세요:\n1. 답변은 오직 볼트에서 검색된 문서, 웹 검색 결과, 또는 사용자가 직접 말한 내용만을 근거로 합니다.\n2. 문서에 명시되지 않은 사실은 절대 추측하거나 만들어내지 마세요. 불확실하면 "해당 내용은 검색된 문서에서 확인되지 않습니다"라고 명시하세요.\n3. RAG로 자동 검색된 볼트 문서를 언급할 때는 "제공해주신 문서"가 아닌 "검색된 문서" 또는 "볼트 문서"라고 표현하세요.'

  const _matchedKw = sensitiveKeywords
    ? sensitiveKeywords.split(/[\n,]+/).map(k => k.trim()).filter(Boolean)
        .filter(k => userMessage.toLowerCase().includes(k.toLowerCase()))
    : []
  const _sensitiveBlock = _matchedKw.length > 0
    ? `\n\n[우선 주제] 이 질문은 다음 핵심 키워드를 포함합니다: ${_matchedKw.map(k => `"${k}"`).join(', ')}. 이 주제에 관한 정보를 최우선으로 검색하고, 관련 내용을 빠짐없이 상세하게 답변하세요.`
    : ''

  const { vaultPath } = useVaultStore.getState()

  // Tool capability notice in system prompt — include vault path so LLM uses correct absolute paths
  const vaultPathHint = vaultPath
    ? `\n볼트 경로: ${vaultPath} — 파일 도구의 path는 반드시 이 경로로 시작하는 절대 경로를 사용하세요. 예: ${vaultPath}/active/파일명.md`
    : ''
  const toolNotice = `\n\n[도구 사용 가능] 파일 읽기/쓰기, Jira 이슈 관리, Confluence 페이지 생성·수정 등 볼트 도구를 직접 사용할 수 있습니다. 사용자가 문서 작성, 이슈 발행, 파일 수정 등을 요청하면 적극적으로 도구를 활용하세요.${vaultPathHint}`

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
          ? a.dataUrl.slice(0, TEXT_ATTACH_MAX) + '\n…(내용 축약됨)'
          : a.dataUrl
        return `\n\n[첨부 파일: ${a.name}]\n${content}`
      })
      .join('')
    fullUserMessage = userMessage + textContext
  }

  const combinedCtx = [ragContext, webCtx].filter(Boolean).join('\n')
  if (combinedCtx) {
    const srcLabel = ragContext && webCtx
      ? '볼트 WikiLink 그래프와 웹 검색'
      : ragContext ? '볼트 WikiLink 그래프' : '웹 검색'
    fullUserMessage = `${combinedCtx}위 자료는 ${srcLabel}으로 수집한 관련 자료입니다.\n답변 시 이 자료들을 참고하여 인사이트와 구체적인 피드백을 제공하세요.\n\n---\n\n${fullUserMessage}`
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
