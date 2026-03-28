/**
 * vaultToChunks.ts — Phase 1-3
 *
 * Converts LoadedDocument[] to BackendChunk[] by flattening sections.
 * Each section becomes one chunk (further splitting happens in the Python backend
 * via LangChain's RecursiveCharacterTextSplitter).
 */

import type { LoadedDocument, BackendChunk } from '@/types'

/**
 * Flatten vault documents into BackendChunk[] ready for ChromaDB indexing.
 *
 * - One chunk per DocSection (body text)
 * - Doc-level metadata (speaker, tags) propagated to every chunk
 * - Sections with empty body are skipped
 */
export function vaultDocsToChunks(docs: LoadedDocument[]): BackendChunk[] {
  return docs.flatMap((doc) =>
    doc.sections
      .filter((section) => section.body.trim().length > 0)
      .map((section) => ({
        doc_id: doc.id,
        filename: doc.filename,
        section_id: section.id,
        heading: section.heading,
        speaker: doc.speaker,
        content: section.body,
        tags: doc.tags,
      }))
  )
}
