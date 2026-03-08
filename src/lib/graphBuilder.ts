/**
 * graphBuilder.ts — Phase 7
 *
 * Generic graph construction from any document type (MockDocument or LoadedDocument).
 *
 * Key change from Phase 6: ONE node per DOCUMENT (matching Obsidian's graph).
 * Previously created one node per section, which produced many unwanted "(intro)" nodes.
 *
 * Supports Obsidian-style "phantom nodes": wiki link targets that don't have
 * a corresponding .md file still appear as nodes in the graph.
 */

import type { GraphNode, GraphLink, MockDocument, LoadedDocument, SpeakerId } from '@/types'
import { DEFAULT_LINK_STRENGTH } from '@/lib/constants'
import { slugify, truncate } from '@/lib/utils'

// Internal union type — both shapes are structurally compatible
type AnyDocument = MockDocument | LoadedDocument

// ── buildGraphNodes ───────────────────────────────────────────────────────────

/**
 * Derive GraphNode[] from a document array.
 * One node per DOCUMENT (not per section). Node id === doc.id.
 */
export function buildGraphNodes(documents: AnyDocument[]): GraphNode[] {
  return documents.map((doc) => ({
    id: doc.id,
    docId: doc.id,
    speaker: doc.speaker as SpeakerId,
    label: truncate(doc.filename.replace(/\.md$/i, ''), 36),
    folderPath: (doc as LoadedDocument).folderPath,
    tags: doc.tags?.length ? doc.tags : undefined,
  }))
}

// ── buildGraphLinks ───────────────────────────────────────────────────────────

/**
 * Derive GraphLink[] by resolving wikiLinks to document-level graph nodes.
 *
 * Resolution strategies (in order):
 *   1. Direct doc ID match: wiki link matches an existing doc node ID
 *   2. Section ID → parent doc: wiki link matches a section ID (mock data style)
 *   3. Filename match: wiki link matches a document filename (Obsidian style)
 *   4. Phantom node: create a ghost node for unresolved wiki links
 *
 * Deduplicates bidirectional pairs (A→B same as B→A).
 */
export function buildGraphLinks(
  documents: AnyDocument[],
  nodes: GraphNode[]
): { links: GraphLink[]; phantomNodes: GraphNode[] } {
  const nodeIds = new Set(nodes.map((n) => n.id))

  // Lookup: section.id → parent doc.id (for mock data where wiki links = section IDs)
  const sectionIdToDocId = new Map<string, string>()
  for (const doc of documents) {
    for (const section of doc.sections) {
      sectionIdToDocId.set(section.id, doc.id)
    }
  }

  // Lookup: normalised filename (without .md) → doc.id (for Obsidian [[note name]] style)
  const filenameToDocId = new Map<string, string>()
  for (const doc of documents) {
    const filename = doc.filename.replace(/\.md$/i, '')
    filenameToDocId.set(filename.toLowerCase(), doc.id)
  }

  const links: GraphLink[] = []
  const seen = new Set<string>()
  const phantomNodes = new Map<string, GraphNode>() // id → node

  for (const doc of documents) {
    for (const section of doc.sections) {
      for (const rawLink of section.wikiLinks) {
        // Handle [[target|display]] alias syntax and [[target#heading]] anchors
        // Also strip trailing path separators: Windows wiki links like [[Note\]] are common
        const target = rawLink.split('|')[0].split('#')[0].trim().replace(/[/\\]+$/, '').trim()
        if (!target) continue

        let targetDocId: string | undefined

        // Strategy 1: direct doc ID match
        if (nodeIds.has(target)) {
          targetDocId = target
        }

        // Strategy 2: section ID → parent document (mock data style)
        if (!targetDocId) {
          targetDocId = sectionIdToDocId.get(target)
        }

        // Strategy 3: filename match (Obsidian [[note name]] style)
        if (!targetDocId) {
          targetDocId = filenameToDocId.get(target.toLowerCase())
        }

        // Strategy 3b: subpath wiki link [[Folder/Note]] or [[Folder\Note]] → try basename only
        if (!targetDocId && (target.includes('/') || target.includes('\\'))) {
          const basename = target.split(/[/\\]/).pop()?.trim() ?? ''
          if (basename) targetDocId = filenameToDocId.get(basename.toLowerCase())
        }

        // Strategy 4: create phantom node for unresolved wiki links
        if (!targetDocId) {
          const phantomId = `_phantom_${slugify(target)}`
          if (!phantomNodes.has(phantomId)) {
            phantomNodes.set(phantomId, {
              id: phantomId,
              docId: phantomId,
              speaker: 'unknown' as SpeakerId,
              label: truncate(target, 36),
            })
            nodeIds.add(phantomId)
          }
          targetDocId = phantomId
        }

        // Skip self-links (section linking to its own document)
        if (targetDocId === doc.id) continue

        const key = [doc.id, targetDocId].sort().join('→')
        if (seen.has(key)) continue
        seen.add(key)
        links.push({ source: doc.id, target: targetDocId, strength: DEFAULT_LINK_STRENGTH })
      }
    }
  }
  return { links, phantomNodes: Array.from(phantomNodes.values()) }
}

// ── buildImageNodes ───────────────────────────────────────────────────────────

/**
 * Create image gallery nodes from ![[image.png]] refs found in LoadedDocument.imageRefs.
 * - One gallery node per document (even if there are multiple images)
 * - Clicking a gallery node shows all images from that document in a gallery view
 * - ID format: `gallery:{doc.id}` (e.g. "gallery:my-note.md")
 */
function buildImageNodes(
  documents: AnyDocument[],
): { imageNodes: GraphNode[]; imageLinks: GraphLink[] } {
  const imageNodes: GraphNode[] = []
  const imageLinks: GraphLink[] = []

  for (const doc of documents) {
    const refs = (doc as LoadedDocument).imageRefs
    if (!refs?.length) continue

    const galleryId = `gallery:${doc.id}`
    const count = refs.length
    // Label: filename for a single image, "filename + N more" for multiple
    const firstName = (refs[0].split(/[/\\]/).pop() ?? refs[0]).replace(/\.[^.]+$/, '')
    const label = count === 1
      ? truncate(firstName, 36)
      : truncate(`${firstName} +${count - 1} more`, 36)

    imageNodes.push({
      id: galleryId,
      docId: galleryId,
      speaker: 'unknown' as SpeakerId,
      label,
      isImage: true,
    })

    imageLinks.push({ source: doc.id, target: galleryId, strength: 0.3 })
  }

  return { imageNodes, imageLinks }
}

// ── buildGraph ────────────────────────────────────────────────────────────────

/** Convenience: build both nodes and links in one call */
export function buildGraph(
  documents: AnyDocument[]
): { nodes: GraphNode[]; links: GraphLink[] } {
  const docNodes = buildGraphNodes(documents)
  const { links, phantomNodes } = buildGraphLinks(documents, docNodes)
  const { imageNodes, imageLinks } = buildImageNodes(documents)
  return {
    nodes: [...docNodes, ...phantomNodes, ...imageNodes],
    links: [...links, ...imageLinks],
  }
}
