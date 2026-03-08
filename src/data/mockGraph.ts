/**
 * mockGraph.ts — Phase 7 refactor
 *
 * Now a thin wrapper around the generic graphBuilder.ts.
 * Phase 7: one node per document (not per section).
 */

import type { GraphNode, GraphLink } from '@/types'
import { MOCK_DOCUMENTS } from './mockDocuments'
import {
  buildGraphNodes as _buildGraphNodes,
  buildGraphLinks as _buildGraphLinks,
} from '@/lib/graphBuilder'

/**
 * Derive GraphNode[] from mock documents.
 * @deprecated Use graphBuilder.buildGraphNodes(docs) directly for non-mock data.
 */
export function buildGraphNodes(): GraphNode[] {
  return _buildGraphNodes(MOCK_DOCUMENTS)
}

/**
 * Derive GraphLink[] from mock documents.
 * @deprecated Use graphBuilder.buildGraphLinks(docs, nodes) directly for non-mock data.
 */
export function buildGraphLinks(nodes: GraphNode[]): GraphLink[] {
  return _buildGraphLinks(MOCK_DOCUMENTS, nodes).links
}

export const MOCK_NODES: GraphNode[] = buildGraphNodes()
export const MOCK_LINKS: GraphLink[] = buildGraphLinks(MOCK_NODES)
