/**
 * tagService.ts
 *
 * AI 태그 제안: 문서 파일명 + 내용(첫 300자)을 설정된 모델로 분석하여
 * 사용자가 정의한 tagPresets 목록 내에서 적합한 태그를 JSON 배열로 반환한다.
 * 확신이 없으면 빈 배열([])을 반환 → 사이드바에서 "미분류"로 표시됨.
 *
 * 지원 provider: anthropic, openai, gemini, grok
 */

import matter from 'gray-matter'
import type { LoadedDocument } from '@/types'
import { useSettingsStore, getApiKey } from '@/stores/settingsStore'
import { getWorkerModelId } from '@/services/llmClient'

const SYSTEM_PROMPT = `당신은 문서 분류 전문가입니다.
주어진 문서에 대해 제공된 태그 목록 중 적합한 것만 골라 JSON 배열로만 응답하세요.
응답은 반드시 유효한 JSON 배열 형태여야 합니다. 예: ["전투", "스킬"]
확신이 없으면 빈 배열 []을 반환하세요.
설명이나 다른 텍스트는 절대 포함하지 마세요.`

/** provider에 맞는 streamCompletion을 호출하고 전체 응답 문자열을 반환한다. */
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
 * 주어진 문서에 적합한 태그를 AI로 제안한다.
 * tagPresets가 비어있거나 API 키가 없으면 즉시 [] 반환.
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
  const userMessage = `파일명: ${docFilename}
내용 (앞부분):
${contentPreview}

허용 태그 목록: ${tagPresets.join(', ')}

이 문서에 적합한 태그를 위 목록에서만 골라 JSON 배열로 반환하세요.`

  let result = ''
  try {
    result = await callStream(provider, apiKey, modelId, userMessage)
  } catch {
    return []
  }

  // JSON 배열 파싱 + tagPresets에 있는 태그만 필터
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
  { id: 'chief_director',  desc: '총괄 기획/디렉션 문서' },
  { id: 'art_director',    desc: '아트/디자인 관련 문서' },
  { id: 'plan_director',   desc: '기획/레벨 디자인 문서' },
  { id: 'level_director',  desc: '레벨/맵 설계 문서' },
  { id: 'prog_director',   desc: '프로그래밍/기술 문서' },
]

const SPEAKER_SYSTEM = `당신은 문서 담당자 분류 전문가입니다.
주어진 문서에 가장 적합한 담당 역할을 아래 목록에서 하나만 골라 ID만 응답하세요.
목록:
${SPEAKER_OPTIONS.map(s => `- ${s.id}: ${s.desc}`).join('\n')}
응답은 반드시 위 ID 중 하나만, 한 줄로 반환하세요. 설명 없이 ID만.`

/**
 * 문서에 가장 적합한 speaker(페르소나) ID를 AI로 제안한다.
 * 실패 시 null 반환.
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
  const userMessage = `파일명: ${docFilename}\n내용:\n${contentPreview}\n\n가장 적합한 담당 역할 ID를 반환하세요.`

  try {
    const result = await callStream(provider, apiKey, modelId, userMessage, SPEAKER_SYSTEM)
    const speakerId = result.trim().toLowerCase()
    return SPEAKER_OPTIONS.some(s => s.id === speakerId) ? speakerId : null
  } catch {
    return null
  }
}

// YAML frontmatter의 tags 필드를 업데이트한 전체 문자열을 반환한다.
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
 * vault 전체 문서에 AI 태그를 일괄 지정한다.
 * 각 문서마다 suggestTagsForDoc 호출 → 태그가 있으면 frontmatter 업데이트 후 저장.
 * 태그가 없거나 오류 시 해당 문서는 건너뜀 (기존 태그 보존).
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
