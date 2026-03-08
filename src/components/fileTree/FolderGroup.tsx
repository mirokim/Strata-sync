import { useState, useEffect, useCallback, useRef } from 'react'
import { ChevronRight, ChevronDown, Folder } from 'lucide-react'
import type { MockDocument, LoadedDocument } from '@/types'
import FileTreeItem from './FileTreeItem'
import type { ContextMenuState } from './ContextMenu'
import { useSettingsStore } from '@/stores/settingsStore'

interface FolderGroupProps {
  folderPath: string
  docs: MockDocument[]
  /** null/undefined = local state; true/false = controlled open state */
  isOpenOverride?: boolean | null
  onContextMenu?: (state: ContextMenuState) => void
}

export default function FolderGroup({
  folderPath,
  docs,
  isOpenOverride,
  onContextMenu,
}: FolderGroupProps) {
  const [localOpen, setLocalOpen] = useState(true)
  const { folderColors, setFolderColor } = useSettingsStore()
  const colorInputRef = useRef<HTMLInputElement>(null)
  const customColor = folderColors[folderPath]

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

  const displayName = folderPath || '/'

  return (
    <div>
      <button
        onClick={handleToggle}
        className="w-full flex items-center gap-2 px-2 py-1.5 text-xs font-semibold transition-colors hover:bg-[var(--color-bg-hover)]"
        style={{ color: 'var(--color-text-primary)' }}
        aria-expanded={isOpen}
        data-folder={folderPath}
      >
        <span
          className="flex items-center justify-center w-4 h-4 rounded"
          style={{ background: 'var(--color-bg-active)' }}
        >
          <Folder size={9} style={{ color: customColor ?? 'var(--color-accent)' }} />
        </span>

        <span className="flex-1 text-left text-[11px]" style={{ color: customColor ?? undefined }}>{displayName}</span>

        <span style={{ color: 'var(--color-text-muted)' }} className="text-[10px]">
          {docs.length}
        </span>

        {/* Color picker — stopPropagation prevents toggling the folder open/close */}
        <label
          onClick={e => e.stopPropagation()}
          onPointerDown={e => e.stopPropagation()}
          title={`Change color for "${displayName}" folder`}
          style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', width: 14, height: 14, flexShrink: 0 }}
        >
          <span style={{
            width: 8, height: 8, borderRadius: '50%', display: 'inline-block',
            background: customColor ?? 'var(--color-text-muted)',
            border: `1px solid ${customColor ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.15)'}`,
            opacity: customColor ? 1 : 0.5,
          }} />
          <input
            ref={colorInputRef}
            type="color"
            value={customColor ?? '#60a5fa'}
            onChange={e => setFolderColor(folderPath, e.target.value)}
            style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', padding: 0, border: 'none' }}
          />
        </label>

        {isOpen
          ? <ChevronDown size={11} style={{ color: 'var(--color-text-muted)' }} />
          : <ChevronRight size={11} style={{ color: 'var(--color-text-muted)' }} />
        }
      </button>

      {isOpen && (
        <div>
          {docs.length === 0 ? (
            <div style={{ padding: '4px 12px 4px 24px', fontSize: 10, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
              Empty
            </div>
          ) : (
            docs.map(doc => (
              <FileTreeItem key={(doc as LoadedDocument).absolutePath ?? doc.id} doc={doc} onContextMenu={onContextMenu} />
            ))
          )}
        </div>
      )}
    </div>
  )
}
