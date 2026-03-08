import { useState, useEffect, useCallback } from 'react'
import { ChevronRight, ChevronDown, Folder } from 'lucide-react'
import type { MockDocument, SpeakerId } from '@/types'
import { SPEAKER_CONFIG } from '@/lib/speakerConfig'
import FileTreeItem from './FileTreeItem'
import type { ContextMenuState } from './ContextMenu'

interface SpeakerGroupProps {
  speakerId: SpeakerId
  docs: MockDocument[]
  isOpenOverride?: boolean | null
  onContextMenu?: (state: ContextMenuState) => void
}

export default function SpeakerGroup({
  speakerId,
  docs,
  isOpenOverride,
  onContextMenu,
}: SpeakerGroupProps) {
  const [localOpen, setLocalOpen] = useState(true)
  const { label, color, darkBg } = SPEAKER_CONFIG[speakerId]

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

  return (
    <div>
      {/* Group header */}
      <button
        onClick={handleToggle}
        className="w-full flex items-center gap-2 px-2 py-1.5 text-xs font-semibold transition-colors hover:bg-[var(--color-bg-hover)]"
        style={{ color }}
        aria-expanded={isOpen}
        data-speaker={speakerId}
      >
        <span
          className="flex items-center justify-center w-4 h-4 rounded"
          style={{ background: darkBg }}
        >
          <Folder size={9} style={{ color }} />
        </span>

        <span className="flex-1 text-left tracking-wide uppercase text-[10px]">{label}</span>

        <span style={{ color: 'var(--color-text-muted)' }} className="text-[10px]">
          {docs.length}
        </span>

        {isOpen
          ? <ChevronDown size={11} style={{ color: 'var(--color-text-muted)' }} />
          : <ChevronRight size={11} style={{ color: 'var(--color-text-muted)' }} />
        }
      </button>

      {/* Documents */}
      {isOpen && (
        <div>
          {docs.map(doc => (
            <FileTreeItem key={doc.id} doc={doc} onContextMenu={onContextMenu} />
          ))}
        </div>
      )}
    </div>
  )
}
