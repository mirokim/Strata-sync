import { useState, useEffect, useCallback } from 'react'
import { ChevronRight, ChevronDown, Tag } from 'lucide-react'
import type { MockDocument, LoadedDocument } from '@/types'
import FileTreeItem from './FileTreeItem'
import type { ContextMenuState } from './ContextMenu'
import { useSettingsStore } from '@/stores/settingsStore'

interface TagGroupProps {
  tag: string  // '' = no tag
  docs: MockDocument[]
  /** null/undefined = local state; true/false = controlled open state */
  isOpenOverride?: boolean | null
  onContextMenu?: (state: ContextMenuState) => void
}

export default function TagGroup({
  tag,
  docs,
  isOpenOverride,
  onContextMenu,
}: TagGroupProps) {
  const [localOpen, setLocalOpen] = useState(true)
  const { tagColors } = useSettingsStore()
  const customColor = tag !== '' ? (tagColors[tag] ?? undefined) : undefined

  // Sync local state when override changes
  useEffect(() => {
    if (isOpenOverride !== null && isOpenOverride !== undefined) {
      setLocalOpen(isOpenOverride)
    }
  }, [isOpenOverride])

  const isOpen = (isOpenOverride !== null && isOpenOverride !== undefined)
    ? isOpenOverride
    : localOpen

  const handleToggle = useCallback(() => setLocalOpen(o => !o), [])

  if (docs.length === 0) return null

  const displayName = tag === '' ? 'Untagged' : `#${tag}`

  return (
    <div>
      <button
        onClick={handleToggle}
        className="w-full flex items-center gap-2 px-2 py-1.5 text-xs font-semibold transition-colors hover:bg-[var(--color-bg-hover)]"
        style={{ color: 'var(--color-text-primary)' }}
        aria-expanded={isOpen}
      >
        <span
          className="flex items-center justify-center w-4 h-4 rounded"
          style={{ background: 'var(--color-bg-active)' }}
        >
          <Tag size={9} style={{ color: tag === '' ? 'var(--color-text-muted)' : (customColor ?? 'var(--color-accent)') }} />
        </span>

        <span
          className="flex-1 text-left text-[11px]"
          style={{ color: tag === '' ? 'var(--color-text-muted)' : (customColor ?? undefined) }}
        >
          {displayName}
        </span>

        <span style={{ color: 'var(--color-text-muted)' }} className="text-[10px]">
          {docs.length}
        </span>

        {isOpen
          ? <ChevronDown size={11} style={{ color: 'var(--color-text-muted)' }} />
          : <ChevronRight size={11} style={{ color: 'var(--color-text-muted)' }} />
        }
      </button>

      {isOpen && (
        <div>
          {docs.map(doc => (
            <FileTreeItem key={(doc as LoadedDocument).absolutePath ?? doc.id} doc={doc} onContextMenu={onContextMenu} />
          ))}
        </div>
      )}
    </div>
  )
}
