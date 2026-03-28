import { describe, it, expect } from 'vitest'
import { vaultDocsToChunks } from '@/lib/vaultToChunks'
import type { LoadedDocument } from '@/types'

// ── Helpers ────────────────────────────────────────────────────────────────────

const makeDoc = (
  id: string,
  sections: Array<{ id: string; heading: string; body: string; wikiLinks: string[] }>
): LoadedDocument => ({
  id,
  filename: `${id}.md`,
  folderPath: '',
  speaker: 'art_director',
  date: '2024-01-01',
  tags: ['tag1', 'tag2'],
  links: [],
  sections,
  rawContent: '',
})

// ── vaultDocsToChunks ─────────────────────────────────────────────────────────

describe('vaultDocsToChunks()', () => {
  it('returns one chunk per non-empty section', () => {
    const doc = makeDoc('d1', [
      { id: 'd1_s1', heading: '섹션1', body: '내용A', wikiLinks: [] },
      { id: 'd1_s2', heading: '섹션2', body: '내용B', wikiLinks: [] },
    ])
    const chunks = vaultDocsToChunks([doc])
    expect(chunks).toHaveLength(2)
  })

  it('skips sections with empty body', () => {
    const doc = makeDoc('d1', [
      { id: 'd1_s1', heading: '섹션1', body: '   ', wikiLinks: [] },
      { id: 'd1_s2', heading: '섹션2', body: '내용', wikiLinks: [] },
    ])
    const chunks = vaultDocsToChunks([doc])
    expect(chunks).toHaveLength(1)
  })

  it('chunk contains correct doc_id and filename', () => {
    const doc = makeDoc('my_doc', [
      { id: 'my_doc_intro', heading: '제목', body: '본문', wikiLinks: [] },
    ])
    const chunks = vaultDocsToChunks([doc])
    expect(chunks[0].doc_id).toBe('my_doc')
    expect(chunks[0].filename).toBe('my_doc.md')
  })

  it('chunk contains section_id and heading', () => {
    const doc = makeDoc('d1', [
      { id: 'd1_intro', heading: '인트로', body: '내용', wikiLinks: [] },
    ])
    const chunks = vaultDocsToChunks([doc])
    expect(chunks[0].section_id).toBe('d1_intro')
    expect(chunks[0].heading).toBe('인트로')
  })

  it('chunk tags match document tags', () => {
    const doc = makeDoc('d1', [
      { id: 'd1_s1', heading: 'H', body: '내용', wikiLinks: [] },
    ])
    const chunks = vaultDocsToChunks([doc])
    expect(chunks[0].tags).toEqual(['tag1', 'tag2'])
  })

  it('returns empty array for empty input', () => {
    expect(vaultDocsToChunks([])).toEqual([])
  })

  it('flattens multiple docs into flat chunk array', () => {
    const docs = [
      makeDoc('d1', [
        { id: 'd1_s1', heading: 'A', body: '내용', wikiLinks: [] },
        { id: 'd1_s2', heading: 'B', body: '내용', wikiLinks: [] },
      ]),
      makeDoc('d2', [
        { id: 'd2_s1', heading: 'C', body: '내용', wikiLinks: [] },
      ]),
    ]
    const chunks = vaultDocsToChunks(docs)
    expect(chunks).toHaveLength(3)
  })
})
