/**
 * markdownParser.ts — Phase 6
 *
 * Pure functions that convert VaultFile → LoadedDocument.
 * No side effects, fully testable without Electron.
 */

import matter from 'gray-matter'
import type { VaultFile, LoadedDocument, DocSection, SpeakerId } from '@/types'
import { logger } from '@/lib/logger'
import { slugify, extractWikiLinks, extractImageRefs } from '@/lib/utils'

// ── Valid speaker IDs for validation ──────────────────────────────────────────

const VALID_SPEAKERS: Set<string> = new Set([
  'chief_director',
  'art_director',
  'plan_director',
  'level_director',
  'prog_director',
])

/** Short-form aliases → canonical speaker ID */
const SPEAKER_ALIASES: Record<string, string> = {
  chief:  'chief_director',
  art:    'art_director',
  plan:   'plan_director',
  design: 'plan_director',
  level:  'level_director',
  prog:   'prog_director',
  tech:   'prog_director',
}

// ── filePathToDocId ────────────────────────────────────────────────────────────

/**
 * Convert a vault-relative file path to a stable document ID.
 *
 * "subdir/my note.md" → "subdir_my_note"
 * "README.md"         → "readme"
 */
export function filePathToDocId(relativePath: string): string {
  return relativePath
    .replace(/\.md$/i, '')  // strip .md extension
    .replace(/[\\/]/g, '_') // path separators → _
    .replace(/\s+/g, '_')   // spaces → _
    .replace(/[^a-z0-9_가-힣]/gi, '')  // remove special chars (keep Korean)
    .toLowerCase()
    .replace(/^_+|_+$/g, '') // trim leading/trailing _
    || 'unnamed'
}

// ── parseSections ─────────────────────────────────────────────────────────────

/**
 * Split markdown body (without frontmatter) into DocSection[]
 * based on `## ` headings.
 *
 * - If no headings found: single section with id `${docId}_intro`
 * - Slug collision: append `_2`, `_3`, ...
 */
export function parseSections(content: string, docId: string): DocSection[] {
  // Split on lines starting with ## (H2 headings)
  const headingRe = /^##\s+(.+)$/m
  const parts = content.split(/^(?=##\s)/m)

  if (parts.length === 1 || !headingRe.test(content)) {
    // No ## headings — single "intro" section
    const body = content.trim()
    return [{
      id: `${docId}_intro`,
      heading: '(intro)',
      body,
      wikiLinks: extractWikiLinks(body),
    }]
  }

  const sections: DocSection[] = []
  const usedSlugs = new Map<string, number>()

  for (const part of parts) {
    const lines = part.split('\n')
    const headingLine = lines[0] ?? ''
    const headingMatch = headingLine.match(/^##\s+(.+)$/)

    if (!headingMatch) {
      // Text before the first ## heading — attach as intro section
      const body = part.trim()
      if (body) {
        sections.push({
          id: `${docId}_intro`,
          heading: '(intro)',
          body,
          wikiLinks: extractWikiLinks(body),
        })
      }
      continue
    }

    const headingText = headingMatch[1].trim()
    const baseSlug = `${docId}_${slugify(headingText)}` || `${docId}_section`
    const count = usedSlugs.get(baseSlug) ?? 0
    usedSlugs.set(baseSlug, count + 1)
    const id = count === 0 ? baseSlug : `${baseSlug}_${count + 1}`

    const body = lines.slice(1).join('\n').trim()
    sections.push({
      id,
      heading: headingText,
      body,
      wikiLinks: extractWikiLinks(body),
    })
  }

  return sections.length > 0 ? sections : [{
    id: `${docId}_intro`,
    heading: '(intro)',
    body: content.trim(),
    wikiLinks: extractWikiLinks(content),
  }]
}

// ── parseMarkdownFile ─────────────────────────────────────────────────────────

/**
 * Convert a single VaultFile to a LoadedDocument.
 *
 * Frontmatter fields:
 *   speaker: string  → validated against VALID_SPEAKERS; fallback 'unknown'
 *   date:    any     → normalised to "YYYY-MM-DD"; fallback ""
 *   tags:    string[] → default []
 *   links:   string[] → default []
 */
export function parseMarkdownFile(file: VaultFile): LoadedDocument {
  const { data, content: body } = matter(file.content)

  // ── speaker ────────────────────────────────────────────────────────────────
  const rawSpeaker = typeof data.speaker === 'string' ? data.speaker.trim().toLowerCase() : ''
  const speaker: SpeakerId = VALID_SPEAKERS.has(rawSpeaker)
    ? (rawSpeaker as SpeakerId)
    : rawSpeaker in SPEAKER_ALIASES
      ? (SPEAKER_ALIASES[rawSpeaker] as SpeakerId)
      : 'unknown'

  // ── date ───────────────────────────────────────────────────────────────────
  let date = ''
  if (data.date instanceof Date) {
    // gray-matter parses YAML dates as Date objects
    date = data.date.toISOString().slice(0, 10)
  } else if (typeof data.date === 'string') {
    date = data.date.trim()
  }

  // ── tags ───────────────────────────────────────────────────────────────────
  const tags: string[] = Array.isArray(data.tags)
    ? data.tags.map(String)
    : typeof data.tags === 'string'
    ? data.tags.split(',').map((t: string) => t.trim()).filter(Boolean)
    : []

  // ── links (top-level wiki-link references) ─────────────────────────────────
  const links: string[] = Array.isArray(data.links)
    ? data.links.map(String)
    : []

  const docId = filePathToDocId(file.relativePath)
  const sections = parseSections(body, docId)

  // Extract folder path from relativePath (e.g. "Onion Flow/node_system.md" → "Onion Flow")
  const pathParts = file.relativePath.split(/[\\/]/)
  const folderPath = pathParts.length > 1 ? pathParts.slice(0, -1).join('/') : ''

  // Collect ![[image.png]] refs from all sections
  const allImageRefs = new Set<string>()
  for (const section of sections) {
    for (const ref of extractImageRefs(section.body)) {
      allImageRefs.add(ref)
    }
  }
  // Also check frontmatter body (before sections) in raw content
  for (const ref of extractImageRefs(body)) {
    allImageRefs.add(ref)
  }

  return {
    id: docId,
    filename: pathParts[pathParts.length - 1] ?? file.relativePath,
    folderPath,
    absolutePath: file.absolutePath,
    speaker,
    date,
    mtime: file.mtime,
    tags,
    links,
    sections,
    rawContent: file.content,
    imageRefs: allImageRefs.size > 0 ? [...allImageRefs] : undefined,
  }
}

// ── parseVaultFiles ───────────────────────────────────────────────────────────

/**
 * Resolve ID collision: if doc.id already exists in seenIds, append _2, _3, …
 * Mutates `results` and `seenIds` as a side effect, returns the final doc.
 */
function pushWithUniqueId(
  doc: LoadedDocument,
  relativePath: string,
  results: LoadedDocument[],
  seenIds: Set<string>,
): void {
  if (seenIds.has(doc.id)) {
    let n = 2
    while (seenIds.has(`${doc.id}_${n}`)) n++
    const newId = `${doc.id}_${n}`
    logger.warn(`[markdownParser] ID collision: "${doc.id}" (${relativePath}) → "${newId}"`)
    results.push({ ...doc, id: newId })
    seenIds.add(newId)
  } else {
    seenIds.add(doc.id)
    results.push(doc)
  }
}

/**
 * Batch-parse an array of VaultFiles into LoadedDocuments.
 * Skips files that fail to parse (with a console.warn).
 */
export function parseVaultFiles(files: VaultFile[]): LoadedDocument[] {
  const results: LoadedDocument[] = []
  const seenIds = new Set<string>()
  for (const file of files) {
    try {
      pushWithUniqueId(parseMarkdownFile(file), file.relativePath, results, seenIds)
    } catch (err) {
      logger.warn(`[markdownParser] Failed to parse ${file.relativePath}:`, err)
    }
  }
  return results
}

// ── parseVaultFilesAsync ──────────────────────────────────────────────────────

/** Number of files parsed per chunk before yielding to the event loop. */
const PARSE_CHUNK = 10

/**
 * Async version of parseVaultFiles that yields to the event loop every
 * PARSE_CHUNK files, allowing the UI (e.g. a loading progress bar) to update
 * during parsing.
 *
 * @param onProgress  Called after each chunk: (parsed, total)
 */
export async function parseVaultFilesAsync(
  files: VaultFile[],
  onProgress?: (parsed: number, total: number) => void,
): Promise<LoadedDocument[]> {
  const results: LoadedDocument[] = []
  const seenIds = new Set<string>()
  const total = files.length

  for (let i = 0; i < total; i++) {
    const file = files[i]
    try {
      pushWithUniqueId(parseMarkdownFile(file), file.relativePath, results, seenIds)
    } catch (err) {
      logger.warn(`[markdownParser] Failed to parse ${file.relativePath}:`, err)
    }

    // Yield to the event loop every PARSE_CHUNK files so the UI can repaint
    if ((i + 1) % PARSE_CHUNK === 0 || i === total - 1) {
      onProgress?.(i + 1, total)
      await new Promise<void>(r => setTimeout(r, 0))
    }
  }

  return results
}
