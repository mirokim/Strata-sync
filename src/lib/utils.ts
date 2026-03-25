import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function generateId(): string {
  return crypto.randomUUID()
}

/** Slugify a heading string for wiki-link matching */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_가-힣]/g, '')
}

/** Truncate a string to a max length with ellipsis */
export function truncate(text: string, max = 40): string {
  if (text.length <= max) return text
  return text.slice(0, max - 1) + '…'
}

/** Extract [[slug]] references from a markdown string.
 *  Excludes ![[embed]] image embeds. */
export function extractWikiLinks(text: string): string[] {
  // negative lookbehind: [[...]] immediately preceded by '!' is an image embed — excluded
  const matches = text.match(/(?<!!)\[\[(.*?)\]\]/gs) ?? []
  return matches.map(m => m.slice(2, -2).trim())
}

/** Extract ![[image.png]] image embed references from a markdown string. */
export function extractImageRefs(text: string): string[] {
  const matches = text.match(/!\[\[([^\]]+)\]\]/g) ?? []
  return [...new Set(matches.map(m => m.slice(3, -2).trim()))]
}

/**
 * Remove lone Unicode surrogates from a string.
 *
 * JavaScript strings are UTF-16. Slicing document content at a byte boundary
 * (e.g. body.slice(0, 1500)) can split a surrogate pair, leaving an orphaned
 * high surrogate (U+D800-DBFF) or low surrogate (U+DC00-DFFF).
 * JSON.stringify then produces invalid JSON and Anthropic's API returns 400.
 *
 * Regex: match valid pair (keep) OR lone surrogate (remove).
 */
export function sanitizeUnicode(str: string): string {
  return str.replace(
    /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g,
    m => m.length === 2 ? m : ''
  )
}
