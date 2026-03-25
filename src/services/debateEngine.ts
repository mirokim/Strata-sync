/**
 * Debate engine — orchestrates multi-AI discussions.
 * Adapted from Onion_flow's debateEngine.ts for STRATA SYNC's provider system.
 *
 * Key difference: uses STRATA SYNC's streaming providers (providers/*.ts)
 * with env API keys, rather than Onion_flow's callWithTools/aiStore approach.
 */
import type {
  DiscussionConfig,
  DiscussionMessage,
  DiscussionParticipantId,
  DebateCallbacks,
  ReferenceFile,
} from '@/types'
import { DEBATE_PROVIDER_LABELS, ROLE_OPTIONS, ROLE_DESCRIPTIONS } from './debateRoles'
import { generateId } from '@/lib/utils'
import { getApiKey, useSettingsStore } from '@/stores/settingsStore'
import { getProviderForModel, DEBATE_MODEL_IDS } from '@/lib/modelConfig'
import type { ProviderId } from '@/lib/modelConfig'
import type { DirectorId } from '@/types'

// ── Default models per provider (fallback for non-persona participants) ───────

const DEFAULT_DEBATE_MODELS = DEBATE_MODEL_IDS

// ── Content block types for multimodal messages ──────────────────────────────

interface TextContent { type: 'text'; text: string }
interface ImageContent { type: 'image_url'; image_url: { url: string } }
type ContentPart = TextContent | ImageContent

type ApiMessage = { role: string; content: string | ContentPart[] }

// ── System Prompt Builders ───────────────────────────────────────────────────

function buildSystemPrompt(
  config: DiscussionConfig,
  currentProvider: string,
): string {
  const label = DEBATE_PROVIDER_LABELS[currentProvider] || currentProvider
  const participantList = config.selectedProviders
    .map((p: string) => DEBATE_PROVIDER_LABELS[p] || p)
    .join(', ')

  const labelList = config.selectedProviders
    .map((p: string) => `"[${DEBATE_PROVIDER_LABELS[p] || p}]:"`)
    .join(', ')

  const base = `You are "${label}" participating in a multi-AI debate.
Debate topic: "${config.topic}"
Participants: ${participantList}

Rules:
- Reply in English.
- Be concise and to the point (200–400 characters).
- Reference and build on other participants' arguments specifically.
- Labels in the format ${labelList} indicate other participants' statements.
- The "[User]:" label is an intervention from the user observing the debate. Respond to the user's questions or requests first.

Accuracy and reliability principles (strictly required):
- Always cite your source or provide a link when stating facts.
- Never fabricate facts, names, tools, features, dates, statistics, quotes, sources, or examples.
- If you don't know something, say "This needs verification."
- Clearly acknowledge uncertainty for information you are less than 95% confident about.`

  let prompt: string

  switch (config.mode) {
    case 'roundRobin':
      prompt = `${base}\n\nDebate format: Round Robin (speak in order)\nRefer to the previous speaker's opinion and agree, rebut, or supplement it with your own view.`
      break

    case 'freeDiscussion':
      prompt = `${base}\n\nDebate format: Free Discussion\nFreely rebut, agree with, question, or supplement other participants' opinions.\nOccasionally introducing a completely new perspective is welcome.`
      break

    case 'roleAssignment': {
      const roleConfig = config.roles.find((r) => r.provider === currentProvider)
      const roleLabel = roleConfig?.role || 'Neutral'
      const roleOption = ROLE_OPTIONS.find((r) => r.label === roleLabel)
      const roleDescription = roleOption ? ROLE_DESCRIPTIONS[roleOption.value] || '' : ''

      prompt = `${base}\n\nDebate format: Role Assignment\nYour assigned role: **${roleLabel}**\n${roleDescription}\nMaintain this role's perspective and speaking style consistently throughout the discussion.`
      break
    }

    case 'battle': {
      const isJudge = config.judgeProvider === currentProvider
      if (isJudge) {
        const debaters = config.selectedProviders
          .filter((p: string) => p !== config.judgeProvider)
          .map((p: string) => DEBATE_PROVIDER_LABELS[p] || p)
          .join(' vs ')
        prompt = `${base}\n\nDebate format: Battle Mode (Judge)\nYou are the **Judge** of this debate. You do not participate directly.\nMatchup: ${debaters}\n\nAfter each round, evaluate using this format:\n\n📊 **Round [N] Evaluation**\n\n| Participant | Score (out of 10) | Comment |\n|-------------|-------------------|---------|\n| [AI name] | X pts | One-line comment |\n\n💬 **Judge's Comment**: Analyze the key issues and each participant's strengths and weaknesses in this round.\n🏆 **Round Winner**: [AI name]\n\nScoring criteria: Logic (3 pts), Quality of evidence (3 pts), Rebuttal strength (2 pts), Persuasiveness (2 pts)\n\nIn the final round, additionally provide:\n🏅 **Overall Winner**: [AI name]\n📝 **Overall Evaluation**: Comprehensively assess the entire debate.`
      } else {
        const debaters = config.selectedProviders
          .filter((p: string) => p !== config.judgeProvider)
          .map((p: string) => DEBATE_PROVIDER_LABELS[p] || p)
        const opponents = debaters.filter((n: string) => n !== label).join(', ')
        const judgeName = config.judgeProvider
          ? (DEBATE_PROVIDER_LABELS[config.judgeProvider] || config.judgeProvider)
          : 'Judge'

        const roleConfig = config.roles.find((r) => r.provider === currentProvider)
        const roleLabel = roleConfig?.role
        const roleOption = roleLabel ? ROLE_OPTIONS.find((r) => r.label === roleLabel) : null
        const roleDescription = roleOption ? ROLE_DESCRIPTIONS[roleOption.value] || '' : ''
        const roleSection = roleLabel && roleLabel !== 'Neutral'
          ? `\n\nYour character: **${roleLabel}**\n${roleDescription}\nMaintain this character's tone and personality while debating.`
          : ''

        prompt = `${base}\n\nDebate format: Battle Mode (Debater)\nThis is a competitive debate. Opponent: ${opponents}\nJudge: ${judgeName} (scores each round)\n\nGoal: Win by earning a high score from the judge.\n- Present strong arguments with concrete evidence.\n- Precisely identify and rebut your opponent's weaknesses.\n- Scoring criteria: Logic, quality of evidence, rebuttal strength, persuasiveness.${roleSection}`
      }
      break
    }

    default:
      prompt = base
  }

  if (config.useReference && config.referenceText.trim()) {
    prompt += `\n\nReference material:\n"""\n${config.referenceText.trim()}\n"""\n\nBase your debate on the above reference material.`
  }

  if (config.referenceFiles.length > 0) {
    prompt += `\n\nAttached image/document files are provided as reference material. Analyze them and use them in the debate.`
  }

  return prompt
}

// ── Build file content blocks ────────────────────────────────────────────────

function buildFileBlocks(files: ReferenceFile[]): ContentPart[] {
  const blocks: ContentPart[] = []
  for (const file of files) {
    if (file.mimeType.startsWith('image/')) {
      blocks.push({ type: 'image_url', image_url: { url: file.dataUrl } })
    }
  }
  return blocks
}

// ── Message Formatting ────────────────────────────────────────────────────────

function buildApiMessages(
  allMessages: DiscussionMessage[],
  currentProvider: string,
  referenceFiles: ReferenceFile[],
  isFirstCall: boolean,
): ApiMessage[] {
  const recent = allMessages.slice(-15)
  const fileBlocks = isFirstCall && referenceFiles.length > 0
    ? buildFileBlocks(referenceFiles)
    : []

  if (recent.length === 0) {
    const text = 'Please start the debate. Present your opinion on the topic first.'
    if (fileBlocks.length > 0) {
      return [{ role: 'user', content: [{ type: 'text', text }, ...fileBlocks] }]
    }
    return [{ role: 'user', content: text }]
  }

  return recent.map((msg, index) => {
    if (msg.provider === currentProvider) {
      return { role: 'assistant', content: msg.content }
    }

    const label = msg.provider === 'user'
      ? 'User'
      : (DEBATE_PROVIDER_LABELS[msg.provider] || msg.provider)
    const prefix = msg.provider === 'user' ? '[User]' : `[${label}]`
    const judgeTag = msg.messageType === 'judge-evaluation' ? ' (Judge Evaluation)' : ''
    const text = `${prefix}${judgeTag}: ${msg.content}`

    const msgFileBlocks = msg.files && msg.files.length > 0
      ? buildFileBlocks(msg.files)
      : []

    const extraBlocks = index === 0 ? [...fileBlocks, ...msgFileBlocks] : msgFileBlocks

    if (extraBlocks.length > 0) {
      return { role: 'user', content: [{ type: 'text' as const, text }, ...extraBlocks] }
    }

    return { role: 'user', content: text }
  })
}

// ── Judge-specific message builder ───────────────────────────────────────────

function buildJudgeApiMessages(
  allMessages: DiscussionMessage[],
  currentRound: number,
  judgeProvider: string,
): ApiMessage[] {
  const relevantMessages = allMessages.filter(
    (msg) => msg.provider !== judgeProvider || msg.messageType === 'judge-evaluation',
  )
  const recent = relevantMessages.slice(-20)

  if (recent.length === 0) {
    return [{ role: 'user', content: `Please evaluate the debate for round ${currentRound}.` }]
  }

  const messages: ApiMessage[] = recent.map((msg) => {
    if (msg.provider === judgeProvider) {
      return { role: 'assistant', content: msg.content }
    }
    const label = msg.provider === 'user'
      ? 'User'
      : (DEBATE_PROVIDER_LABELS[msg.provider] || msg.provider)
    return {
      role: 'user',
      content: `[${label}] (Round ${msg.round}): ${msg.content}`,
    }
  })

  messages.push({
    role: 'user',
    content: `Based on the debate above, please evaluate round ${currentRound}.`,
  })

  return messages
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function doPacing(
  config: DiscussionConfig,
  callbacks: DebateCallbacks,
  signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted) return false

  if (config.pacingMode === 'manual') {
    callbacks.onCountdownTick(-1)
    await callbacks.waitForNextTurn()
    if (signal.aborted) return false
    if (callbacks.getStatus() !== 'running') return false
    callbacks.onCountdownTick(0)
  } else {
    const totalSeconds = config.autoDelay
    for (let s = totalSeconds; s > 0; s--) {
      if (signal.aborted) return false
      while (callbacks.getStatus() === 'paused') {
        await sleep(500)
        if (signal.aborted) return false
      }
      if (callbacks.getStatus() !== 'running') return false
      callbacks.onCountdownTick(s)
      await sleep(1000)
    }
    callbacks.onCountdownTick(0)
  }

  return true
}

async function waitWhilePaused(
  callbacks: DebateCallbacks,
  signal: AbortSignal,
): Promise<boolean> {
  while (callbacks.getStatus() === 'paused') {
    await sleep(500)
    if (signal.aborted) return false
  }
  return callbacks.getStatus() === 'running'
}

// ── Call provider via STRATA SYNC's streaming providers ────────────────────

async function callDebateProvider(
  persona: string,
  systemPrompt: string,
  apiMessages: ApiMessage[],
  signal: AbortSignal,
): Promise<{ content: string; isError: boolean }> {
  if (signal.aborted) {
    return { content: 'Request cancelled.', isError: true }
  }

  // Resolve model: persona-based lookup first, then provider-based default fallback
  const { personaModels } = useSettingsStore.getState()
  const model =
    (personaModels as Record<string, string>)[persona] ??
    DEFAULT_DEBATE_MODELS[persona]
  if (!model) {
    return { content: `Model not found: ${persona}`, isError: true }
  }

  // Derive provider from model ID; fall back to treating persona as a raw provider ID
  const provider: ProviderId =
    getProviderForModel(model) ?? (persona as ProviderId)

  const apiKey = getApiKey(provider)
  if (!apiKey) {
    const label = DEBATE_PROVIDER_LABELS[persona] || persona
    return { content: `[${label}] API key is not configured.`, isError: true }
  }

  // Convert ApiMessage[] to simple {role, content: string}[] for the streaming providers
  const simpleMessages = apiMessages.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: typeof m.content === 'string'
      ? m.content
      : (m.content as ContentPart[])
          .map((p) => p.type === 'text' ? p.text : '[Image attachment]')
          .join('\n'),
  }))

  let fullContent = ''

  try {
    switch (provider) {
      case 'anthropic': {
        const { streamCompletion } = await import('./providers/anthropic')
        await streamCompletion(apiKey, model, systemPrompt, simpleMessages, (chunk) => {
          if (!signal.aborted) fullContent += chunk
        })
        break
      }
      case 'openai': {
        const { streamCompletion } = await import('./providers/openai')
        await streamCompletion(apiKey, model, systemPrompt, simpleMessages, (chunk) => {
          if (!signal.aborted) fullContent += chunk
        })
        break
      }
      case 'gemini': {
        const { streamCompletion } = await import('./providers/gemini')
        await streamCompletion(apiKey, model, systemPrompt, simpleMessages, (chunk) => {
          if (!signal.aborted) fullContent += chunk
        })
        break
      }
      case 'grok': {
        const { streamCompletion } = await import('./providers/grok')
        await streamCompletion(apiKey, model, systemPrompt, simpleMessages, (chunk) => {
          if (!signal.aborted) fullContent += chunk
        })
        break
      }
      default:
        return { content: `Unsupported provider: ${provider}`, isError: true }
    }

    if (signal.aborted) {
      return { content: 'Request cancelled.', isError: true }
    }

    return { content: fullContent, isError: false }
  } catch (err) {
    if (signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
      return { content: 'Request cancelled.', isError: true }
    }
    const message = err instanceof Error ? err.message : 'An unknown error occurred.'
    return { content: message, isError: true }
  }
}

// ── Main Debate Engine ────────────────────────────────────────────────────────

export async function runDebate(
  config: DiscussionConfig,
  callbacks: DebateCallbacks,
  signal: AbortSignal,
): Promise<void> {
  let consecutiveErrors = 0
  const providersFirstCallDone = new Set<string>()

  const isBattleMode = config.mode === 'battle' && !!config.judgeProvider
  const turnParticipants = isBattleMode
    ? config.selectedProviders.filter((p: string) => p !== config.judgeProvider)
    : config.selectedProviders

  const getRoleName = (provider: string): string | undefined => {
    if (config.mode === 'battle' && config.judgeProvider === provider) return 'Judge'
    if (config.mode === 'roleAssignment' || config.mode === 'battle') {
      const rc = config.roles.find((r) => r.provider === provider)
      if (rc?.role && rc.role !== 'Neutral') return rc.role
    }
    return undefined
  }

  callbacks.onStatusChange('running')

  for (let round = 1; round <= config.maxRounds; round++) {
    // ── Debater turns ──
    for (let turnIndex = 0; turnIndex < turnParticipants.length; turnIndex++) {
      if (signal.aborted) return
      if (!await waitWhilePaused(callbacks, signal)) return

      const provider = turnParticipants[turnIndex]!

      callbacks.onRoundChange(round, turnIndex)
      callbacks.onLoadingChange(provider)

      const isFirstCall = !providersFirstCallDone.has(provider)
      const systemPrompt = buildSystemPrompt(config, provider)
      const apiMessages = buildApiMessages(
        callbacks.getMessages(),
        provider,
        config.referenceFiles,
        isFirstCall,
      )

      const response = await callDebateProvider(provider, systemPrompt, apiMessages, signal)

      if (signal.aborted) return
      callbacks.onLoadingChange(null)

      const message: DiscussionMessage = {
        id: generateId(),
        provider: provider as DiscussionParticipantId,
        content: response.content,
        round,
        timestamp: Date.now(),
        error: response.isError ? response.content : undefined,
        roleName: getRoleName(provider),
      }

      callbacks.onMessage(message)

      if (!response.isError) {
        providersFirstCallDone.add(provider)
      }

      if (response.isError) {
        consecutiveErrors++
        if (consecutiveErrors >= 2) {
          callbacks.onStatusChange('paused')
          if (!await waitWhilePaused(callbacks, signal)) return
          consecutiveErrors = 0
        }
      } else {
        consecutiveErrors = 0
      }

      if (!await doPacing(config, callbacks, signal)) return
    }

    // ── Judge turn (battle mode only) ──
    if (isBattleMode && config.judgeProvider) {
      if (signal.aborted) return
      if (!await waitWhilePaused(callbacks, signal)) return

      const judgeProvider = config.judgeProvider

      callbacks.onLoadingChange(judgeProvider)

      const judgeSystemPrompt = buildSystemPrompt(config, judgeProvider)
      const judgeMessages = buildJudgeApiMessages(
        callbacks.getMessages(),
        round,
        judgeProvider,
      )

      const judgeResponse = await callDebateProvider(judgeProvider, judgeSystemPrompt, judgeMessages, signal)

      if (signal.aborted) return
      callbacks.onLoadingChange(null)

      const judgeMessage: DiscussionMessage = {
        id: generateId(),
        provider: judgeProvider as DiscussionParticipantId,
        content: judgeResponse.content,
        round,
        timestamp: Date.now(),
        error: judgeResponse.isError ? judgeResponse.content : undefined,
        messageType: 'judge-evaluation',
        roleName: 'Judge',
      }

      callbacks.onMessage(judgeMessage)

      if (!judgeResponse.isError) {
        providersFirstCallDone.add(judgeProvider)
      }

      if (judgeResponse.isError) {
        consecutiveErrors++
        if (consecutiveErrors >= 2) {
          callbacks.onStatusChange('paused')
          if (!await waitWhilePaused(callbacks, signal)) return
          consecutiveErrors = 0
        }
      } else {
        consecutiveErrors = 0
      }

      if (!await doPacing(config, callbacks, signal)) return
    }
  }

  callbacks.onLoadingChange(null)
  callbacks.onStatusChange('completed')
}
