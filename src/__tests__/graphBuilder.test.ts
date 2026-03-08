import { describe, it, expect } from 'vitest'
import {
  buildGraphNodes,
  buildGraphLinks,
  buildGraph,
} from '@/lib/graphBuilder'
import { MOCK_DOCUMENTS } from '@/data/mockDocuments'
import type { LoadedDocument } from '@/types'

// ── Helpers ────────────────────────────────────────────────────────────────────

const makeDoc = (
  id: string,
  overrides: Partial<LoadedDocument> = {}
): LoadedDocument => ({
  id,
  filename: `${id}.md`,
  folderPath: '',
  speaker: 'art_director',
  date: '2024-01-01',
  tags: [],
  links: [],
  sections: [
    { id: `${id}_intro`, heading: 'Section', body: 'Content', wikiLinks: [] },
  ],
  rawContent: 'Content',
  ...overrides,
})

// ── buildGraphNodes ────────────────────────────────────────────────────────────

describe('buildGraphNodes()', () => {
  it('produces one node per document (not per section)', () => {
    const docs = [
      makeDoc('d1', {
        sections: [
          { id: 'd1_s1', heading: 'A', body: 'b', wikiLinks: [] },
          { id: 'd1_s2', heading: 'B', body: 'c', wikiLinks: [] },
        ],
      }),
    ]
    const nodes = buildGraphNodes(docs)
    expect(nodes).toHaveLength(1) // 1 document = 1 node
  })

  it('each node has id, docId, speaker, label', () => {
    const docs = [makeDoc('d1')]
    const nodes = buildGraphNodes(docs)
    expect(nodes[0]).toHaveProperty('id')
    expect(nodes[0]).toHaveProperty('docId')
    expect(nodes[0]).toHaveProperty('speaker')
    expect(nodes[0]).toHaveProperty('label')
  })

  it('node id matches document id', () => {
    const docs = [makeDoc('d1')]
    const nodes = buildGraphNodes(docs)
    expect(nodes[0].id).toBe('d1')
    expect(nodes[0].docId).toBe('d1')
  })

  it('node label is filename without .md', () => {
    const docs = [makeDoc('my_note', { filename: 'My Note.md' })]
    const nodes = buildGraphNodes(docs)
    expect(nodes[0].label).toBe('My Note')
  })

  it('works with MOCK_DOCUMENTS (20 docs = 20 nodes)', () => {
    const nodes = buildGraphNodes(MOCK_DOCUMENTS)
    expect(nodes).toHaveLength(20)
  })

  it('returns empty array for empty input', () => {
    expect(buildGraphNodes([])).toEqual([])
  })
})

// ── buildGraphLinks ────────────────────────────────────────────────────────────

describe('buildGraphLinks()', () => {
  it('creates link when wikiLink matches a section ID in another doc', () => {
    const docs = [
      makeDoc('doc_a', {
        sections: [{ id: 'doc_a_s1', heading: 'A', body: 'b', wikiLinks: ['doc_b_s1'] }],
      }),
      makeDoc('doc_b', {
        sections: [{ id: 'doc_b_s1', heading: 'B', body: 'c', wikiLinks: [] }],
      }),
    ]
    const nodes = buildGraphNodes(docs)
    const { links } = buildGraphLinks(docs, nodes)
    expect(links).toHaveLength(1)
    // Links are now between document IDs
    expect(links[0].source).toBe('doc_a')
    expect(links[0].target).toBe('doc_b')
  })

  it('creates link when wikiLink matches a filename', () => {
    const docs = [
      makeDoc('doc_a', {
        filename: 'doc_a.md',
        sections: [{ id: 'doc_a_s1', heading: 'A', body: 'b', wikiLinks: ['doc_b'] }],
      }),
      makeDoc('doc_b', {
        filename: 'doc_b.md',
        sections: [{ id: 'doc_b_s1', heading: 'B', body: 'c', wikiLinks: [] }],
      }),
    ]
    const nodes = buildGraphNodes(docs)
    const { links } = buildGraphLinks(docs, nodes)
    expect(links).toHaveLength(1)
    expect(links[0].source).toBe('doc_a')
    expect(links[0].target).toBe('doc_b')
  })

  it('creates phantom node for unresolvable wikiLink', () => {
    const docs = [
      makeDoc('doc_a', {
        sections: [
          { id: 'doc_a_s1', heading: 'A', body: 'b', wikiLinks: ['nonexistent_doc'] },
        ],
      }),
    ]
    const nodes = buildGraphNodes(docs)
    const { links, phantomNodes } = buildGraphLinks(docs, nodes)
    expect(links).toHaveLength(1)
    expect(phantomNodes).toHaveLength(1)
    expect(phantomNodes[0].id).toBe('_phantom_nonexistent_doc')
  })

  it('deduplicates links from multiple sections in the same doc', () => {
    const docs = [
      makeDoc('doc_a', {
        sections: [
          { id: 'doc_a_s1', heading: 'A', body: 'b', wikiLinks: ['doc_b_s1'] },
          { id: 'doc_a_s2', heading: 'A2', body: 'c', wikiLinks: ['doc_b_s1'] },
        ],
      }),
      makeDoc('doc_b', {
        sections: [{ id: 'doc_b_s1', heading: 'B', body: 'd', wikiLinks: [] }],
      }),
    ]
    const nodes = buildGraphNodes(docs)
    const { links } = buildGraphLinks(docs, nodes)
    // Two sections in doc_a both link to doc_b, but only 1 link should be created
    expect(links).toHaveLength(1)
  })

  it('link source and target are valid node ids (including phantoms)', () => {
    const nodes = buildGraphNodes(MOCK_DOCUMENTS)
    const { links, phantomNodes } = buildGraphLinks(MOCK_DOCUMENTS, nodes)
    const allNodeIds = new Set([...nodes, ...phantomNodes].map((n) => n.id))
    for (const link of links) {
      expect(allNodeIds.has(link.source as string)).toBe(true)
      expect(allNodeIds.has(link.target as string)).toBe(true)
    }
  })
})

// ── buildGraph ─────────────────────────────────────────────────────────────────

describe('buildGraph()', () => {
  it('returns nodes and links', () => {
    const { nodes, links } = buildGraph(MOCK_DOCUMENTS)
    expect(Array.isArray(nodes)).toBe(true)
    expect(Array.isArray(links)).toBe(true)
  })

  it('graph from single document has 1 node and 0 links', () => {
    const docs: LoadedDocument[] = [
      makeDoc('ld1', {
        sections: [
          { id: 'ld1_s1', heading: 'Section 1', body: 'Content', wikiLinks: [] },
          { id: 'ld1_s2', heading: 'Section 2', body: 'Content', wikiLinks: [] },
        ],
      }),
    ]
    const { nodes, links } = buildGraph(docs)
    expect(nodes).toHaveLength(1) // 1 document = 1 node
    expect(links).toHaveLength(0) // no cross-doc wikiLinks
  })
})
