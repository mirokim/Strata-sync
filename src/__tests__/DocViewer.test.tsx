import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useUIStore } from '@/stores/uiStore'
import { useGraphStore } from '@/stores/graphStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { MOCK_DOCUMENTS } from '@/data/mockDocuments'
import { MOCK_NODES } from '@/data/mockGraph'
import { parseWikiLinks } from '@/lib/wikiLinkParser'
import { DEFAULT_PHYSICS } from '@/stores/graphStore'

// Give jsdom a non-zero container size so @tanstack/react-virtual renders items
const mockRect = { width: 800, height: 600, top: 0, left: 0, bottom: 600, right: 800, x: 0, y: 0, toJSON: () => ({}) }
let rectSpy: ReturnType<typeof vi.spyOn>

let DocViewer: typeof import('@/components/docViewer/DocViewer').default

beforeEach(async () => {
  rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(mockRect as DOMRect)
  useUIStore.setState({
    appState: 'main', centerTab: 'document',
    selectedDocId: null, theme: 'dark', graphMode: '2d',
  })
  useGraphStore.setState({
    nodes: MOCK_NODES, links: [],
    selectedNodeId: null, hoveredNodeId: null,
    physics: { ...DEFAULT_PHYSICS },
  })
  const mod = await import('@/components/docViewer/DocViewer')
  DocViewer = mod.default
})

afterEach(() => {
  rectSpy.mockRestore()
})

describe('DocViewer — empty state', () => {
  it('shows empty prompt when no document is selected', () => {
    render(<DocViewer />)
    expect(screen.getByTestId('doc-viewer-empty')).toBeInTheDocument()
  })

  it('does not show doc-viewer when nothing is selected', () => {
    render(<DocViewer />)
    expect(screen.queryByTestId('doc-viewer')).toBeNull()
  })
})

describe('DocViewer — document render', () => {
  const doc = MOCK_DOCUMENTS[0]

  beforeEach(() => {
    useUIStore.setState({ ...useUIStore.getState(), selectedDocId: doc.id })
  })

  it('renders the doc-viewer container', () => {
    render(<DocViewer />)
    expect(screen.getByTestId('doc-viewer')).toBeInTheDocument()
  })

  it('displays the document filename', () => {
    render(<DocViewer />)
    expect(screen.getByTestId('doc-filename')).toHaveTextContent(doc.filename)
  })

  it('renders the correct number of sections', () => {
    render(<DocViewer />)
    const blocks = screen.getAllByTestId(/^paragraph-block-/)
    expect(blocks.length).toBe(doc.sections.length)
  })

  it('renders all section headings', () => {
    render(<DocViewer />)
    for (const section of doc.sections) {
      expect(screen.getByText(section.heading)).toBeInTheDocument()
    }
  })

  it('renders FrontmatterBlock', () => {
    render(<DocViewer />)
    expect(screen.getByTestId('frontmatter-block')).toBeInTheDocument()
  })

  it('displays speaker label badge', () => {
    render(<DocViewer />)
    // SPEAKER_CONFIG['chief_director'].label is 'Chief' — may appear multiple times
    const chiefs = screen.getAllByText('Chief')
    expect(chiefs.length).toBeGreaterThanOrEqual(1)
  })

  it('displays date', () => {
    render(<DocViewer />)
    expect(screen.getByText(doc.date)).toBeInTheDocument()
  })

  it('displays tags', () => {
    render(<DocViewer />)
    for (const tag of doc.tags) {
      expect(screen.getByText(`#${tag}`)).toBeInTheDocument()
    }
  })
})

describe('FrontmatterBlock — toggle', () => {
  beforeEach(() => {
    useUIStore.setState({ ...useUIStore.getState(), selectedDocId: MOCK_DOCUMENTS[0].id })
  })

  it('frontmatter body is hidden by default', () => {
    render(<DocViewer />)
    expect(screen.queryByTestId('frontmatter-body')).toBeNull()
  })

  it('clicking toggle shows frontmatter body', () => {
    render(<DocViewer />)
    fireEvent.click(screen.getByTestId('frontmatter-toggle'))
    expect(screen.getByTestId('frontmatter-body')).toBeInTheDocument()
  })

  it('clicking toggle twice hides frontmatter body again', () => {
    render(<DocViewer />)
    const toggle = screen.getByTestId('frontmatter-toggle')
    fireEvent.click(toggle)
    fireEvent.click(toggle)
    expect(screen.queryByTestId('frontmatter-body')).toBeNull()
  })
})

describe('ParagraphBlock — hover highlight', () => {
  beforeEach(() => {
    useUIStore.setState({ ...useUIStore.getState(), selectedDocId: MOCK_DOCUMENTS[0].id })
    // Hover only works in 'medium' or 'high' quality — 'fast' disables onMouseEnter
    useSettingsStore.setState({ paragraphRenderQuality: 'medium' })
  })

  it('sets data-hovered on mouse enter', () => {
    render(<DocViewer />)
    const firstSection = MOCK_DOCUMENTS[0].sections[0]
    const block = screen.getByTestId(`paragraph-block-${firstSection.id}`)
    fireEvent.mouseEnter(block)
    expect(block).toHaveAttribute('data-hovered', 'true')
  })

  it('removes data-hovered on mouse leave', () => {
    render(<DocViewer />)
    const firstSection = MOCK_DOCUMENTS[0].sections[0]
    const block = screen.getByTestId(`paragraph-block-${firstSection.id}`)
    fireEvent.mouseEnter(block)
    fireEvent.mouseLeave(block)
    expect(block).not.toHaveAttribute('data-hovered')
  })
})

describe('WikiLink — navigation', () => {
  beforeEach(() => {
    // WikiLink components only render in 'high' quality mode
    useSettingsStore.setState({ paragraphRenderQuality: 'high' })
  })

  it('clicking a wiki link navigates to the matching graph node', () => {
    // Find a doc+section that has at least one wikiLink that resolves to another doc's section
    // Phase 7: nodes are document-level, so wikiLink slugs match section IDs → parent doc
    const doc = MOCK_DOCUMENTS.find(d =>
      d.sections.some(s => s.wikiLinks.some(slug => {
        // Check if slug matches another doc's section ID
        const targetDoc = MOCK_DOCUMENTS.find(td =>
          td.id !== d.id && td.sections.some(ts => ts.id === slug)
        )
        return !!targetDoc
      }))
    )!
    const section = doc.sections.find(s =>
      s.wikiLinks.some(slug =>
        MOCK_DOCUMENTS.some(td => td.id !== doc.id && td.sections.some(ts => ts.id === slug))
      )
    )!
    const slug = section.wikiLinks.find(s =>
      MOCK_DOCUMENTS.some(td => td.id !== doc.id && td.sections.some(ts => ts.id === s))
    )!
    // The target node is the document containing the section with that slug
    const targetDoc = MOCK_DOCUMENTS.find(td =>
      td.sections.some(ts => ts.id === slug)
    )!
    const targetNode = MOCK_NODES.find(n => n.id === targetDoc.id)!

    useUIStore.setState({ ...useUIStore.getState(), selectedDocId: doc.id })
    render(<DocViewer />)

    const link = screen.getByTestId(`wiki-link-${slug}`)
    fireEvent.click(link)

    expect(useGraphStore.getState().selectedNodeId).toBe(targetNode.id)
    expect(useUIStore.getState().centerTab).toBe('graph')
    expect(useUIStore.getState().selectedDocId).toBe(targetNode.docId)
  })
})

describe('parseWikiLinks — unit tests', () => {
  it('returns single text segment with no wiki links', () => {
    const result = parseWikiLinks('plain text')
    expect(result).toEqual([{ type: 'text', value: 'plain text' }])
  })

  it('parses a single wiki link', () => {
    const result = parseWikiLinks('See [[tone_manner_guide]] for details')
    expect(result).toEqual([
      { type: 'text', value: 'See ' },
      { type: 'wikilink', slug: 'tone_manner_guide' },
      { type: 'text', value: ' for details' },
    ])
  })

  it('parses multiple wiki links', () => {
    const result = parseWikiLinks('[[a]] and [[b]]')
    expect(result.filter(s => s.type === 'wikilink')).toHaveLength(2)
  })

  it('handles wiki link at start of string', () => {
    const result = parseWikiLinks('[[slug]] trailing')
    expect(result[0]).toEqual({ type: 'wikilink', slug: 'slug' })
  })

  it('handles wiki link at end of string', () => {
    const result = parseWikiLinks('leading [[slug]]')
    expect(result[result.length - 1]).toEqual({ type: 'wikilink', slug: 'slug' })
  })

  it('returns empty array for empty string', () => {
    expect(parseWikiLinks('')).toEqual([])
  })
})
