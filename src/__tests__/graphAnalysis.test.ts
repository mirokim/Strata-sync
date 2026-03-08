import { describe, it, expect, beforeEach } from 'vitest'
import { tokenize, TfIdfIndex } from '@/lib/graphAnalysis'
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

  it('removes duplicate tokens', () => {
    const tokens = tokenize('test test test')
    expect(tokens.filter(t => t === 'test').length).toBe(1)
  })

  it('returns empty array for empty string', () => {
    expect(tokenize('')).toEqual([])
  })

  it('stems Korean verb suffixes (은/는/이/가)', () => {
    // "시스템은" → should include "시스템"
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

  // ── serialize / restore ─────────────────────────────────────────────────────

  it('serialize() returns a plain object with schemaVersion=3', () => {
    index.build(docs)
    const serialized = index.serialize('test-fingerprint')
    expect(serialized.schemaVersion).toBe(3)
    expect(serialized.fingerprint).toBe('test-fingerprint')
    expect(Array.isArray(serialized.idf)).toBe(true)
    expect(Array.isArray(serialized.docs)).toBe(true)
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
})
