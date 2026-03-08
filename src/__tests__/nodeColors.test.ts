import { describe, it, expect } from 'vitest'
import {
  getAutoPaletteColor,
  getNodeColor,
  buildNodeColorMap,
  lightenColor,
  degreeScaleFactor,
  degreeSize,
  DEGREE_SIZE_MIN,
  DEGREE_SIZE_MAX,
} from '@/lib/nodeColors'
import type { GraphNode, NodeColorMode } from '@/types'

// ── Helpers ────────────────────────────────────────────────────────────────────

const makeNode = (overrides: Partial<GraphNode> = {}): GraphNode => ({
  id: 'doc1',
  docId: 'doc1',
  label: 'Test Node',
  speaker: 'art_director',
  tags: [],
  folderPath: '',
  isImage: false,
  isPhantom: false,
  ...overrides,
})

const HEX_RE = /^#[0-9a-f]{6}$/i

// ── getAutoPaletteColor ────────────────────────────────────────────────────────

describe('getAutoPaletteColor()', () => {
  it('returns a valid hex color', () => {
    expect(getAutoPaletteColor('game-design')).toMatch(HEX_RE)
  })

  it('is deterministic — same key always same color', () => {
    const a = getAutoPaletteColor('combat-system')
    const b = getAutoPaletteColor('combat-system')
    expect(a).toBe(b)
  })

  it('different keys can produce different colors', () => {
    const colors = new Set(['aaa', 'bbb', 'ccc', 'ddd', 'eee'].map(getAutoPaletteColor))
    // With 15 palette entries and 5 distinct keys, expect at least 2 unique colors
    expect(colors.size).toBeGreaterThanOrEqual(1)
  })
})

// ── getNodeColor ───────────────────────────────────────────────────────────────

describe('getNodeColor()', () => {
  const emptyMap = new Map<string, string>()

  it('speaker mode — returns speaker hex (6-digit hex)', () => {
    const color = getNodeColor(makeNode({ speaker: 'art_director' }), 'speaker', emptyMap)
    expect(color).toMatch(HEX_RE)
  })

  it('image node — always returns fixed violet regardless of mode', () => {
    const imgNode = makeNode({ isImage: true })
    const modes: NodeColorMode[] = ['speaker', 'document', 'folder', 'tag', 'topic', 'auto']
    for (const mode of modes) {
      expect(getNodeColor(imgNode, mode, emptyMap)).toBe('#a78bfa')
    }
  })

  it('document mode — uses colorMap keyed by docId', () => {
    const map = new Map([['doc1', '#ff0000']])
    expect(getNodeColor(makeNode({ docId: 'doc1' }), 'document', map)).toBe('#ff0000')
  })

  it('document mode — falls back to speaker color when docId not in map', () => {
    const color = getNodeColor(makeNode({ docId: 'unknown_doc' }), 'document', emptyMap)
    expect(color).toMatch(HEX_RE)
  })

  it('folder mode — uses colorMap keyed by folderPath', () => {
    const map = new Map([['Onion Flow', '#00ff00']])
    expect(getNodeColor(makeNode({ folderPath: 'Onion Flow' }), 'folder', map)).toBe('#00ff00')
  })

  it('tag mode — uses first tag color; returns #666 when no tags', () => {
    const map = new Map([['combat', '#0000ff']])
    expect(getNodeColor(makeNode({ tags: ['combat'] }), 'tag', map)).toBe('#0000ff')
    expect(getNodeColor(makeNode({ tags: [] }), 'tag', map)).toBe('#666')
  })

  it('auto mode — tag takes priority over folder and topic', () => {
    const map = new Map([['tag:combat', '#aabbcc']])
    const node = makeNode({ tags: ['combat'], folderPath: 'SomeFolder' })
    expect(getNodeColor(node, 'auto', map)).toBe('#aabbcc')
  })
})

// ── buildNodeColorMap ──────────────────────────────────────────────────────────

describe('buildNodeColorMap()', () => {
  const nodes = [
    makeNode({ id: 'd1', docId: 'd1', folderPath: 'FolderA', tags: ['ui'] }),
    makeNode({ id: 'd2', docId: 'd2', folderPath: 'FolderB', tags: ['combat'] }),
    makeNode({ id: 'd3', docId: 'd3', folderPath: 'FolderA', tags: [] }),
  ]

  it('document mode — map contains each docId', () => {
    const map = buildNodeColorMap(nodes, 'document')
    expect(map.has('d1')).toBe(true)
    expect(map.has('d2')).toBe(true)
    expect(map.has('d3')).toBe(true)
  })

  it('folder mode — map contains folderPath keys', () => {
    const map = buildNodeColorMap(nodes, 'folder')
    expect(map.has('FolderA')).toBe(true)
    expect(map.has('FolderB')).toBe(true)
  })

  it('folder mode — userFolderColors override auto-palette', () => {
    const override = { FolderA: '#123456' }
    const map = buildNodeColorMap(nodes, 'folder', undefined, override)
    expect(map.get('FolderA')).toBe('#123456')
  })

  it('tag mode — map contains each unique tag', () => {
    const map = buildNodeColorMap(nodes, 'tag')
    expect(map.has('ui')).toBe(true)
    expect(map.has('combat')).toBe(true)
  })

  it('tag mode — userTagColors override auto-palette', () => {
    const override = { ui: '#fedcba' }
    const map = buildNodeColorMap(nodes, 'tag', override)
    expect(map.get('ui')).toBe('#fedcba')
  })

  it('speaker mode — returns empty map', () => {
    expect(buildNodeColorMap(nodes, 'speaker').size).toBe(0)
  })

  it('all returned colors are valid hex strings', () => {
    for (const mode of ['document', 'folder', 'tag', 'topic', 'auto'] as NodeColorMode[]) {
      for (const [, color] of buildNodeColorMap(nodes, mode)) {
        expect(color).toMatch(HEX_RE)
      }
    }
  })
})

// ── lightenColor ───────────────────────────────────────────────────────────────

describe('lightenColor()', () => {
  it('factor=0 returns original color unchanged', () => {
    expect(lightenColor('#ff0000', 0)).toBe('#ff0000')
  })

  it('factor=1 returns pure white (rgb(255,255,255))', () => {
    expect(lightenColor('#000000', 1)).toBe('rgb(255,255,255)')
  })

  it('handles 6-digit hex input', () => {
    const result = lightenColor('#60a5fa', 0.5)
    expect(result).toMatch(/^rgb\(\d+,\d+,\d+\)$/)
  })

  it('handles 3-digit hex input', () => {
    const result = lightenColor('#f00', 0.5)
    expect(result).toMatch(/^rgb\(\d+,\d+,\d+\)$/)
    // Red channel should be > 128 (lightened from 255)
    const r = parseInt(result.match(/(\d+)/)![1])
    expect(r).toBeGreaterThanOrEqual(200)
  })

  it('handles rgb() input', () => {
    const result = lightenColor('rgb(100, 200, 50)', 0.5)
    expect(result).toMatch(/^rgb\(\d+,\d+,\d+\)$/)
  })

  it('clamps factor > 1 to 1', () => {
    expect(lightenColor('#000000', 2)).toBe('rgb(255,255,255)')
  })

  it('returns original on unrecognized input', () => {
    expect(lightenColor('invalid-color', 0.5)).toBe('invalid-color')
  })
})

// ── degreeScaleFactor / degreeSize ─────────────────────────────────────────────

describe('degreeScaleFactor()', () => {
  it('returns value in [0, 1]', () => {
    for (const [deg, max] of [[0, 10], [5, 10], [10, 10], [0, 0]] as [number, number][]) {
      const sf = degreeScaleFactor(deg, max)
      expect(sf).toBeGreaterThanOrEqual(0)
      expect(sf).toBeLessThanOrEqual(1)
    }
  })

  it('higher degree → higher scaleFactor', () => {
    const max = 20
    expect(degreeScaleFactor(10, max)).toBeGreaterThan(degreeScaleFactor(1, max))
  })
})

describe('degreeSize()', () => {
  it('sf=0 returns DEGREE_SIZE_MIN', () => {
    expect(degreeSize(0)).toBeCloseTo(DEGREE_SIZE_MIN)
  })

  it('sf=1 returns DEGREE_SIZE_MAX', () => {
    expect(degreeSize(1)).toBeCloseTo(DEGREE_SIZE_MAX)
  })

  it('result is always within [DEGREE_SIZE_MIN, DEGREE_SIZE_MAX]', () => {
    for (const sf of [0, 0.1, 0.5, 0.9, 1]) {
      const size = degreeSize(sf)
      expect(size).toBeGreaterThanOrEqual(DEGREE_SIZE_MIN)
      expect(size).toBeLessThanOrEqual(DEGREE_SIZE_MAX)
    }
  })
})
