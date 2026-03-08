import { describe, it, expect } from 'vitest'
import { cn, generateId, slugify, truncate, extractWikiLinks } from '@/lib/utils'

describe('cn()', () => {
  it('merges class names', () => {
    expect(cn('a', 'b')).toBe('a b')
  })

  it('deduplicates Tailwind conflicts', () => {
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500')
  })

  it('handles falsy values', () => {
    expect(cn('a', false, undefined, null, 'b')).toBe('a b')
  })

  it('handles empty input', () => {
    expect(cn()).toBe('')
  })
})

describe('generateId()', () => {
  it('returns a non-empty string', () => {
    expect(typeof generateId()).toBe('string')
    expect(generateId().length).toBeGreaterThan(0)
  })

  it('returns unique values', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()))
    expect(ids.size).toBe(100)
  })
})

describe('slugify()', () => {
  it('converts spaces to underscores', () => {
    expect(slugify('Hello World')).toBe('hello_world')
  })

  it('removes special characters', () => {
    expect(slugify('A & B!')).toBe('a__b')
  })

  it('preserves Korean characters', () => {
    expect(slugify('프로젝트 ECHO')).toContain('프로젝트')
  })

  it('lowercases ASCII', () => {
    expect(slugify('ToneManner')).toBe('tonemanner')
  })
})

describe('truncate()', () => {
  it('returns string as-is if within limit', () => {
    expect(truncate('short', 40)).toBe('short')
  })

  it('truncates with ellipsis', () => {
    const result = truncate('a'.repeat(50), 40)
    expect(result.length).toBe(40)
    expect(result.endsWith('…')).toBe(true)
  })

  it('uses default max of 40', () => {
    const long = 'x'.repeat(50)
    expect(truncate(long)).toHaveLength(40)
  })
})

describe('extractWikiLinks()', () => {
  it('extracts single wiki-link', () => {
    expect(extractWikiLinks('See [[tone_manner_guide]] for details')).toEqual(['tone_manner_guide'])
  })

  it('extracts multiple wiki-links', () => {
    const links = extractWikiLinks('Refs: [[a]], [[b]], [[c]]')
    expect(links).toEqual(['a', 'b', 'c'])
  })

  it('returns empty array for no links', () => {
    expect(extractWikiLinks('No links here')).toEqual([])
  })

  it('trims whitespace from slugs', () => {
    expect(extractWikiLinks('[[ slug_with_space ]]')).toEqual(['slug_with_space'])
  })
})
