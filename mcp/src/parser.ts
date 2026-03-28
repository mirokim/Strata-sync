/**
 * Standalone markdown parser for MCP server.
 * Self-contained version of src/lib/markdownParser.ts — no @/ imports.
 */
import matter from 'gray-matter'

// ── Types (mirrored from src/types) ──────────────────────────────────────────

export type SpeakerId = 'chief_director' | 'art_director' | 'plan_director' | 'level_director' | 'prog_director' | 'unknown'

export interface DocSection {
  id: string
  heading: string
  body: string
  wikiLinks: string[]
}

export interface LoadedDocument {
  id: string
  filename: string
  folderPath: string
  absolutePath: string
  speaker: SpeakerId
  date: string
  mtime?: number
  tags: string[]
  links: string[]
  sections: DocSection[]
  rawContent: string
  imageRefs?: string[]
  source?: string
  origin?: string
  title?: string
  type?: string
  status?: string
  supersededBy?: string
  related?: string[]
  graphWeight?: 'normal' | 'low' | 'skip'
  vaultLabel?: string
}

export interface VaultFile {
  relativePath: string
  absolutePath: string
  content: string
  mtime?: number
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_가-힣]/g, '')
}

function extractWikiLinks(text: string): string[] {
  const matches = text.match(/(?<!!)\[\[(.*?)\]\]/gs) ?? []
  return matches.map(m => m.slice(2, -2).trim())
}

function extractImageRefs(text: string): string[] {
  const matches = text.match(/!\[\[([^\]]+)\]\]/g) ?? []
  return [...new Set(matches.map(m => m.slice(3, -2).trim()))]
}

function filePathToDocId(relativePath: string): string {
  return relativePath
    .replace(/\.md$/i, '')
    .replace(/[\\/]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_가-힣]/gi, '')
    .toLowerCase()
    .replace(/^_+|_+$/g, '')
    || 'unnamed'
}

// ── Speakers ─────────────────────────────────────────────────────────────────

const VALID_SPEAKERS = new Set(['chief_director', 'art_director', 'plan_director', 'level_director', 'prog_director'])
const SPEAKER_ALIASES: Record<string, string> = {
  chief: 'chief_director', art: 'art_director', plan: 'plan_director',
  design: 'plan_director', level: 'level_director', prog: 'prog_director', tech: 'prog_director',
}

// ── Section parser ───────────────────────────────────────────────────────────

function parseSections(content: string, docId: string): DocSection[] {
  const headingRe = /^##\s+(.+)$/m
  const parts = content.split(/^(?=##\s)/m)

  if (parts.length === 1 || !headingRe.test(content)) {
    const body = content.trim()
    return [{ id: `${docId}_intro`, heading: '(intro)', body, wikiLinks: extractWikiLinks(body) }]
  }

  const sections: DocSection[] = []
  const usedSlugs = new Map<string, number>()

  for (const part of parts) {
    const lines = part.split('\n')
    const headingMatch = (lines[0] ?? '').match(/^##\s+(.+)$/)

    if (!headingMatch) {
      const body = part.trim()
      if (body) sections.push({ id: `${docId}_intro`, heading: '(intro)', body, wikiLinks: extractWikiLinks(body) })
      continue
    }

    const headingText = headingMatch[1].trim()
    const baseSlug = `${docId}_${slugify(headingText)}` || `${docId}_section`
    const count = usedSlugs.get(baseSlug) ?? 0
    usedSlugs.set(baseSlug, count + 1)
    const id = count === 0 ? baseSlug : `${baseSlug}_${count + 1}`
    const body = lines.slice(1).join('\n').trim()
    sections.push({ id, heading: headingText, body, wikiLinks: extractWikiLinks(body) })
  }

  return sections.length > 0 ? sections : [{ id: `${docId}_intro`, heading: '(intro)', body: content.trim(), wikiLinks: extractWikiLinks(content) }]
}

// ── Main parser ──────────────────────────────────────────────────────────────

export function parseVaultFile(file: VaultFile): LoadedDocument {
  const { data, content: body } = matter(file.content)

  const rawSpeaker = typeof data.speaker === 'string' ? data.speaker.trim().toLowerCase() : ''
  const speaker: SpeakerId = VALID_SPEAKERS.has(rawSpeaker)
    ? (rawSpeaker as SpeakerId)
    : rawSpeaker in SPEAKER_ALIASES ? (SPEAKER_ALIASES[rawSpeaker] as SpeakerId) : 'unknown'

  let date = ''
  if (data.date instanceof Date) date = data.date.toISOString().slice(0, 10)
  else if (typeof data.date === 'string') date = data.date.trim()

  const tags: string[] = Array.isArray(data.tags) ? data.tags.map(String) :
    typeof data.tags === 'string' ? data.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : []

  const links: string[] = Array.isArray(data.links) ? data.links.map(String) : []

  const source = typeof data.source === 'string' ? data.source.trim() : undefined
  const origin = typeof data.origin === 'string' ? data.origin.trim() : undefined
  const title = typeof data.title === 'string' ? data.title.trim() : undefined
  const type = typeof data.type === 'string' ? data.type.trim().toLowerCase() : undefined
  const status = typeof data.status === 'string' ? data.status.trim().toLowerCase() : undefined
  const supersededBy = typeof data.superseded_by === 'string' ? data.superseded_by.trim() : undefined

  const related: string[] = Array.isArray(data.related) ? data.related.map((r: unknown) => String(r).trim()).filter(Boolean) :
    typeof data.related === 'string' ? data.related.split(',').map((s: string) => s.trim()).filter(Boolean) : []

  const rawGW = typeof data.graph_weight === 'string' ? data.graph_weight.trim().toLowerCase() : ''
  const graphWeight = (rawGW === 'low' || rawGW === 'skip') ? rawGW as 'low' | 'skip' : undefined

  const docId = filePathToDocId(file.relativePath)
  const sections = parseSections(body, docId)
  const pathParts = file.relativePath.split(/[\\/]/)
  const folderPath = pathParts.length > 1 ? pathParts.slice(0, -1).join('/') : ''

  const allImageRefs = new Set<string>()
  for (const s of sections) for (const ref of extractImageRefs(s.body)) allImageRefs.add(ref)
  for (const ref of extractImageRefs(body)) allImageRefs.add(ref)

  return {
    id: docId, filename: pathParts[pathParts.length - 1] ?? file.relativePath,
    folderPath, absolutePath: file.absolutePath, speaker, date, mtime: file.mtime,
    tags, links, sections, rawContent: file.content,
    imageRefs: allImageRefs.size > 0 ? [...allImageRefs] : undefined,
    source, origin, title, type, status, supersededBy,
    related: related.length > 0 ? related : undefined, graphWeight,
  }
}
