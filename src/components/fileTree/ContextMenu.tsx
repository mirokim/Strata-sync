import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  ExternalLink,
  Copy,
  Bookmark,
  History,
  Pencil,
  Trash2,
  FolderInput,
} from 'lucide-react'

export interface ContextMenuState {
  docId: string
  filename: string
  absolutePath: string
  x: number
  y: number
}

interface ContextMenuProps {
  menu: ContextMenuState
  onClose: () => void
  onOpenInEditor: (docId: string) => void
  onCreateCopy: (absolutePath: string, filename: string) => void
  onBookmark: (docId: string) => void
  onRename: (absolutePath: string, filename: string) => void
  onDelete: (absolutePath: string, filename: string) => void
  onMove?: (absolutePath: string, filename: string, x: number, y: number) => void
}

interface MenuItem {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  divider?: boolean
}

export default function ContextMenu({
  menu,
  onClose,
  onOpenInEditor,
  onCreateCopy,
  onBookmark,
  onRename,
  onDelete,
  onMove,
}: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click or Escape
  useEffect(() => {
    const handleDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleDown)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleDown)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  // Clamp to viewport
  const menuWidth = 180
  const menuHeight = 290
  const x = Math.min(menu.x, window.innerWidth - menuWidth - 8)
  const y = Math.min(menu.y, window.innerHeight - menuHeight - 8)

  const items: MenuItem[] = [
    {
      icon: <ExternalLink size={12} />,
      label: 'Open in editor',
      onClick: () => { onOpenInEditor(menu.docId); onClose() },
    },
    {
      icon: <Copy size={12} />,
      label: 'Create copy',
      onClick: () => { onCreateCopy(menu.absolutePath, menu.filename); onClose() },
    },
    {
      icon: <Bookmark size={12} />,
      label: 'Bookmark',
      onClick: () => { onBookmark(menu.docId); onClose() },
    },
    {
      icon: <History size={12} />,
      label: 'Version history',
      onClick: () => onClose(),
      disabled: true,
      divider: true,
    },
    {
      icon: <FolderInput size={12} />,
      label: 'Move to folder',
      onClick: () => { onMove?.(menu.absolutePath, menu.filename, menu.x, menu.y); onClose() },
    },
    {
      icon: <Pencil size={12} />,
      label: 'Rename',
      onClick: () => { onRename(menu.absolutePath, menu.filename); onClose() },
    },
    {
      icon: <Trash2 size={12} />,
      label: 'Delete',
      onClick: () => { onDelete(menu.absolutePath, menu.filename); onClose() },
      danger: true,
    },
  ]

  return createPortal(
    <div
      ref={ref}
      style={{
        position: 'fixed',
        top: y,
        left: x,
        zIndex: 9999,
        background: 'var(--color-bg-overlay)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 8,
        padding: '4px',
        minWidth: menuWidth,
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      }}
    >
      {/* Filename header */}
      <div
        style={{
          padding: '5px 10px 6px',
          fontSize: 10,
          color: 'var(--color-text-muted)',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          marginBottom: 4,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: menuWidth - 8,
        }}
        title={menu.filename}
      >
        {menu.filename.replace(/\.md$/i, '')}
      </div>

      {items.map((item, i) => (
        <div key={i}>
          {item.divider && (
            <div style={{
              height: 1,
              background: 'rgba(255,255,255,0.06)',
              margin: '4px 0',
            }} />
          )}
          <button
            onClick={item.disabled ? undefined : item.onClick}
            disabled={item.disabled}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 10px',
              border: 'none',
              borderRadius: 5,
              background: 'transparent',
              color: item.disabled
                ? 'var(--color-text-muted)'
                : item.danger
                ? '#f87171'
                : 'var(--color-text-secondary)',
              fontSize: 12,
              cursor: item.disabled ? 'not-allowed' : 'pointer',
              textAlign: 'left',
              opacity: item.disabled ? 0.5 : 1,
              transition: 'background 0.1s',
            }}
            onMouseEnter={e => {
              if (!item.disabled) {
                (e.currentTarget as HTMLButtonElement).style.background =
                  item.danger ? 'rgba(248,113,113,0.12)' : 'var(--color-bg-hover)'
              }
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.background = 'transparent'
            }}
          >
            <span style={{ flexShrink: 0 }}>{item.icon}</span>
            {item.label}
            {item.disabled && (
              <span style={{ marginLeft: 'auto', fontSize: 9, opacity: 0.5 }}>Coming soon</span>
            )}
          </button>
        </div>
      ))}
    </div>,
    document.body
  )
}
