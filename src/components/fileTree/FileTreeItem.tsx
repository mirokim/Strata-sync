import type { MockDocument, LoadedDocument } from '@/types'
import { SPEAKER_CONFIG } from '@/lib/speakerConfig'
import { useUIStore } from '@/stores/uiStore'
import { cn } from '@/lib/utils'
import { FileText } from 'lucide-react'
import type { ContextMenuState } from './ContextMenu'

interface FileTreeItemProps {
  doc: MockDocument
  onContextMenu?: (state: ContextMenuState) => void
}

export default function FileTreeItem({ doc, onContextMenu }: FileTreeItemProps) {
  const { editingDocId, openInEditor } = useUIStore()
  const isSelected = editingDocId === doc.id
  const speakerColor = SPEAKER_CONFIG[doc.speaker].color

  const handleClick = () => {
    openInEditor(doc.id)
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    if (!onContextMenu) return
    const absolutePath = (doc as LoadedDocument).absolutePath ?? ''
    onContextMenu({
      docId: doc.id,
      filename: doc.filename,
      absolutePath,
      x: e.clientX,
      y: e.clientY,
    })
  }

  // Display name: strip extension; for mock data also strip speaker prefix
  const displayName = doc.filename
    .replace(/\.md$/i, '')
    .replace(/^(chief|art|plan|level|prog)_/, '')
    .replace(/_/g, ' ')

  return (
    <button
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      data-doc-id={doc.id}
      className={cn(
        'w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs transition-colors',
        'hover:bg-[var(--color-bg-hover)]'
      )}
      style={{
        background: isSelected ? 'var(--color-bg-active)' : undefined,
        color: isSelected ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
        borderLeft: isSelected ? `2px solid ${speakerColor}` : '2px solid transparent',
      }}
      title={doc.filename}
      aria-current={isSelected ? 'page' : undefined}
    >
      <FileText size={11} style={{ color: speakerColor, flexShrink: 0 }} />
      <span className="truncate">{displayName}</span>
    </button>
  )
}
