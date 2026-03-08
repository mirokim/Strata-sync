/**
 * nodeColors.ts
 *
 * Automatic color palette assignment for graph nodes.
 * Supports modes: speaker, document, auto, folder, tag, topic
 *
 * Obsidian-compatible: palette is deterministic for consistent colors
 * across sessions (same folder/tag/topic always gets the same color).
 */

import type { GraphNode, NodeColorMode } from '@/types'
import { SPEAKER_CONFIG } from '@/lib/speakerConfig'

// Visually distinct palette (HSL-spaced, dark-theme friendly)
const AUTO_PALETTE = [
  '#60a5fa', // blue-400
  '#f472b6', // pink-400
  '#34d399', // emerald-400
  '#fbbf24', // amber-400
  '#a78bfa', // violet-400
  '#f87171', // red-400
  '#2dd4bf', // teal-400
  '#fb923c', // orange-400
  '#818cf8', // indigo-400
  '#4ade80', // green-400
  '#e879f9', // fuchsia-400
  '#facc15', // yellow-400
  '#38bdf8', // sky-400
  '#c084fc', // purple-400
  '#6ee7b7', // emerald-300
]

// Common stop words to skip when extracting topic from headings
const STOP_WORDS = new Set([
  // English
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'to', 'of', 'in', 'on', 'at', 'by',
  'for', 'with', 'about', 'from', 'and', 'or', 'not', 'no', 'but', 'as',
  'this', 'that', 'these', 'those', 'it', 'its', 'how', 'what', 'when',
  'overview', 'summary', 'notes', 'note', 'section', 'chapter', 'part',
  // Korean particles / common words (kept for Korean vault support)
  '의', '은', '는', '이', '가', '을', '를', '에', '도', '로', '와', '과',
  '한', '하는', '하기', '하여', '하고', '하면', '된', '되는', '대한',
  '관한', '및', '위한', '통한', '관련', '개요', '정리', '내용', '구조',
])

/**
 * Extract the first meaningful word from a node label (section heading).
 * Used as the "topic" key for color assignment.
 * e.g. "Combat Design Overview" → "combat"
 *      "UI Layout Guide" → "ui"
 *      "Level Flow Design" → "level"
 */
function extractTopic(label: string): string {
  const words = label
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOP_WORDS.has(w))
  return words[0] ?? label.slice(0, 6).toLowerCase()
}

/**
 * Simple deterministic hash for a string → palette index.
 * Same string always maps to same color.
 */
function hashIndex(str: string, paletteSize: number): number {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0
  }
  return h % paletteSize
}

/**
 * Build a color lookup Map<key, hexColor> from a list of unique keys.
 * Keys are sorted first so insertion order doesn't affect assignment.
 */
function buildColorMap(keys: string[]): Map<string, string> {
  const sorted = [...new Set(keys)].sort()
  const map = new Map<string, string>()
  sorted.forEach((key) => {
    map.set(key, AUTO_PALETTE[hashIndex(key, AUTO_PALETTE.length)])
  })
  return map
}

/**
 * Return the deterministic auto-palette color for a given key string.
 * Useful for pre-assigning a default color when creating a new tag.
 */
export function getAutoPaletteColor(key: string): string {
  return AUTO_PALETTE[hashIndex(key, AUTO_PALETTE.length)]
}

/**
 * Get a hex color for a node based on the current color mode.
 * Falls back to the speaker color for phantom nodes / missing data.
 */
function speakerHex(node: GraphNode): string {
  const n = SPEAKER_CONFIG[node.speaker]?.hex
  if (n == null) return '#888'
  // SPEAKER_CONFIG.hex is a Three.js number (0xRRGGBB) — convert to CSS hex string
  return '#' + n.toString(16).padStart(6, '0')
}

/** Fixed color for image nodes — applied uniformly across all colorModes */
const IMAGE_NODE_COLOR = '#a78bfa' // violet-400

export function getNodeColor(
  node: GraphNode,
  mode: NodeColorMode,
  colorMap: Map<string, string>,
): string {
  // Image nodes always use fixed violet regardless of colorMode
  if (node.isImage) return IMAGE_NODE_COLOR

  if (mode === 'document') {
    return colorMap.get(node.docId) ?? speakerHex(node)
  }
  if (mode === 'auto') {
    // Cascade: tag (user-assigned) > folder > topic > speaker fallback
    const firstTag = node.tags?.[0]
    if (firstTag) return colorMap.get('tag:' + firstTag) ?? speakerHex(node)
    if (node.folderPath) return colorMap.get('folder:' + node.folderPath) ?? speakerHex(node)
    const topic = extractTopic(node.label)
    return colorMap.get('topic:' + topic) ?? speakerHex(node)
  }
  if (mode === 'folder') {
    const key = node.folderPath ?? ''
    return colorMap.get(key) ?? speakerHex(node)
  }
  if (mode === 'tag') {
    const firstTag = node.tags?.[0]
    if (firstTag) return colorMap.get(firstTag) ?? speakerHex(node)
    return '#666' // no tags → dim gray
  }
  if (mode === 'topic') {
    const topic = extractTopic(node.label)
    return colorMap.get(topic) ?? speakerHex(node)
  }
  // 'speaker' mode
  return speakerHex(node)
}


/**
 * Build the color lookup map for a set of nodes and a given mode.
 * For 'speaker' mode the map is empty (colors come from SPEAKER_CONFIG directly).
 * For 'auto' mode, keys are namespaced: 'tag:X', 'folder:X', 'topic:X'.
 *
 * userTagColors / userFolderColors override auto-palette assignments.
 */
export function buildNodeColorMap(
  nodes: GraphNode[],
  mode: NodeColorMode,
  userTagColors?: Record<string, string>,
  userFolderColors?: Record<string, string>
): Map<string, string> {
  if (mode === 'document') {
    const docIds = nodes.map(n => n.docId)
    return buildColorMap(docIds)
  }
  if (mode === 'auto') {
    // Each node contributes exactly one key based on cascade priority
    const keys = nodes.map(n => {
      const firstTag = n.tags?.[0]
      if (firstTag) return 'tag:' + firstTag
      if (n.folderPath) return 'folder:' + n.folderPath
      return 'topic:' + extractTopic(n.label)
    })
    const map = buildColorMap(keys)
    if (userTagColors) {
      for (const [tag, color] of Object.entries(userTagColors)) {
        if (color) map.set('tag:' + tag, color)
      }
    }
    if (userFolderColors) {
      for (const [folder, color] of Object.entries(userFolderColors)) {
        if (color) map.set('folder:' + folder, color)
      }
    }
    return map
  }
  if (mode === 'folder') {
    const folders = nodes.map(n => n.folderPath ?? '')
    const map = buildColorMap(folders)
    if (userFolderColors) {
      for (const [folder, color] of Object.entries(userFolderColors)) {
        if (color) map.set(folder, color)
      }
    }
    return map
  }
  if (mode === 'tag') {
    const tags = nodes.flatMap(n => n.tags ?? [])
    const map = buildColorMap(tags)
    if (userTagColors) {
      for (const [tag, color] of Object.entries(userTagColors)) {
        if (color) map.set(tag, color)
      }
    }
    return map
  }
  if (mode === 'topic') {
    const topics = nodes.map(n => extractTopic(n.label))
    return buildColorMap(topics)
  }
  return new Map()
}

/**
 * Lighten a color toward white by `factor` (0 = original, 1 = white).
 * Supports #rrggbb, #rgb, and rgb(r,g,b) inputs.
 */
export function lightenColor(color: string, factor: number): string {
  if (factor <= 0) return color
  const f = Math.min(1, Math.max(0, factor))
  let r: number, g: number, b: number

  if (color.startsWith('rgb')) {
    // rgb(r, g, b) format
    const m = color.match(/(\d+),\s*(\d+),\s*(\d+)/)
    if (!m) return color
    r = parseInt(m[1]); g = parseInt(m[2]); b = parseInt(m[3])
  } else {
    const h = color.replace('#', '')
    const full = h.length === 3
      ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
      : h
    r = parseInt(full.slice(0, 2), 16)
    g = parseInt(full.slice(2, 4), 16)
    b = parseInt(full.slice(4, 6), 16)
  }
  if (isNaN(r) || isNaN(g) || isNaN(b)) return color
  return `rgb(${Math.round(r + (255 - r) * f)},${Math.round(g + (255 - g) * f)},${Math.round(b + (255 - b) * f)})`
}

/**
 * Compute Obsidian-style degree scale factor (0–1) for a node.
 * scaleFactor → closer to 1 for high-degree nodes, closer to 0 for isolated ones.
 */
export function degreeScaleFactor(degree: number, maxDegree: number): number {
  return Math.sqrt((degree + 1) / (Math.max(1, maxDegree) + 1))
}

/** Min size ratio for zero-degree nodes (relative to physics.nodeRadius) */
export const DEGREE_SIZE_MIN = 0.2
/** Max size ratio for max-degree nodes (relative to physics.nodeRadius). >1 = larger than base */
export const DEGREE_SIZE_MAX = 2.0
/** Max white-mix ratio for zero-degree nodes */
export const DEGREE_LIGHT_MAX = 0.65

/**
 * Convert a degree scale factor (0–1) to a size multiplier in [DEGREE_SIZE_MIN, DEGREE_SIZE_MAX].
 * Use: finalRadius = baseRadius * degreeSize(sf)
 */
export function degreeSize(sf: number): number {
  return DEGREE_SIZE_MIN + sf * (DEGREE_SIZE_MAX - DEGREE_SIZE_MIN)
}
