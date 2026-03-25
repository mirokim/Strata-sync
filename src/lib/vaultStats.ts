import type { LoadedDocument } from '@/types'

export interface VaultStats {
  total: number
  stubCount: number
  thinCount: number
  noLinkCount: number
  archiveCount: number
  hasCurrentSituation: boolean
}

/** Returns the body character count (frontmatter + H1 + source lines stripped, whitespace removed). */
export function calcBodyCharCount(content: string): number {
  let text = content
  if (text.startsWith('---')) {
    const end = text.indexOf('\n---\n', 4)
    text = end !== -1 ? text.slice(end + 5) : text
  }
  text = text.replace(/^#\s+.+/gm, '').replace(/^>\s*Source\s*:.*/gm, '').replace(/\s+/g, '')
  return text.length
}

export function hasImageOrTable(content: string): boolean {
  return /!\[\[[^\]]+\]\]/.test(content) || /^\|.+\|/m.test(content)
}

export function hasWikiLink(content: string): boolean {
  return /\[\[.+?\]\]/.test(content)
}

export function computeStats(docs: LoadedDocument[]): VaultStats {
  let stubCount = 0, thinCount = 0, noLinkCount = 0, archiveCount = 0
  let hasCurrentSituation = false

  for (const doc of docs) {
    if (doc.id.startsWith('img:')) continue
    const content = doc.rawContent ?? ''
    const chars = calcBodyCharCount(content)
    const hasMedia = hasImageOrTable(content)
    if (chars < 50 && !hasMedia) stubCount++
    else if (chars < 300 && !hasMedia) thinCount++
    if (!hasWikiLink(content)) noLinkCount++
    if (doc.folderPath?.includes('archive') || doc.absolutePath?.includes('archive')) archiveCount++
    if (doc.filename.toLowerCase().includes('currentsituation')) hasCurrentSituation = true
  }

  return {
    total: docs.filter(d => !d.id.startsWith('img:')).length,
    stubCount, thinCount, noLinkCount, archiveCount, hasCurrentSituation,
  }
}
