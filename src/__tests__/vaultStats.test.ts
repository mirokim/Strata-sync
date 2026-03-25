import { calcBodyCharCount, hasImageOrTable, hasWikiLink, computeStats } from '@/lib/vaultStats'
import type { LoadedDocument } from '@/types'

// Helper to create a minimal LoadedDocument
function makeDoc(overrides: Partial<LoadedDocument> = {}): LoadedDocument {
  return {
    id: overrides.id ?? 'doc-1',
    filename: overrides.filename ?? 'test.md',
    folderPath: overrides.folderPath ?? '',
    absolutePath: overrides.absolutePath ?? '/vault/test.md',
    speaker: 'chief_director',
    date: '2024-01-01',
    tags: [],
    links: [],
    sections: [],
    rawContent: overrides.rawContent ?? '',
    ...overrides,
  }
}

describe('calcBodyCharCount()', () => {
  it('returns 0 for empty string', () => {
    expect(calcBodyCharCount('')).toBe(0)
  })

  it('counts characters with whitespace stripped', () => {
    expect(calcBodyCharCount('hello world')).toBe(10) // "helloworld"
  })

  it('strips frontmatter before counting', () => {
    const content = '---\ntitle: test\n---\nbody text'
    // After stripping frontmatter: "body text" → whitespace removed → "bodytext" = 8
    expect(calcBodyCharCount(content)).toBe(8)
  })

  it('strips H1 headings', () => {
    const content = '# My Title\nsome body'
    // H1 removed, "some body" → "somebody" = 8
    expect(calcBodyCharCount(content)).toBe(8)
  })

  it('strips source lines', () => {
    const content = '> Source: https://example.com\nactual content'
    // Source line removed, "actual content" → "actualcontent" = 13
    expect(calcBodyCharCount(content)).toBe(13)
  })

  it('handles frontmatter without closing delimiter gracefully', () => {
    // If there's no closing ---, the entire content is kept (starts with ---)
    const content = '---\ntitle: broken'
    // No \n---\n found, so the whole text is used
    const count = calcBodyCharCount(content)
    expect(count).toBeGreaterThan(0)
  })
})

describe('hasImageOrTable()', () => {
  it('returns false for plain text', () => {
    expect(hasImageOrTable('just text')).toBe(false)
  })

  it('detects wikilink image embeds', () => {
    expect(hasImageOrTable('![[screenshot.png]]')).toBe(true)
  })

  it('detects markdown tables', () => {
    expect(hasImageOrTable('| Col A | Col B |\n| --- | --- |\n| 1 | 2 |')).toBe(true)
  })

  it('returns false for regular wikilinks (not images)', () => {
    expect(hasImageOrTable('[[some_page]]')).toBe(false)
  })
})

describe('hasWikiLink()', () => {
  it('returns false for plain text', () => {
    expect(hasWikiLink('no links here')).toBe(false)
  })

  it('detects a wikilink', () => {
    expect(hasWikiLink('See [[other_doc]] for details')).toBe(true)
  })

  it('detects image embed wikilinks', () => {
    expect(hasWikiLink('![[image.png]]')).toBe(true)
  })
})

describe('computeStats()', () => {
  it('returns all zeros for empty docs array', () => {
    const stats = computeStats([])
    expect(stats).toEqual({
      total: 0,
      stubCount: 0,
      thinCount: 0,
      noLinkCount: 0,
      archiveCount: 0,
      hasCurrentSituation: false,
    })
  })

  it('ignores image documents (id starts with "img:")', () => {
    const docs = [makeDoc({ id: 'img:photo.png' })]
    const stats = computeStats(docs)
    expect(stats.total).toBe(0)
  })

  it('counts stubs (< 50 chars, no media)', () => {
    const docs = [makeDoc({ rawContent: 'short' })]
    const stats = computeStats(docs)
    expect(stats.stubCount).toBe(1)
    expect(stats.thinCount).toBe(0)
  })

  it('counts thin docs (50-299 chars, no media)', () => {
    // 100 chars of body
    const docs = [makeDoc({ rawContent: 'a'.repeat(100) })]
    const stats = computeStats(docs)
    expect(stats.stubCount).toBe(0)
    expect(stats.thinCount).toBe(1)
  })

  it('does not count as stub/thin if document has images', () => {
    const docs = [makeDoc({ rawContent: 'x\n![[img.png]]' })]
    const stats = computeStats(docs)
    expect(stats.stubCount).toBe(0)
    expect(stats.thinCount).toBe(0)
  })

  it('counts noLinkCount for docs without wikilinks', () => {
    const docs = [makeDoc({ rawContent: 'no links at all, just text' })]
    const stats = computeStats(docs)
    expect(stats.noLinkCount).toBe(1)
  })

  it('does not count noLink for docs with wikilinks', () => {
    const docs = [makeDoc({ rawContent: 'See [[other_doc]]' })]
    const stats = computeStats(docs)
    expect(stats.noLinkCount).toBe(0)
  })

  it('counts archive docs by folderPath', () => {
    const docs = [makeDoc({ folderPath: 'archive/old' })]
    const stats = computeStats(docs)
    expect(stats.archiveCount).toBe(1)
  })

  it('counts archive docs by absolutePath', () => {
    const docs = [makeDoc({ absolutePath: '/vault/archive/test.md' })]
    const stats = computeStats(docs)
    expect(stats.archiveCount).toBe(1)
  })

  it('detects hasCurrentSituation from filename', () => {
    const docs = [makeDoc({ filename: 'CurrentSituation.md', rawContent: 'a'.repeat(500) })]
    const stats = computeStats(docs)
    expect(stats.hasCurrentSituation).toBe(true)
  })

  it('reports correct total excluding image docs', () => {
    const docs = [
      makeDoc({ id: 'doc-1' }),
      makeDoc({ id: 'doc-2' }),
      makeDoc({ id: 'img:photo.png' }),
    ]
    const stats = computeStats(docs)
    expect(stats.total).toBe(2)
  })
})
