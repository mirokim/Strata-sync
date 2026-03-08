import { describe, it, expect } from 'vitest'
import { parseWikiLinks, extractSlugs } from '@/lib/wikiLinkParser'
import type { ParsedSegment } from '@/lib/wikiLinkParser'

// ── parseWikiLinks ─────────────────────────────────────────────────────────────

describe('parseWikiLinks()', () => {
  it('plain text with no wiki-links → single text segment', () => {
    const result = parseWikiLinks('Hello World')
    expect(result).toEqual([{ type: 'text', value: 'Hello World' }])
  })

  it('empty string → empty array', () => {
    expect(parseWikiLinks('')).toEqual([])
  })

  it('single wiki-link in middle → text + wikilink + text', () => {
    const result = parseWikiLinks('See [[tone_guide]] for details')
    expect(result).toEqual<ParsedSegment[]>([
      { type: 'text', value: 'See ' },
      { type: 'wikilink', slug: 'tone_guide' },
      { type: 'text', value: ' for details' },
    ])
  })

  it('wiki-link at start → wikilink + text', () => {
    const result = parseWikiLinks('[[intro]] is the start')
    expect(result).toEqual<ParsedSegment[]>([
      { type: 'wikilink', slug: 'intro' },
      { type: 'text', value: ' is the start' },
    ])
  })

  it('wiki-link at end → text + wikilink', () => {
    const result = parseWikiLinks('See also [[conclusion]]')
    expect(result).toEqual<ParsedSegment[]>([
      { type: 'text', value: 'See also ' },
      { type: 'wikilink', slug: 'conclusion' },
    ])
  })

  it('only a wiki-link → single wikilink segment', () => {
    const result = parseWikiLinks('[[only_link]]')
    expect(result).toEqual<ParsedSegment[]>([{ type: 'wikilink', slug: 'only_link' }])
  })

  it('multiple wiki-links → correct segment sequence', () => {
    const result = parseWikiLinks('[[a]] and [[b]] and [[c]]')
    expect(result).toHaveLength(5)
    expect(result[0]).toEqual({ type: 'wikilink', slug: 'a' })
    expect(result[2]).toEqual({ type: 'wikilink', slug: 'b' })
    expect(result[4]).toEqual({ type: 'wikilink', slug: 'c' })
  })

  it('consecutive wiki-links with no text in between', () => {
    const result = parseWikiLinks('[[a]][[b]]')
    expect(result).toEqual<ParsedSegment[]>([
      { type: 'wikilink', slug: 'a' },
      { type: 'wikilink', slug: 'b' },
    ])
  })

  it('trims whitespace from slug', () => {
    const result = parseWikiLinks('[[ slug with spaces ]]')
    const wikiSegment = result.find(s => s.type === 'wikilink') as { type: 'wikilink'; slug: string }
    expect(wikiSegment?.slug).toBe('slug with spaces')
  })

  it('does not produce empty text segments', () => {
    const result = parseWikiLinks('[[a]][[b]]')
    const textSegments = result.filter(s => s.type === 'text')
    expect(textSegments.every(s => (s as { type: 'text'; value: string }).value.length > 0)).toBe(true)
  })

  it('handles Korean text and wiki-links', () => {
    const result = parseWikiLinks('[[전투 시스템]] 참고')
    expect(result[0]).toEqual({ type: 'wikilink', slug: '전투 시스템' })
    expect(result[1]).toEqual({ type: 'text', value: ' 참고' })
  })
})

// ── extractSlugs ───────────────────────────────────────────────────────────────

describe('extractSlugs()', () => {
  it('returns empty array for plain text', () => {
    expect(extractSlugs('no links here')).toEqual([])
  })

  it('returns empty array for empty string', () => {
    expect(extractSlugs('')).toEqual([])
  })

  it('extracts single slug', () => {
    expect(extractSlugs('See [[tone_guide]]')).toEqual(['tone_guide'])
  })

  it('extracts multiple slugs in order', () => {
    expect(extractSlugs('[[a]] and [[b]] then [[c]]')).toEqual(['a', 'b', 'c'])
  })

  it('trims whitespace from slugs', () => {
    expect(extractSlugs('[[ trimmed ]]')).toEqual(['trimmed'])
  })

  it('handles consecutive links', () => {
    expect(extractSlugs('[[x]][[y]]')).toEqual(['x', 'y'])
  })
})
