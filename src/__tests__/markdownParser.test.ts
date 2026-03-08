import { describe, it, expect } from 'vitest'
import {
  filePathToDocId,
  parseSections,
  parseMarkdownFile,
  parseVaultFiles,
} from '@/lib/markdownParser'
import type { VaultFile } from '@/types'

// ── filePathToDocId ────────────────────────────────────────────────────────────

describe('filePathToDocId()', () => {
  it('converts simple filename', () => {
    expect(filePathToDocId('note.md')).toBe('note')
  })

  it('converts path with subdirectory', () => {
    expect(filePathToDocId('subdir/my note.md')).toBe('subdir_my_note')
  })

  it('strips .md extension', () => {
    expect(filePathToDocId('doc.md')).not.toContain('.md')
  })

  it('replaces spaces with underscores', () => {
    expect(filePathToDocId('my cool doc.md')).toBe('my_cool_doc')
  })

  it('replaces path separators', () => {
    const id = filePathToDocId('a/b/c.md')
    expect(id).toBe('a_b_c')
  })

  it('handles Korean filename', () => {
    const id = filePathToDocId('아트 방향.md')
    // Should not throw; non-alphanumeric chars replaced
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
  })
})

// ── parseSections ──────────────────────────────────────────────────────────────

describe('parseSections()', () => {
  it('returns single (intro) section when no headings', () => {
    const sections = parseSections('Simple content here.', 'doc1')
    expect(sections).toHaveLength(1)
    expect(sections[0].id).toContain('intro')
    expect(sections[0].body).toContain('Simple content here.')
  })

  it('splits on ## headings', () => {
    const content = '## First Section\nContent A\n\n## Second Section\nContent B'
    const sections = parseSections(content, 'doc1')
    expect(sections.length).toBeGreaterThanOrEqual(2)
  })

  it('each section has id, heading, body, wikiLinks', () => {
    const content = '## Test Section\nContent [[link_target]]'
    const sections = parseSections(content, 'doc1')
    const section = sections[0]
    expect(section).toHaveProperty('id')
    expect(section).toHaveProperty('heading')
    expect(section).toHaveProperty('body')
    expect(section).toHaveProperty('wikiLinks')
  })

  it('extracts wiki links from body', () => {
    const content = '## Section\nSee [[art_doc]] and [[plan_doc]] for reference.'
    const sections = parseSections(content, 'doc1')
    expect(sections[0].wikiLinks).toContain('art_doc')
    expect(sections[0].wikiLinks).toContain('plan_doc')
  })

  it('deduplicates slug conflicts with _N suffix', () => {
    const content = '## Section\nContent A\n\n## Section\nContent B'
    const sections = parseSections(content, 'doc1')
    const ids = sections.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

// ── parseMarkdownFile ──────────────────────────────────────────────────────────

describe('parseMarkdownFile()', () => {
  const makeFile = (content: string, path = 'test.md'): VaultFile => ({
    relativePath: path,
    absolutePath: `C:/vault/${path}`,
    content,
  })

  it('parses valid frontmatter', () => {
    const file = makeFile(
      '---\nspeaker: art_director\ndate: 2024-01-15\ntags: [art, concept]\n---\n## Content\nBody'
    )
    const doc = parseMarkdownFile(file)
    expect(doc.speaker).toBe('art_director')
    expect(doc.date).toBe('2024-01-15')
    expect(doc.tags).toContain('art')
    expect(doc.tags).toContain('concept')
  })

  it('falls back to unknown speaker when not in frontmatter', () => {
    const file = makeFile('## Content\nBody')
    const doc = parseMarkdownFile(file)
    expect(doc.speaker).toBe('unknown')
  })

  it('falls back to unknown speaker for invalid speaker value', () => {
    const file = makeFile('---\nspeaker: invalid_person\n---\ncontent')
    const doc = parseMarkdownFile(file)
    expect(doc.speaker).toBe('unknown')
  })

  it('returns empty tags when not specified', () => {
    const file = makeFile('## Content\nBody')
    const doc = parseMarkdownFile(file)
    expect(doc.tags).toEqual([])
  })

  it('sets correct id from relativePath', () => {
    const file = makeFile('content', 'subdir/my note.md')
    const doc = parseMarkdownFile(file)
    expect(doc.id).toBe('subdir_my_note')
  })

  it('includes rawContent', () => {
    const content = '---\nspeaker: art_director\n---\nbody'
    const file = makeFile(content)
    const doc = parseMarkdownFile(file)
    expect(doc.rawContent).toBe(content)
  })

  it('normalises Date object to YYYY-MM-DD string', () => {
    const file = makeFile('---\ndate: 2024-03-20\n---\ncontent')
    const doc = parseMarkdownFile(file)
    expect(doc.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

// ── parseVaultFiles ────────────────────────────────────────────────────────────

describe('parseVaultFiles()', () => {
  it('converts array of VaultFiles to LoadedDocuments', () => {
    const files: VaultFile[] = [
      { relativePath: 'a.md', absolutePath: 'C:/vault/a.md', content: 'Content A' },
      { relativePath: 'b.md', absolutePath: 'C:/vault/b.md', content: 'Content B' },
    ]
    const docs = parseVaultFiles(files)
    expect(docs).toHaveLength(2)
  })

  it('skips files that fail to parse', () => {
    // Should not throw; bad files are skipped with console.warn
    const files: VaultFile[] = [
      { relativePath: 'good.md', absolutePath: 'C:/vault/good.md', content: '## Content\nBody' },
    ]
    const docs = parseVaultFiles(files)
    expect(docs).toHaveLength(1)
  })

  it('returns empty array for empty input', () => {
    expect(parseVaultFiles([])).toEqual([])
  })
})
