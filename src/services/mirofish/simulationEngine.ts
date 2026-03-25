/**
 * simulationEngine.ts — OASIS-based MiroFish core simulation loop
 *
 * Combines LocalZep + SocialGraph + OASISEnvironment to run the
 * OASIS social simulation pipeline in pure TypeScript.
 *
 * Components:
 *   LocalZepClient    — Agent memory (local replacement for Zep Cloud)
 *   SocialGraph       — Barabasi-Albert follow network
 *   OASISEnvironment  — Post store + recommendation engine + action decisions
 */

import { getProviderForModel, MODEL_OPTIONS } from '@/lib/modelConfig'
import { getApiKey } from '@/stores/settingsStore'
import { LocalZepClient } from './localZep'
import { SocialGraph } from './socialGraph'
import { OASISEnvironment } from './oasisEnvironment'
import type { OASISPost } from './oasisEnvironment'
import type { MirofishPersona, MirofishPost, MirofishSimulationConfig } from './types'
import type { Attachment } from '@/types'

export interface SimulationProgressEvent {
  type: 'post-start' | 'post-chunk' | 'post-done' | 'round-done'
  round?: number
  personaId?: string
  personaName?: string
  stance?: MirofishPersona['stance']
  chunk?: string
  post?: MirofishPost
}

/**
 * Dynamic delay calculation based on persona count x round count.
 * Increases interval for larger simulations to prevent rate limiting.
 * Applies average activityLevel of 0.65, target max 40 RPM.
 */
function calcCallDelay(numPersonas: number, numRounds: number): number {
  const total = numPersonas * numRounds * 0.65
  if (total <= 15)  return 200    // Small: 200ms (~18 RPM or less)
  if (total <= 40)  return 600    // Medium: 600ms (~6 RPM or less)
  if (total <= 100) return 1200   // Large: 1.2s (~3 RPM or less)
  return 1500                     // Extra-large: 1.5s (40 RPM cap)
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

// ── Prompt builder ─────────────────────────────────────────────────────────────

function buildPersonaPrompt(
  persona: MirofishPersona,
  topic: string,
  memoryContext: string,
  recommendedPosts: OASISPost[],
  round: number,
  context?: string,
  actionType: 'post' | 'repost' = 'post',
  repostTarget?: OASISPost,
): { system: string; user: string } {
  const ctxBlock  = context       ? `\n\n[Background Info — only mention what is explicitly in the documents below. Do not fabricate features or systems not in the documents]\n${context}` : ''
  const memBlock  = memoryContext ? `\n\n[My Previous Statements]\n${memoryContext}` : ''

  const feedCtx = recommendedPosts.length
    ? recommendedPosts.slice(-8).map(p =>
        `[${p.authorName}${p.originalPostId ? ' repost' : ''}] ${p.content}`
      ).join('\n')
    : '(No posts yet)'

  const actionInstruction = actionType === 'repost' && repostTarget
    ? (
        `Repost the following post with a brief 1-2 sentence comment:\n` +
        `"${repostTarget.content}" — ${repostTarget.authorName}`
      )
    : (
        `Based on the discussion above, write a new post from your perspective in 2-3 sentences. ` +
        `If there are specific opinions in the feed, reference or quote them using "@name" format. ` +
        `Engage naturally — debate or express agreement.\n\n` +
        `You MUST add an intensity tag at the beginning: "[intensity:1]"(mild) ~ "[intensity:5]"(very intense).\n` +
        `If another participant's compelling argument changed your stance, ` +
        `add one of "[stance_shift:supportive]", "[stance_shift:opposing]", "[stance_shift:neutral]" after the intensity tag. ` +
        `Do not add a stance_shift tag if your stance remains the same.`
      )

  return {
    system: persona.systemPrompt,
    user:
      `Topic: "${topic}"${ctxBlock}${memBlock}\n\n` +
      `Current round: ${round}\n\n` +
      `[Following Feed + Trending]\n${feedCtx}\n\n` +
      actionInstruction,
  }
}

// ── Main simulation loop ──────────────────────────────────────────────────────

export async function runSimulation(
  config: MirofishSimulationConfig,
  onEvent: (event: SimulationProgressEvent) => void,
  signal: AbortSignal,
): Promise<MirofishPost[]> {
  const { topic, numRounds, modelId, context } = config
  // Deep copy to avoid mutating original config.personas
  const personas = config.personas.slice(0, config.numPersonas).map(p => ({ ...p }))

  // Convert direct-pass images to Attachment array (streamCompletion format)
  const imageAttachments: Attachment[] = (config.images ?? []).map((img, i) => ({
    id: `sim-img-${i}`,
    name: `image-${i}`,
    type: 'image' as const,
    mimeType: img.mediaType,
    dataUrl: `data:${img.mediaType};base64,${img.data}`,
    size: Math.round(img.data.length * 0.75), // base64 -> byte approximation
  }))

  // ── Initialize OASIS components ──────────────────────────────────────────
  const callDelayMs = calcCallDelay(personas.length, numRounds)
  const zep   = new LocalZepClient()
  const graph = SocialGraph.generate(personas.map(p => p.id))
  const env   = new OASISEnvironment(graph)

  const provider = getProviderForModel(modelId)
  const apiKey   = provider ? getApiKey(provider) : null
  const model    = MODEL_OPTIONS.find(m => m.id === modelId)

  const feed: MirofishPost[] = []

  for (let round = 1; round <= numRounds; round++) {
    if (signal.aborted) break

    // All personas respond each round — full feed generation for user-specified count
    const activePersonas = personas.filter(p => !signal.aborted)

    for (const persona of activePersonas) {
      if (signal.aborted) break

      // ── Action decision (OASIS action_space) ──────────────────────────────
      const decision = env.decideAction(persona.id)

      if (decision.action === 'do_nothing') continue

      if (decision.action === 'like' && decision.targetPostId) {
        env.likePost(persona.id, decision.targetPostId)
        const liked = env.getPost(decision.targetPostId)
        if (liked) {
          await zep.add(persona.id, [{
            role: 'user',
            content: `[Liked] ${liked.authorName}: ${liked.content.slice(0, 80)}`,
          }])
        }
        continue
      }

      if (decision.action === 'follow' && decision.targetAgentId) {
        graph.follow(persona.id, decision.targetAgentId)
        continue
      }

      // ── post / repost -> LLM streaming call ─────────────────────────────
      const memory      = await zep.get(persona.id)
      const recommended = env.getRecommendedPosts(persona.id)
      const repostTarget = decision.action === 'repost' && decision.targetPostId
        ? env.getPost(decision.targetPostId)
        : undefined

      onEvent({
        type: 'post-start', round,
        personaId: persona.id, personaName: persona.name, stance: persona.stance,
      })

      let content = ''

      if (apiKey && model && provider) {
        const { system, user } = buildPersonaPrompt(
          persona, topic, memory.context, recommended, round,
          context, decision.action as 'post' | 'repost', repostTarget,
        )
        const messages = [{ role: 'user' as const, content: user }]

        // Wrap onEvent callback to prevent exceptions from interrupting streamCompletion
        const safeChunk = (chunk: string) => {
          content += chunk
          try { onEvent({ type: 'post-chunk', personaId: persona.id, chunk }) } catch { /* ignore UI callback errors */ }
        }

        try {
          switch (model.provider) {
            case 'anthropic': {
              const { streamCompletion } = await import('../providers/anthropic')
              await streamCompletion(apiKey, modelId, system, messages, safeChunk, imageAttachments)
              break
            }
            case 'openai': {
              const { streamCompletion } = await import('../providers/openai')
              await streamCompletion(apiKey, modelId, system, messages, safeChunk, imageAttachments)
              break
            }
            case 'gemini': {
              const { streamCompletion } = await import('../providers/gemini')
              await streamCompletion(apiKey, modelId, system, messages, safeChunk, imageAttachments)
              break
            }
            case 'grok': {
              const { streamCompletion } = await import('../providers/grok')
              await streamCompletion(apiKey, modelId, system, messages, safeChunk)
              break
            }
            default:
              content = `[${persona.name}'s simulation response — API key required]`
          }
        } catch (err) {
          console.error(`[simulationEngine] ${persona.name} LLM error:`, err)
          content = `(Error: ${err instanceof Error ? err.message : 'unknown error'})`
        }
      } else {
        content = '[Cannot run simulation without API key]'
      }

      // ── Parse emotion intensity ────────────────────────────────────────
      let intensity: number | undefined
      const intensityMatch = content.match(/\[intensity:([1-5])\]/i)
      if (intensityMatch) {
        intensity = parseInt(intensityMatch[1], 10)
        content = content.replace(intensityMatch[0], '').trim()
      }

      // ── Detect stance evolution ─────────────────────────────────────────
      // If LLM included a [stance_shift:xxx] tag, update persona.stance
      const VALID_STANCES = ['supportive', 'opposing', 'neutral', 'observer'] as const
      type StanceType = typeof VALID_STANCES[number]
      let stanceShifted = false
      let prevStance: StanceType | undefined
      const stanceTagMatch = content.match(/\[stance_shift:(supportive|opposing|neutral|observer)\]/i)
      if (stanceTagMatch) {
        const newStance = stanceTagMatch[1].toLowerCase() as StanceType
        if (newStance !== persona.stance) {
          prevStance = persona.stance as StanceType
          persona.stance = newStance
          stanceShifted = true
        }
        // Remove the tag from content
        content = content.replace(stanceTagMatch[0], '').trim()
      }

      // ── Update environment ──────────────────────────────────────────────
      // Trim feed item length: max 280 chars, cut at sentence boundary
      let trimmed = content.trim()
      if (trimmed.length > 280) {
        const cut = trimmed.slice(0, 280)
        const lastPunct = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf('!'), cut.lastIndexOf('?'))
        trimmed = lastPunct > 100 ? cut.slice(0, lastPunct + 1) : cut.trimEnd() + '...'
      }
      const oasisPost = env.addPost(
        persona.id, persona.name, persona.stance,
        trimmed, round, repostTarget?.id,
        persona.influenceWeight ?? 0.5,
      )
      if (decision.action === 'repost' && repostTarget) {
        oasisPost.reposts.add(persona.id)
        repostTarget.reposts.add(persona.id)
      }

      // Update Zep memory
      await zep.add(persona.id, [{ role: 'assistant', content: trimmed }])

      const post: MirofishPost = {
        round,
        personaId:      persona.id,
        personaName:    persona.name,
        stance:         persona.stance,
        ...(stanceShifted && { stanceShifted: true, prevStance }),
        content:        trimmed,
        ...(intensity !== undefined && { intensity }),
        timestamp:      oasisPost.timestamp,
        postId:         oasisPost.id,
        actionType:     decision.action,
        originalPostId: repostTarget?.id,
        likes:          0,
        reposts:        0,
      }
      feed.push(post)
      onEvent({ type: 'post-done', post })

      if (!signal.aborted) await sleep(callDelayMs)
    }

    // End of round — update likes/repost counts
    for (const post of feed) {
      const oasisPost = post.postId ? env.getPost(post.postId) : undefined
      if (oasisPost) {
        post.likes   = oasisPost.likes.size
        post.reposts = oasisPost.reposts.size
      }
    }

    onEvent({ type: 'round-done', round })
  }

  return feed
}
