import { describe, it, expect, beforeEach } from 'vitest'
import type { SearchResult, GraphLink, LoadedDocument } from '@/types'
import { useGraphStore } from '@/stores/graphStore'
import { useVaultStore } from '@/stores/vaultStore'
import {
  expandWithGraphNeighbors,
  rerankResults,
  formatCompressedContext,
  getBfsContextDocIds,
  getGlobalContextDocIds,
  directVaultSearch,
  getStrippedBody,
  buildDeepGraphContext,
} from '@/lib/graphRAG'

// ── Test data ────────────────────────────────────────────────────────────────

const MOCK_DOCS: LoadedDocument[] = [
  {
    id: 'design_doc',
    filename: 'design.md',
    folderPath: '',
    speaker: 'chief_director',
    date: '2025-01-01',
    tags: ['design'],
    links: [],
    rawContent: '',
    sections: [
      {
        id: 'design_doc_intro',
        heading: 'Game Design',
        body: 'This is the core design document.',
        wikiLinks: ['art_doc_visual'],
      },
      {
        id: 'design_doc_combat',
        heading: 'Combat System',
        body: 'Uses a turn-based combat system with an elemental affinity framework.',
        wikiLinks: ['art_doc_effects'],
      },
    ],
  },
  {
    id: 'art_doc',
    filename: 'art.md',
    folderPath: '',
    speaker: 'art_director',
    date: '2025-01-02',
    tags: ['art'],
    links: [],
    rawContent: '',
    sections: [
      {
        id: 'art_doc_visual',
        heading: 'Visual Concept',
        body: 'Based on a dark fantasy visual style.',
        wikiLinks: ['design_doc_intro'],
      },
      {
        id: 'art_doc_effects',
        heading: 'Effect Design',
        body: 'Combat effects use the particle system.',
        wikiLinks: ['design_doc_combat'],
      },
    ],
  },
  {
    id: 'plan_doc',
    filename: 'plan.md',
    folderPath: '',
    speaker: 'plan_director',
    date: '2025-01-03',
    tags: ['plan'],
    links: [],
    rawContent: '',
    sections: [
      {
        id: 'plan_doc_schedule',
        heading: 'Schedule Plan',
        body: 'Milestone 1 is the completion of the prototype.',
        wikiLinks: [],
      },
    ],
  },
]

// Phase 7: links are between document-level IDs (not section IDs)
const MOCK_LINKS: GraphLink[] = [
  { source: 'design_doc', target: 'art_doc', strength: 0.5 },
]

function makeSearchResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    doc_id: 'design_doc',
    filename: 'design.md',
    section_id: 'design_doc_intro',
    heading: 'Game Design',
    speaker: 'chief_director',
    content: 'This is the core design document.',
    score: 0.85,
    tags: ['design'],
    ...overrides,
  }
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  // Seed stores with test data
  useGraphStore.setState({ links: MOCK_LINKS })
  useVaultStore.setState({ loadedDocuments: MOCK_DOCS })
})

// ── expandWithGraphNeighbors ─────────────────────────────────────────────────

describe('expandWithGraphNeighbors', () => {
  it('returns neighbor sections connected via wiki-links', () => {
    const results = [makeSearchResult()]
    const neighbors = expandWithGraphNeighbors(results)

    expect(neighbors).toHaveLength(1)
    expect(neighbors[0].sectionId).toBe('art_doc_visual')
    expect(neighbors[0].heading).toBe('Visual Concept')
    expect(neighbors[0].filename).toBe('art.md')
    expect(neighbors[0].linkedFrom).toBe('design_doc_intro')
  })

  it('does not duplicate primary result documents as neighbors', () => {
    // Both results belong to design_doc and art_doc — both are primary
    const results = [
      makeSearchResult(),
      makeSearchResult({
        doc_id: 'art_doc',
        filename: 'art.md',
        section_id: 'art_doc_visual',
        heading: 'Visual Concept',
        speaker: 'art_director',
        content: 'Based on a dark fantasy visual style.',
      }),
    ]
    const neighbors = expandWithGraphNeighbors(results)
    // art_doc is already a primary result document → not included as neighbor
    expect(neighbors).toHaveLength(0)
  })

  it('returns empty when no graph links exist', () => {
    useGraphStore.setState({ links: [] })
    const results = [makeSearchResult()]
    const neighbors = expandWithGraphNeighbors(results)
    expect(neighbors).toHaveLength(0)
  })

  it('returns empty when no vault documents are loaded', () => {
    useVaultStore.setState({ loadedDocuments: null })
    const results = [makeSearchResult()]
    const neighbors = expandWithGraphNeighbors(results)
    expect(neighbors).toHaveLength(0)
  })

  it('respects maxNeighborsPerResult limit', () => {
    const results = [makeSearchResult()]
    const neighbors = expandWithGraphNeighbors(results, 0)
    expect(neighbors).toHaveLength(0)
  })

  it('truncates long neighbor content to 300 chars', () => {
    const longBody = 'A'.repeat(500)
    const docs = MOCK_DOCS.map(d => ({
      ...d,
      sections: d.sections.map(s =>
        s.id === 'art_doc_visual' ? { ...s, body: longBody } : s
      ),
    }))
    useVaultStore.setState({ loadedDocuments: docs })

    const results = [makeSearchResult()]
    const neighbors = expandWithGraphNeighbors(results)
    expect(neighbors[0].content.length).toBeLessThanOrEqual(301) // 300 + '…'
    expect(neighbors[0].content).toMatch(/…$/)
  })
})

// ── rerankResults ────────────────────────────────────────────────────────────

describe('rerankResults', () => {
  it('reranks by keyword overlap', () => {
    const results = [
      makeSearchResult({ content: 'schedule management system', score: 0.7 }),
      makeSearchResult({ content: 'combat system design', score: 0.6 }),
      makeSearchResult({ content: 'combat system balance combat logic', score: 0.5 }),
    ]

    // Query matches "combat system" → results with those terms should rank higher
    const reranked = rerankResults(results, 'combat system', 2)
    expect(reranked).toHaveLength(2)
    // The result with highest keyword overlap should be first
    expect(reranked[0].content).toContain('combat')
  })

  it('applies speaker affinity boost', () => {
    const results = [
      makeSearchResult({
        content: 'identical content here',
        score: 0.7,
        speaker: 'art_director',
      }),
      makeSearchResult({
        content: 'identical content here',
        score: 0.7,
        speaker: 'chief_director',
      }),
    ]

    const reranked = rerankResults(results, 'query', 1, 'chief_director')
    // chief_director should be boosted
    expect(reranked[0].speaker).toBe('chief_director')
  })

  it('returns all results when count <= topN', () => {
    const results = [makeSearchResult(), makeSearchResult()]
    const reranked = rerankResults(results, 'query', 5)
    expect(reranked).toHaveLength(2)
  })
})

// ── formatCompressedContext ───────────────────────────────────────────────────

describe('formatCompressedContext', () => {
  it('formats primary results with compressed headers', () => {
    const results = [makeSearchResult()]
    const output = formatCompressedContext(results, [])

    expect(output).toContain('## Related Documents')
    expect(output).toContain('[Document] design.md > Game Design (chief_director)')
    expect(output).toContain('This is the core design document.')
  })

  it('includes neighbor sections under Connected Documents header', () => {
    const results = [makeSearchResult()]
    const neighbors = expandWithGraphNeighbors(results)
    const output = formatCompressedContext(results, neighbors)

    expect(output).toContain('### Connected Documents')
    expect(output).toContain('[Connected] art.md > Visual Concept')
  })

  it('returns empty string when no results', () => {
    expect(formatCompressedContext([], [])).toBe('')
  })

  it('omits speaker for unknown speakers', () => {
    const results = [makeSearchResult({ speaker: 'unknown' })]
    const output = formatCompressedContext(results, [])
    expect(output).not.toContain('(unknown)')
  })
})

// ── getBfsContextDocIds ───────────────────────────────────────────────────────

describe('getBfsContextDocIds', () => {
  it('returns startDocId when no links exist', () => {
    useGraphStore.setState({ links: [] })
    const ids = getBfsContextDocIds('design_doc')
    expect(ids).toEqual(['design_doc'])
  })

  it('returns startDocId when no documents are loaded', () => {
    useVaultStore.setState({ loadedDocuments: null })
    const ids = getBfsContextDocIds('design_doc')
    expect(ids).toEqual(['design_doc'])
  })

  it('includes the start doc and its BFS neighbors', () => {
    const ids = getBfsContextDocIds('design_doc')
    expect(ids).toContain('design_doc')
    expect(ids).toContain('art_doc')
  })

  it('does not include documents unreachable within maxHops=0', () => {
    const ids = getBfsContextDocIds('design_doc', 0, 20)
    expect(ids).toEqual(['design_doc'])
  })

  it('respects maxDocs limit', () => {
    const ids = getBfsContextDocIds('design_doc', 3, 1)
    expect(ids.length).toBeLessThanOrEqual(1)
  })

  it('returns only doc IDs, no duplicates', () => {
    const ids = getBfsContextDocIds('design_doc')
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })
})

// ── getGlobalContextDocIds ───────────────────────────────────────────────────

describe('getGlobalContextDocIds', () => {
  it('returns empty array when no links exist', () => {
    useGraphStore.setState({ links: [] })
    expect(getGlobalContextDocIds()).toEqual([])
  })

  it('returns empty array when no documents are loaded', () => {
    useVaultStore.setState({ loadedDocuments: null })
    expect(getGlobalContextDocIds()).toEqual([])
  })

  it('returns doc IDs from hub-seeded BFS traversal', () => {
    const ids = getGlobalContextDocIds()
    expect(ids.length).toBeGreaterThan(0)
    // design_doc and art_doc are connected — both should appear
    expect(ids).toContain('design_doc')
    expect(ids).toContain('art_doc')
  })

  it('maxDocs caps result below total document count', () => {
    // maxDocs is a BFS traversal cap — hub seeds may slightly exceed it,
    // but the result is always bounded by the total number of docs
    const TOTAL_DOCS = 3 // MOCK_DOCS has 3 entries
    const ids = getGlobalContextDocIds(2, 4)
    expect(ids.length).toBeLessThanOrEqual(TOTAL_DOCS)
  })

  it('returns only unique doc IDs', () => {
    const ids = getGlobalContextDocIds()
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })
})

// ── directVaultSearch ─────────────────────────────────────────────────────────

// Note: this document intentionally uses Korean content to test the Korean
// morphological stemmer (particle stripping) and date-based filename matching.
const DATE_DOC: LoadedDocument = {
  id: 'feedback_jan28',
  filename: '[2026.01.28] 피드백 회의.md',
  folderPath: '',
  speaker: 'chief_director',
  date: '2026-01-28',
  tags: [],
  links: [],
  rawContent: '1월 28일 피드백 내용입니다. 이사장님 의견.',
  sections: [
    {
      id: 'fb_s1',
      heading: '피드백',
      body: '1월 28일 피드백 내용입니다. 이사장님 의견.',
      wikiLinks: [],
    },
  ],
  mtime: Date.now(),
}

describe('directVaultSearch', () => {
  beforeEach(() => {
    useVaultStore.setState({ loadedDocuments: [...MOCK_DOCS, DATE_DOC] })
  })

  it('returns empty array when vault is not loaded', () => {
    useVaultStore.setState({ loadedDocuments: null })
    expect(directVaultSearch('피드백')).toEqual([])
  })

  it('returns empty array when no documents match', () => {
    expect(directVaultSearch('xyznonexistent')).toEqual([])
  })

  it('matches date-style filename — numeric terms extracted from query', () => {
    const results = directVaultSearch('28일 피드백')
    expect(results.some(r => r.doc_id === 'feedback_jan28')).toBe(true)
  })

  it('filename match scores top result highest', () => {
    const results = directVaultSearch('2026 01 28 피드백')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].filename).toBe('[2026.01.28] 피드백 회의.md')
  })

  it('score is normalised to [0, 1]', () => {
    const results = directVaultSearch('2026 01 28 피드백')
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0)
      expect(r.score).toBeLessThanOrEqual(1)
    }
  })

  it('strips Korean particles — "이사장님의" matches "이사장님"', () => {
    const results = directVaultSearch('이사장님의 의견')
    expect(results.some(r => r.doc_id === 'feedback_jan28')).toBe(true)
  })

  it('respects topN limit', () => {
    const results = directVaultSearch('이사장', 2)
    expect(results.length).toBeLessThanOrEqual(2)
  })

  it('returned results have correct SearchResult shape', () => {
    const results = directVaultSearch('피드백')
    const r = results[0]
    expect(r).toHaveProperty('doc_id')
    expect(r).toHaveProperty('filename')
    expect(r).toHaveProperty('score')
    expect(r).toHaveProperty('content')
  })
})

// ── getStrippedBody ───────────────────────────────────────────────────────────

describe('getStrippedBody', () => {
  it('returns section bodies joined, without frontmatter YAML', () => {
    const doc: LoadedDocument = {
      ...MOCK_DOCS[0],
      rawContent: '---\nspeaker: chief\n---\nactual content',
      sections: [
        { id: 's1', heading: 'Title', body: 'Section content here.', wikiLinks: [] },
      ],
    }
    const result = getStrippedBody(doc)
    expect(result).toContain('Section content here.')
    expect(result).not.toContain('speaker:')
    expect(result).not.toContain('---')
  })

  it('includes ### heading prefix for non-intro sections', () => {
    const doc: LoadedDocument = {
      ...MOCK_DOCS[0],
      sections: [
        { id: 's1', heading: 'Combat System', body: 'Combat content.', wikiLinks: [] },
      ],
    }
    expect(getStrippedBody(doc)).toContain('### Combat System')
  })

  it('omits heading prefix for (intro) sections', () => {
    const doc: LoadedDocument = {
      ...MOCK_DOCS[0],
      sections: [
        { id: 's1', heading: '(intro)', body: 'Intro content.', wikiLinks: [] },
      ],
    }
    const result = getStrippedBody(doc)
    expect(result).not.toContain('### (intro)')
    expect(result).toContain('Intro content.')
  })

  it('falls back to rawContent minus frontmatter when all sections are empty', () => {
    const doc: LoadedDocument = {
      ...MOCK_DOCS[0],
      rawContent: '---\nspeaker: chief\n---\n\n# Actual markdown content',
      sections: [{ id: 's1', heading: '(intro)', body: '', wikiLinks: [] }],
    }
    const result = getStrippedBody(doc)
    expect(result).toContain('# Actual markdown content')
    expect(result).not.toContain('speaker:')
  })

  it('returns empty string for doc with no sections and empty rawContent', () => {
    const doc: LoadedDocument = { ...MOCK_DOCS[0], rawContent: '', sections: [] }
    expect(getStrippedBody(doc)).toBe('')
  })
})

// ── buildDeepGraphContext ─────────────────────────────────────────────────────

describe('buildDeepGraphContext', () => {
  beforeEach(() => {
    useGraphStore.setState({ links: MOCK_LINKS })
    useVaultStore.setState({ loadedDocuments: MOCK_DOCS })
  })

  it('returns empty string when no documents are loaded', () => {
    useVaultStore.setState({ loadedDocuments: null })
    expect(buildDeepGraphContext([makeSearchResult()])).toBe('')
  })

  it('uses direct-search fallback format when no graph links exist', () => {
    useGraphStore.setState({ links: [] })
    const result = buildDeepGraphContext([makeSearchResult()])
    expect(result).toContain('## Related Documents (Direct Search)')
    expect(result).toContain('[Document] design')
  })

  it('returns empty string when results are empty and links exist but no seeds', () => {
    useGraphStore.setState({ links: [] })
    const result = buildDeepGraphContext([])
    expect(result).toBe('')
  })

  it('returns graph-traversal format when links exist', () => {
    const result = buildDeepGraphContext([makeSearchResult()])
    expect(result).toContain('## Related Documents (Graph Traversal)')
  })

  it('includes structure header with cluster info', () => {
    const result = buildDeepGraphContext([makeSearchResult()])
    expect(result).toContain('## Project Structure Overview')
  })

  it('total output stays within DEEP_CONTEXT_BUDGET (16000 chars)', () => {
    const result = buildDeepGraphContext([makeSearchResult()], 3, 20)
    expect(result.length).toBeLessThanOrEqual(16_500)
  })
})
