/**
 * Ctrl+K Command Palette
 * Searches vault files + built-in commands. Arrow keys to navigate, Enter to select.
 */
import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useUIStore } from '@/stores/uiStore'
import { useVaultStore } from '@/stores/vaultStore'
import { useGraphStore } from '@/stores/graphStore'
import { File, Settings, PanelLeft, PanelRight, Pencil, RotateCcw, Search, Zap } from 'lucide-react'
import { runEditAgentCycle } from '@/services/editAgentRunner'

interface PaletteItem {
  id: string
  label: string
  sub?: string
  icon: React.ReactNode
  action: () => void
}

export default function CommandPalette() {
  const open              = useUIStore(s => s.commandPaletteOpen)
  const setOpen           = useUIStore(s => s.setCommandPaletteOpen)
  const toggleLeft        = useUIStore(s => s.toggleLeftPanel)
  const toggleRight       = useUIStore(s => s.toggleRightPanel)
  const toggleAgent       = useUIStore(s => s.toggleEditAgentPanel)
  const toggleSettings    = useUIStore(s => s.toggleSettingsPanel)
  const openInEditor      = useUIStore(s => s.openInEditor)
  const setFocusNode      = useGraphStore(s => s.setFocusNode)
  const setSelectedNode   = useGraphStore(s => s.setSelectedNode)
  const loadedDocuments   = useVaultStore(s => s.loadedDocuments)

  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef  = useRef<HTMLDivElement>(null)

  // Built-in commands
  const builtinCommands: PaletteItem[] = useMemo(() => [
    {
      id: 'cmd:settings', label: 'Open Settings', sub: 'Settings',
      icon: <Settings size={14} />,
      action: () => { toggleSettings(); setOpen(false) },
    },
    {
      id: 'cmd:left-panel', label: 'Toggle Left Panel', sub: 'Toggle left panel',
      icon: <PanelLeft size={14} />,
      action: () => { toggleLeft(); setOpen(false) },
    },
    {
      id: 'cmd:right-panel', label: 'Toggle Right Panel', sub: 'Toggle right panel',
      icon: <PanelRight size={14} />,
      action: () => { toggleRight(); setOpen(false) },
    },
    {
      id: 'cmd:agent-panel', label: 'Toggle Edit Agent Panel', sub: 'Toggle edit agent',
      icon: <Pencil size={14} />,
      action: () => { toggleAgent(); setOpen(false) },
    },
    {
      id: 'cmd:run-agent', label: 'Run Edit Agent Now', sub: 'Run edit agent cycle now',
      icon: <Zap size={14} />,
      action: () => { runEditAgentCycle(); setOpen(false) },
    },
    {
      id: 'cmd:reload', label: 'Reload Page', sub: 'Reload',
      icon: <RotateCcw size={14} />,
      action: () => { window.location.reload() },
    },
  ], [toggleSettings, toggleLeft, toggleRight, toggleAgent, setOpen])

  // Vault file items
  const fileItems: PaletteItem[] = useMemo(() => {
    if (!loadedDocuments) return []
    return loadedDocuments
      .filter(d => d.filename.endsWith('.md'))
      .map(d => ({
        id: `file:${d.id}`,
        label: d.filename.replace(/\.md$/i, ''),
        sub: d.id,
        icon: <File size={14} />,
        action: () => {
          openInEditor(d.id)
          setSelectedNode(d.id)
          setFocusNode(d.id)
          setOpen(false)
        },
      }))
  }, [loadedDocuments, openInEditor, setSelectedNode, setFocusNode, setOpen])

  // Filtered results
  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    const all = [...builtinCommands, ...fileItems]
    if (!q) return builtinCommands.slice(0, 8)
    return all
      .filter(item =>
        item.label.toLowerCase().includes(q) ||
        (item.sub ?? '').toLowerCase().includes(q)
      )
      .slice(0, 12)
  }, [query, builtinCommands, fileItems])

  // Reset on open
  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIdx(0)
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [open])

  // Reset active index when results change
  useEffect(() => { setActiveIdx(0) }, [results.length])

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.children[activeIdx] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx])

  // Global Ctrl+K shortcut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(true)
      }
      if (e.key === 'Escape' && open) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx(i => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      results[activeIdx]?.action()
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }, [results, activeIdx, setOpen])

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={() => setOpen(false)}
        style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.5)',
          backdropFilter: 'blur(3px)',
        }}
      />

      {/* Palette modal */}
      <div style={{
        position: 'fixed',
        top: '20%',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1001,
        width: 520,
        maxWidth: 'calc(100vw - 32px)',
        background: 'rgba(15,23,42,0.97)',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 12,
        boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
        overflow: 'hidden',
      }}>
        {/* Search input */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 16px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}>
          <Search size={16} style={{ color: '#64748b', flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search files or run a command..."
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: 'var(--color-text-primary)', fontSize: 14,
            }}
          />
          <kbd style={{
            fontSize: 10, color: '#475569',
            padding: '2px 6px', borderRadius: 4,
            border: '1px solid rgba(255,255,255,0.1)',
          }}>ESC</kbd>
        </div>

        {/* Results */}
        <div ref={listRef} style={{ maxHeight: 360, overflowY: 'auto' }}>
          {results.length === 0 ? (
            <div style={{ padding: '20px 16px', textAlign: 'center', color: '#475569', fontSize: 13 }}>
              No results found
            </div>
          ) : (
            results.map((item, idx) => (
              <div
                key={item.id}
                onClick={item.action}
                onMouseEnter={() => setActiveIdx(idx)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '9px 16px',
                  cursor: 'pointer',
                  background: idx === activeIdx ? 'color-mix(in srgb, var(--color-info) 15%, transparent)' : 'transparent',
                  borderLeft: `2px solid ${idx === activeIdx ? 'var(--color-info)' : 'transparent'}`,
                  transition: 'background 0.1s',
                }}
              >
                <span style={{
                  color: idx === activeIdx ? '#60a5fa' : '#64748b',
                  flexShrink: 0,
                }}>
                  {item.icon}
                </span>
                <span style={{ flex: 1, fontSize: 13, color: 'var(--color-text-primary)' }}>
                  {item.label}
                </span>
                {item.sub && (
                  <span style={{ fontSize: 11, color: '#475569', fontFamily: 'monospace' }}>
                    {item.sub.length > 36 ? '...' + item.sub.slice(-34) : item.sub}
                  </span>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div style={{
          padding: '8px 16px',
          borderTop: '1px solid var(--color-bg-tertiary)',
          display: 'flex', gap: 16, fontSize: 10, color: '#475569',
        }}>
          <span><kbd style={{ marginRight: 4, padding: '1px 5px', borderRadius: 3, border: '1px solid rgba(255,255,255,0.1)' }}>↑↓</kbd>Navigate</span>
          <span><kbd style={{ marginRight: 4, padding: '1px 5px', borderRadius: 3, border: '1px solid rgba(255,255,255,0.1)' }}>↵</kbd>Execute</span>
          <span><kbd style={{ marginRight: 4, padding: '1px 5px', borderRadius: 3, border: '1px solid rgba(255,255,255,0.1)' }}>ESC</kbd>Close</span>
        </div>
      </div>
    </>
  )
}
