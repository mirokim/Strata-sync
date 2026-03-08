import { describe, it, expect } from 'vitest'
import { MOCK_DOCUMENTS } from '@/data/mockDocuments'
import { buildGraphNodes, buildGraphLinks, MOCK_NODES, MOCK_LINKS } from '@/data/mockGraph'

describe('MOCK_DOCUMENTS', () => {
  it('has exactly 20 documents', () => {
    expect(MOCK_DOCUMENTS).toHaveLength(20)
  })

  it('each document has a unique id', () => {
    const ids = MOCK_DOCUMENTS.map(d => d.id)
    expect(new Set(ids).size).toBe(20)
  })

  it('each document has at least one section', () => {
    for (const doc of MOCK_DOCUMENTS) {
      expect(doc.sections.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('section IDs are unique across all documents', () => {
    const allSectionIds = MOCK_DOCUMENTS.flatMap(d => d.sections.map(s => s.id))
    expect(new Set(allSectionIds).size).toBe(allSectionIds.length)
  })

  it('speaker distribution matches plan (Chief×3, Art×5, Plan×4, Level×4, Tech×4)', () => {
    const counts: Record<string, number> = {}
    for (const doc of MOCK_DOCUMENTS) {
      counts[doc.speaker] = (counts[doc.speaker] ?? 0) + 1
    }
    expect(counts['chief_director']).toBe(3)
    expect(counts['art_director']).toBe(5)
    expect(counts['plan_director']).toBe(4)
    expect(counts['level_director']).toBe(4)
    expect(counts['prog_director']).toBe(4)
  })

  it('rawContent is a non-empty string for each document', () => {
    for (const doc of MOCK_DOCUMENTS) {
      expect(typeof doc.rawContent).toBe('string')
      expect(doc.rawContent.length).toBeGreaterThan(0)
    }
  })
})

describe('buildGraphNodes()', () => {
  it('creates one node per document (20 docs = 20 nodes)', () => {
    expect(buildGraphNodes()).toHaveLength(20)
  })

  it('node IDs match document IDs', () => {
    const nodes = buildGraphNodes()
    const docIds = new Set(MOCK_DOCUMENTS.map(d => d.id))
    for (const node of nodes) {
      expect(docIds.has(node.id)).toBe(true)
    }
  })

  it('each node has a valid speaker', () => {
    const validSpeakers = new Set([
      'chief_director', 'art_director', 'plan_director',
      'level_director', 'prog_director',
    ])
    for (const node of buildGraphNodes()) {
      expect(validSpeakers.has(node.speaker)).toBe(true)
    }
  })

  it('node labels are filenames without .md', () => {
    const nodes = buildGraphNodes()
    for (const node of nodes) {
      expect(node.label).not.toMatch(/\.md$/i)
    }
  })
})

describe('buildGraphLinks()', () => {
  it('all link sources and targets reference valid node IDs', () => {
    const nodes = buildGraphNodes()
    const links = buildGraphLinks(nodes)
    const nodeIds = new Set(nodes.map(n => n.id))
    for (const link of links) {
      expect(nodeIds.has(link.source as string)).toBe(true)
      expect(nodeIds.has(link.target as string)).toBe(true)
    }
  })

  it('no duplicate links (bidirectional dedup)', () => {
    const nodes = buildGraphNodes()
    const links = buildGraphLinks(nodes)
    const seen = new Set<string>()
    for (const link of links) {
      const key = [link.source as string, link.target as string].sort().join('→')
      expect(seen.has(key)).toBe(false)
      seen.add(key)
    }
  })

  it('has at least 1 link', () => {
    const nodes = buildGraphNodes()
    expect(buildGraphLinks(nodes).length).toBeGreaterThan(0)
  })

  it('links connect document-level IDs (not section IDs)', () => {
    const nodes = buildGraphNodes()
    const links = buildGraphLinks(nodes)
    const docIds = new Set(MOCK_DOCUMENTS.map(d => d.id))
    for (const link of links) {
      expect(docIds.has(link.source as string)).toBe(true)
      expect(docIds.has(link.target as string)).toBe(true)
    }
  })
})

describe('MOCK_NODES / MOCK_LINKS exports', () => {
  it('MOCK_NODES is non-empty', () => {
    expect(MOCK_NODES.length).toBeGreaterThan(0)
  })

  it('MOCK_LINKS is non-empty', () => {
    expect(MOCK_LINKS.length).toBeGreaterThan(0)
  })

  it('MOCK_NODES and MOCK_LINKS are consistent', () => {
    const nodeIds = new Set(MOCK_NODES.map(n => n.id))
    for (const link of MOCK_LINKS) {
      expect(nodeIds.has(link.source as string)).toBe(true)
      expect(nodeIds.has(link.target as string)).toBe(true)
    }
  })
})
