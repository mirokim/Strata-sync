/**
 * Parses `[[slug]]` wiki-link syntax from a string.
 * Returns an array of text segments and wiki-link tokens.
 */

export interface TextSegment {
  type: 'text'
  value: string
}

export interface WikiLinkSegment {
  type: 'wikilink'
  slug: string
}

export type ParsedSegment = TextSegment | WikiLinkSegment

const WIKI_LINK_RE = /\[\[(.*?)\]\]/gs

/**
 * Split `text` into plain-text and wiki-link segments.
 * e.g. `"See [[tone_manner_guide]] for details"` →
 *   [{ type: 'text', value: 'See ' },
 *    { type: 'wikilink', slug: 'tone_manner_guide' },
 *    { type: 'text', value: ' for details' }]
 */
export function parseWikiLinks(text: string): ParsedSegment[] {
  const segments: ParsedSegment[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  WIKI_LINK_RE.lastIndex = 0
  while ((match = WIKI_LINK_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, match.index) })
    }
    segments.push({ type: 'wikilink', slug: match[1].trim() })
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) })
  }

  return segments
}

/** Extract all wiki-link slugs from a string */
export function extractSlugs(text: string): string[] {
  const slugs: string[] = []
  let match: RegExpExecArray | null
  WIKI_LINK_RE.lastIndex = 0
  while ((match = WIKI_LINK_RE.exec(text)) !== null) {
    slugs.push(match[1].trim())
  }
  return slugs
}
