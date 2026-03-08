import { useCallback } from 'react'
import { useGraphStore } from '@/stores/graphStore'
import { useUIStore } from '@/stores/uiStore'
import { useVaultStore } from '@/stores/vaultStore'
import { MOCK_DOCUMENTS } from '@/data/mockDocuments'

interface Props {
  slug: string
}

/**
 * Renders a [[wiki-link]] token.
 * Click → find the matching graph node and navigate to it.
 */
export default function WikiLink({ slug }: Props) {
  const { nodes, setSelectedNode } = useGraphStore()
  const { setSelectedDoc, setCenterTab } = useUIStore()
  const { vaultPath, loadedDocuments } = useVaultStore()

  const handleClick = useCallback(() => {
    const allDocs = (vaultPath && loadedDocuments) ? loadedDocuments : MOCK_DOCUMENTS

    // Strategy 1: direct node ID match (doc ID)
    let node = nodes.find(n => n.id === slug)

    // Strategy 2: section ID → parent document (mock data style)
    if (!node) {
      const doc = allDocs.find(d => d.sections.some(s => s.id === slug))
      if (doc) node = nodes.find(n => n.id === doc.id)
    }

    // Strategy 3: filename match (Obsidian [[note name]] style)
    if (!node) {
      const doc = allDocs.find(d =>
        d.filename.replace(/\.md$/i, '').toLowerCase() === slug.toLowerCase()
      )
      if (doc) node = nodes.find(n => n.id === doc.id)
    }

    if (node) {
      setSelectedNode(node.id)
      setSelectedDoc(node.docId)
      setCenterTab('graph')
    }
  }, [slug, nodes, vaultPath, loadedDocuments, setSelectedNode, setSelectedDoc, setCenterTab])

  return (
    <span
      role="link"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={e => { if (e.key === 'Enter') handleClick() }}
      data-testid={`wiki-link-${slug}`}
      style={{
        color: 'var(--color-accent)',
        cursor: 'pointer',
        textDecoration: 'underline',
        textDecorationStyle: 'dotted',
        textUnderlineOffset: 2,
      }}
    >
      {slug}
    </span>
  )
}
