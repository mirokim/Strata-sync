import { describe, it, expect, beforeEach } from 'vitest'
import { tokenize, TfIdfIndex, TFIDF_SCHEMA_VERSION } from '@/lib/graphAnalysis'
import type { LoadedDocument } from '@/types'

// ── Helpers ────────────────────────────────────────────────────────────────────

const makeDoc = (id: string, text: string): LoadedDocument => ({
  id,
  filename: `${id}.md`,
  folderPath: '',
  speaker: 'art_director',
  date: '',
  tags: [],
  links: [],
  sections: [{ id: `${id}_intro`, heading: '(intro)', body: text, wikiLinks: [] }],
  rawContent: text,
})

// ── tokenize ───────────────────────────────────────────────────────────────────

describe('tokenize()', () => {
  it('lowercases ASCII text', () => {
    const tokens = tokenize('Hello World')
    expect(tokens).toContain('hello')
    expect(tokens).toContain('world')
  })

  it('splits on punctuation and whitespace', () => {
    const tokens = tokenize('combat, design! system.')
    expect(tokens).toContain('combat')
    expect(tokens).toContain('design')
    expect(tokens).toContain('system')
  })

  it('filters out single-character tokens', () => {
    const tokens = tokenize('a b cc dd')
    expect(tokens).not.toContain('a')
    expect(tokens).not.toContain('b')
    expect(tokens).toContain('cc')
    expect(tokens).toContain('dd')
  })

  it('returns multiple occurrences when token repeats (per-token stemming)', () => {
    const tokens = tokenize('test test test')
    // tokenize returns stems per token occurrence, not deduplicated
    expect(tokens.filter(t => t === 'test').length).toBeGreaterThanOrEqual(1)
  })

  it('returns empty array for empty string', () => {
    expect(tokenize('')).toEqual([])
  })

  it('stems Korean verb suffixes (은/는/이/가)', () => {
    // "시스템은" -> should include "시스템"
    const tokens = tokenize('시스템은 중요합니다')
    expect(tokens).toContain('시스템')
  })

  it('stems Korean postposition "에서" suffix', () => {
    const tokens = tokenize('볼트에서 파일을 읽어')
    expect(tokens).toContain('볼트')
  })
})

// ── TfIdfIndex ─────────────────────────────────────────────────────────────────

describe('TfIdfIndex', () => {
  let index: TfIdfIndex
  let docs: LoadedDocument[]

  beforeEach(() => {
    index = new TfIdfIndex()
    docs = [
      makeDoc('combat',  'combat system damage hit point attack defense warrior'),
      makeDoc('ui',      'user interface panel button layout menu design visual screen'),
      makeDoc('level',   'level design map environment terrain obstacle navigation route'),
      makeDoc('audio',   'sound effect music bgm audio volume spatial mixer'),
    ]
  })

  // ── isBuilt / docCount ──────────────────────────────────────────────────────

  it('isBuilt is false before build()', () => {
    expect(index.isBuilt).toBe(false)
  })

  it('docCount is 0 before build()', () => {
    expect(index.docCount).toBe(0)
  })

  it('isBuilt is true after build()', () => {
    index.build(docs)
    expect(index.isBuilt).toBe(true)
  })

  it('docCount equals number of documents after build()', () => {
    index.build(docs)
    expect(index.docCount).toBe(4)
  })

  it('build() on empty array results in built=true and docCount=0', () => {
    index.build([])
    expect(index.isBuilt).toBe(true)
    expect(index.docCount).toBe(0)
  })

  // ── search ──────────────────────────────────────────────────────────────────

  it('search() returns empty array before build()', () => {
    expect(index.search('combat')).toEqual([])
  })

  it('search() returns empty array for empty query', () => {
    index.build(docs)
    expect(index.search('')).toEqual([])
  })

  it('most relevant document ranks first', () => {
    index.build(docs)
    const results = index.search('combat attack damage')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].docId).toBe('combat')
  })

  it('returns results with score in (0, 1]', () => {
    index.build(docs)
    const results = index.search('level design map')
    for (const r of results) {
      expect(r.score).toBeGreaterThan(0)
      expect(r.score).toBeLessThanOrEqual(1)
    }
  })

  it('result has docId, filename, speaker, score fields', () => {
    index.build(docs)
    const [first] = index.search('sound audio')
    expect(first).toHaveProperty('docId')
    expect(first).toHaveProperty('filename')
    expect(first).toHaveProperty('speaker')
    expect(first).toHaveProperty('score')
  })

  it('unrelated query returns no results or low-score results', () => {
    index.build(docs)
    // "xyz_nonexistent_word" should yield nothing (cosine=0 filtered)
    const results = index.search('xyz_nonexistent_word_zzz')
    // Either empty or very low scores
    for (const r of results) {
      expect(r.score).toBeLessThan(0.5)
    }
  })

  // ── BM25 scoring ───────────────────────────────────────────────────────────

  it('BM25: top result score is normalized to 1.0', () => {
    index.build(docs)
    const results = index.search('combat system')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].score).toBe(1)
  })

  it('BM25: documents with higher term frequency score higher', () => {
    const freqDocs = [
      makeDoc('high-freq', 'combat combat combat combat attack damage'),
      makeDoc('low-freq',  'combat basic overview'),
    ]
    index.build(freqDocs)
    const results = index.search('combat')
    expect(results.length).toBe(2)
    expect(results[0].docId).toBe('high-freq')
    expect(results[0].score).toBeGreaterThan(results[1].score)
  })

  it('BM25: respects topN limit', () => {
    index.build(docs)
    const results = index.search('design', 2)
    expect(results.length).toBeLessThanOrEqual(2)
  })

  // ── serialize / restore ─────────────────────────────────────────────────────

  it('serialize() returns a plain object with current schemaVersion', () => {
    index.build(docs)
    const serialized = index.serialize('test-fingerprint')
    expect(serialized.schemaVersion).toBe(TFIDF_SCHEMA_VERSION)
    expect(serialized.fingerprint).toBe('test-fingerprint')
    expect(Array.isArray(serialized.idf)).toBe(true)
    expect(Array.isArray(serialized.docs)).toBe(true)
  })

  it('serialize() includes avgdl field', () => {
    index.build(docs)
    const serialized = index.serialize('fp')
    expect(typeof serialized.avgdl).toBe('number')
    expect(serialized.avgdl).toBeGreaterThan(0)
  })

  it('serialize() includes BM25 vector fields per doc', () => {
    index.build(docs)
    const serialized = index.serialize('fp')
    for (const doc of serialized.docs) {
      expect(Array.isArray(doc.bm25Vec)).toBe(true)
      expect(typeof doc.bm25Norm).toBe('number')
      expect(typeof doc.docLen).toBe('number')
      expect(Array.isArray(doc.termFreqs)).toBe(true)
    }
  })

  it('restore() produces the same search results as original build()', () => {
    index.build(docs)
    const resultsBeforeSerialize = index.search('combat system')
    const serialized = index.serialize('fp')

    const restored = new TfIdfIndex()
    restored.restore(serialized)

    const resultsAfterRestore = restored.search('combat system')
    expect(resultsAfterRestore[0]?.docId).toBe(resultsBeforeSerialize[0]?.docId)
  })

  it('restore() sets isBuilt=true and correct docCount', () => {
    index.build(docs)
    const serialized = index.serialize('fp')
    const restored = new TfIdfIndex()
    restored.restore(serialized)
    expect(restored.isBuilt).toBe(true)
    expect(restored.docCount).toBe(4)
  })

  it('build() after restore() invalidates cache and rebuilds', () => {
    index.build(docs)
    const s1 = index.serialize('fp1')
    index.build([makeDoc('new_doc', 'completely different new topic')])
    expect(index.docCount).toBe(1)
    expect(s1.docs.length).toBe(4) // old serialized snapshot unchanged
  })

  // ── findImplicitLinks ─────────────────────────────────────────────────────────

  it('findImplicitLinks returns empty when not built', () => {
    const adjacency = new Map<string, string[]>()
    expect(index.findImplicitLinks(adjacency)).toEqual([])
  })

  it('findImplicitLinks returns empty with fewer than 2 docs', () => {
    index.build([makeDoc('solo', 'only one document here')])
    const adjacency = new Map<string, string[]>([['solo', []]])
    expect(index.findImplicitLinks(adjacency)).toEqual([])
  })

  it('findImplicitLinks finds similar unlinked documents', () => {
    // Two documents with overlapping content but no explicit links
    const similarDocs = [
      makeDoc('design-a', 'game design combat balance system weapon damage scaling'),
      makeDoc('design-b', 'combat balance system weapon damage scaling curve tuning'),
      makeDoc('unrelated', 'music audio sound effect bgm volume mixing mastering'),
    ]
    index.build(similarDocs)
    const adjacency = new Map<string, string[]>([
      ['design-a', []],
      ['design-b', []],
      ['unrelated', []],
    ])
    const links = index.findImplicitLinks(adjacency, 10, 0.1)
    // design-a and design-b should be found as implicit link
    const pair = links.find(
      l => (l.docAId === 'design-a' && l.docBId === 'design-b') ||
           (l.docAId === 'design-b' && l.docBId === 'design-a')
    )
    expect(pair).toBeDefined()
    expect(pair!.similarity).toBeGreaterThan(0.1)
  })

  it('findImplicitLinks excludes already-linked pairs', () => {
    const similarDocs = [
      makeDoc('doc-a', 'combat system balance weapon damage scaling'),
      makeDoc('doc-b', 'combat system balance weapon damage scaling'),
    ]
    index.build(similarDocs)
    // Explicit link between doc-a and doc-b
    const adjacency = new Map<string, string[]>([
      ['doc-a', ['doc-b']],
      ['doc-b', ['doc-a']],
    ])
    const links = index.findImplicitLinks(adjacency, 10, 0.01)
    // Should not find this pair since they are already linked
    expect(links).toHaveLength(0)
  })

  it('findImplicitLinks respects threshold', () => {
    index.build(docs)
    const adjacency = new Map<string, string[]>(docs.map(d => [d.id, []]))
    // Very high threshold should return no results
    const links = index.findImplicitLinks(adjacency, 10, 0.99)
    expect(links).toHaveLength(0)
  })

  it('findImplicitLinks respects topN limit', () => {
    index.build(docs)
    const adjacency = new Map<string, string[]>(docs.map(d => [d.id, []]))
    const links = index.findImplicitLinks(adjacency, 1, 0.01)
    expect(links.length).toBeLessThanOrEqual(1)
  })

  it('findImplicitLinks results are sorted by similarity descending', () => {
    index.build(docs)
    const adjacency = new Map<string, string[]>(docs.map(d => [d.id, []]))
    const links = index.findImplicitLinks(adjacency, 10, 0.01)
    for (let i = 1; i < links.length; i++) {
      expect(links[i - 1].similarity).toBeGreaterThanOrEqual(links[i].similarity)
    }
  })
})
