/**
 * reportGenerator.ts — Analyze simulation feed and generate a markdown report
 */

import { getProviderForModel, MODEL_OPTIONS } from '@/lib/modelConfig'
import { getApiKey } from '@/stores/settingsStore'
import type { MirofishPost } from './types'

const SYSTEM_PROMPT = `
You are an expert in market research and sentiment analysis.
Analyze the simulation feed and produce an insightful report.
Write in a structured markdown format.
`.trim()

function buildReportPrompt(topic: string, feed: MirofishPost[]): string {
  const feedText = feed
    .map(p => {
      const action = p.actionType === 'repost' ? ' [repost]' : ''
      const shift  = p.stanceShifted ? ` [shifted: ${p.prevStance}->${p.stance}]` : ''
      return `[R${p.round}] [${p.personaName}/${p.stance}${shift}]${action} ${p.content}`
    })
    .join('\n')

  // Per-round stance distribution
  const rounds = [...new Set(feed.map(p => p.round))].sort((a, b) => a - b)
  const roundTrend = rounds.map(r => {
    const posts = feed.filter(p => p.round === r)
    const cnt = (s: string) => posts.filter(p => p.stance === s).length
    const total = posts.length
    const pct = (n: number) => total ? Math.round(n / total * 100) : 0
    const sp = cnt('supportive'), op = cnt('opposing'), ne = cnt('neutral'), ob = cnt('observer')
    const shifts = posts.filter(p => p.stanceShifted).length
    return `R${r}: supportive ${sp}(${pct(sp)}%) / opposing ${op}(${pct(op)}%) / neutral ${ne}(${pct(ne)}%) / observer ${ob}(${pct(ob)}%)${shifts ? ` | stance shifts: ${shifts}` : ''}`
  }).join('\n')

  // Engagement metrics
  const engagementMap = new Map<string, { likes: number; reposts: number }>()
  for (const p of feed) {
    if (!engagementMap.has(p.personaName)) {
      engagementMap.set(p.personaName, { likes: 0, reposts: 0 })
    }
    const e = engagementMap.get(p.personaName)!
    e.likes   += p.likes   ?? 0
    e.reposts += p.reposts ?? 0
  }
  const topEngaged = [...engagementMap.entries()]
    .sort((a, b) => (b[1].likes + b[1].reposts) - (a[1].likes + a[1].reposts))
    .slice(0, 10)
    .map(([name, s]) => `- ${name}: likes ${s.likes}, reposts ${s.reposts}`)
    .join('\n') || '(no data)'

  // Stance shift list
  const stanceShifts = feed.filter(p => p.stanceShifted)
    .map(p => `- R${p.round} ${p.personaName}: ${p.prevStance} -> ${p.stance}`)
    .join('\n') || '(none)'

  // Emotion intensity distribution
  const intensityPosts = feed.filter(p => p.intensity !== undefined)
  const avgIntensity = intensityPosts.length
    ? (intensityPosts.reduce((s, p) => s + p.intensity!, 0) / intensityPosts.length).toFixed(1)
    : 'N/A'
  const highIntensity = intensityPosts.filter(p => (p.intensity ?? 0) >= 4)
    .map(p => `- [R${p.round}] ${p.personaName}(intensity ${p.intensity}): ${p.content.slice(0, 60)}...`)
    .slice(0, 5).join('\n') || '(none)'

  return `
Analyze the following OASIS social simulation results and write a report.

Topic: "${topic}"

[Per-Round Sentiment Trend]
${roundTrend}

[Stance Shifts]
${stanceShifts}

[Emotion Intensity]
Average intensity: ${avgIntensity}/5
High-intensity responses (4-5):
${highIntensity}

[Engagement Metrics (Top 10)]
${topEngaged}

[Simulation Feed]
${feedText}

Write a markdown report including these sections:

## Simulation Summary
(Topic, participating personas, total rounds, total posts, etc.)

## Sentiment Trend Analysis
(Per-round supportive/opposing ratio changes, how the mood evolved)

## Key Consensus Points
(Common ground across multiple personas)

## Critical Dissent
(Strongest criticisms or concerns raised)

## Notable Stance Shifts
(Personas who changed stance during the simulation and why — omit if none)

## Conclusions & Implications
(What this simulation means for actual launch/decision-making)
`.trim()
}

export async function generateReport(
  topic: string,
  feed: MirofishPost[],
  modelId: string,
): Promise<string> {
  if (feed.length === 0) return 'No simulation results available.'

  const provider = getProviderForModel(modelId)
  if (!provider) return fallbackReport(topic, feed)

  const apiKey = getApiKey(provider)
  if (!apiKey) return fallbackReport(topic, feed)

  const model = MODEL_OPTIONS.find(m => m.id === modelId)
  if (!model) return fallbackReport(topic, feed)

  const messages = [{ role: 'user' as const, content: buildReportPrompt(topic, feed) }]
  let report = ''

  try {
    switch (model.provider) {
      case 'anthropic': {
        const { streamCompletion } = await import('../providers/anthropic')
        await streamCompletion(apiKey, modelId, SYSTEM_PROMPT, messages, c => { report += c })
        break
      }
      case 'openai': {
        const { streamCompletion } = await import('../providers/openai')
        await streamCompletion(apiKey, modelId, SYSTEM_PROMPT, messages, c => { report += c })
        break
      }
      case 'gemini': {
        const { streamCompletion } = await import('../providers/gemini')
        await streamCompletion(apiKey, modelId, SYSTEM_PROMPT, messages, c => { report += c })
        break
      }
      default:
        return fallbackReport(topic, feed)
    }
    return report || fallbackReport(topic, feed)
  } catch (err) {
    console.error('[reportGenerator] Report generation failed:', err)
    return fallbackReport(topic, feed)
  }
}

function fallbackReport(topic: string, feed: MirofishPost[]): string {
  const byStance = feed.reduce<Record<string, number>>((acc, p) => {
    acc[p.stance] = (acc[p.stance] ?? 0) + 1
    return acc
  }, {})

  const lines = Object.entries(byStance).map(([s, n]) => `- ${s}: ${n}`)

  return `## Simulation Report\n\n**Topic**: ${topic}\n\n**Total responses**: ${feed.length}\n\n**Stance distribution**:\n${lines.join('\n')}`
}
