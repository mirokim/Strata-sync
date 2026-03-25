import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
  SortAsc, SortDesc, ChevronsUpDown, ChevronsDownUp,
  Clock, Type, FilePlus, FolderPlus, Folder, Tag,
} from 'lucide-react'
import { SPEAKER_IDS } from '@/lib/speakerConfig'
import { useDocumentFilter } from '@/hooks/useDocumentFilter'
import { useVaultStore } from '@/stores/vaultStore'
import { useGraphStore } from '@/stores/graphStore'
import { useUIStore } from '@/stores/uiStore'
import { useTrashStore } from '@/stores/trashStore'
import { parseVaultFilesAsync } from '@/lib/markdownParser'
import { buildGraph } from '@/lib/graphBuilder'
import SearchBar from './SearchBar'
import SpeakerGroup from './SpeakerGroup'
import FolderGroup from './FolderGroup'
import TagGroup from './TagGroup'
import ContextMenu from './ContextMenu'
import type { SpeakerId, LoadedDocument } from '@/types'
import type { ContextMenuState } from './ContextMenu'

function iconBtn(active = false): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 22,
    height: 22,
    border: 'none',
    background: active ? 'var(--color-bg-active)' : 'transparent',
    borderRadius: 4,
    color: active ? 'var(--color-accent)' : 'var(--color-text-muted)',
    cursor: 'pointer',
    flexShrink: 0,
    transition: 'background 0.1s, color 0.1s',
  }
}

// ── FolderPickerModal ──────────────────────────────────────────────────────────

interface FolderPickerProps {
  folders: string[]
  x: number
  y: number
  onPick: (folderRelPath: string) => void
  onClose: () => void
}

function FolderPickerModal({ folders, x, y, onPick, onClose }: FolderPickerProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', handleDown)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleDown)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  const clampedX = Math.min(x, window.innerWidth - 200 - 8)
  const clampedY = Math.min(y, window.innerHeight - Math.min(folders.length * 30 + 44, 280) - 8)

  return createPortal(
    <div
      ref={ref}
      style={{
        position: 'fixed',
        top: clampedY,
        left: clampedX,
        zIndex: 9999,
        background: 'var(--color-bg-overlay)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 8,
        padding: '4px',
        minWidth: 200,
        maxHeight: 280,
        overflowY: 'auto',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      }}
    >
      <div style={{
        padding: '4px 8px 6px',
        fontSize: 10,
        color: 'var(--color-text-muted)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        marginBottom: 4,
      }}>
        Select destination folder
      </div>
      {folders.map(folder => (
        <button
          key={folder || '__root__'}
          onClick={() => { onPick(folder); onClose() }}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            padding: '6px 10px',
            border: 'none',
            borderRadius: 5,
            background: 'transparent',
            color: 'var(--color-text-secondary)',
            fontSize: 12,
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'background 0.1s',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-bg-hover)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <Folder size={11} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
          {folder || '/ (root)'}
        </button>
      ))}
    </div>,
    document.body
  )
}

// ── Main FileTree component ────────────────────────────────────────────────────

export default function FileTree() {
  const {
    search, setSearch,
    sortBy, setSortBy,
    sortDir, toggleSortDir,
    filtered, grouped, folderGroups, tagGroups, totalCount, isVaultLoaded,
  } = useDocumentFilter()

  const { vaultPath, loadedDocuments, setLoadedDocuments, vaultFolders, setVaultFolders } = useVaultStore()
  const { setNodes, setLinks, nodes, links } = useGraphStore()
  const { openInEditor, editingDocId } = useUIStore()
  const pushTrash = useTrashStore(s => s.push)

  const rebuildGraph = useCallback((docs: LoadedDocument[]) => {
    const { nodes, links } = buildGraph(docs)
    setNodes(nodes)
    setLinks(links)
  }, [setNodes, setLinks])

  // Group mode: 'folder' (default) or 'tag' (vault mode only)
  const [groupMode, setGroupMode] = useState<'folder' | 'tag'>('folder')

  // Expand/collapse all state: null = each folder uses its own local state
  const [expandOverride, setExpandOverride] = useState<boolean | null>(null)

  // Context menu state
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

  // Folder picker state — set when user clicks "Move to folder"
  const [moveTarget, setMoveTarget] = useState<{
    absolutePath: string
    filename: string
    x: number
    y: number
  } | null>(null)

  // Tracks folders created this session (may be empty on disk — won't appear in folderGroups yet)
  const [extraFolders, setExtraFolders] = useState<string[]>([])

  const handleExpandCollapseToggle = useCallback(() => {
    setExpandOverride(prev => (prev === true ? false : true))
  }, [])
  const handleGroupToggle = useCallback(() => {
    if (expandOverride !== null) setExpandOverride(null)
  }, [expandOverride])
  const handleGroupModeToggle = useCallback(() => {
    setGroupMode(m => m === 'folder' ? 'tag' : 'folder')
  }, [])

  const groupsToShow: SpeakerId[] = [...SPEAKER_IDS]
  if (grouped['unknown' as SpeakerId]?.length) {
    groupsToShow.push('unknown' as SpeakerId)
  }

  // All known folders (for folder picker): vault-scanned + newly created empty ones
  const allFolders = useMemo(() => {
    const known = new Set<string>(['']) // '' = vault root
    folderGroups.forEach(fg => known.add(fg.folderPath))
    vaultFolders.forEach(f => known.add(f))
    extraFolders.forEach(f => known.add(f))
    return Array.from(known).sort((a, b) => {
      if (a === '') return -1
      if (b === '') return 1
      return a.localeCompare(b)
    })
  }, [folderGroups, vaultFolders, extraFolders])

  // Empty folders: known from vault + newly created, minus those already in folderGroups
  const emptyFolders = useMemo(() => {
    const withDocs = new Set(folderGroups.map(fg => fg.folderPath))
    const allKnown = new Set([...vaultFolders, ...extraFolders])
    return Array.from(allKnown).filter(f => !withDocs.has(f)).sort()
  }, [folderGroups, vaultFolders, extraFolders])

  // ── Reload vault helper ────────────────────────────────────────────────────

  const reloadVault = useCallback(async () => {
    if (!vaultPath || !window.vaultAPI) return []
    const { files, folders } = await window.vaultAPI.loadFiles(vaultPath)
    if (!files) return []
    const docs = await parseVaultFilesAsync(files) as LoadedDocument[]
    setLoadedDocuments(docs)
    setVaultFolders(folders ?? [])
    rebuildGraph(docs)
    return docs
  }, [vaultPath, setLoadedDocuments, setVaultFolders, rebuildGraph])

  // ── Context menu actions ───────────────────────────────────────────────────

  const handleOpenInEditor = (docId: string) => openInEditor(docId)

  const handleCreateCopy = async (absolutePath: string, filename: string) => {
    if (!window.vaultAPI) return
    const ext = filename.endsWith('.md') ? '.md' : ''
    const base = filename.replace(/\.md$/i, '')
    const copyFilename = `${base} copy${ext}`
    const dir = absolutePath.replace(/[\\/][^\\/]+$/, '')
    const sep = absolutePath.includes('\\') ? '\\' : '/'
    const destPath = `${dir}${sep}${copyFilename}`
    try {
      const content = loadedDocuments?.find(d =>
        (d as LoadedDocument).absolutePath === absolutePath
      )?.rawContent ?? ''
      await window.vaultAPI.saveFile(destPath, content)
    } catch (e) {
      console.error('[FileTree] createCopy failed:', e)
    }
  }

  const handleBookmark = (docId: string) => {
    // TODO: persist bookmarks in a store
    console.log('[FileTree] bookmark:', docId)
  }

  const handleRename = async (absolutePath: string, filename: string) => {
    const newName = window.prompt('New file name:', filename.replace(/\.md$/i, ''))
    if (!newName || newName.trim() === '') return
    const newFilename = newName.trim().endsWith('.md')
      ? newName.trim()
      : `${newName.trim()}.md`
    if (newFilename === filename) return

    const oldDoc = loadedDocuments?.find(d => (d as LoadedDocument).absolutePath === absolutePath)
    const wasEditing = Boolean(oldDoc && editingDocId === oldDoc.id)

    try {
      await window.vaultAPI?.renameFile(absolutePath, newFilename)
      if (vaultPath && window.vaultAPI) {
        const docs = await reloadVault()
        if (wasEditing) {
          const sep = absolutePath.includes('\\') ? '\\' : '/'
          const dir = absolutePath.replace(/[\\/][^\\/]+$/, '')
          const newAbsPath = `${dir}${sep}${newFilename}`
          const newDoc = docs.find(d =>
            d.absolutePath.replace(/\\/g, '/') === newAbsPath.replace(/\\/g, '/')
          )
          if (newDoc) openInEditor(newDoc.id)
        }
      }
    } catch (e) {
      console.error('[FileTree] rename failed:', e)
    }
  }

  const handleDelete = async (absolutePath: string, filename: string) => {
    const confirmed = window.confirm(`Delete "${filename}"?\nYou can restore it from Settings › Trash.`)
    if (!confirmed) return
    try {
      // Back up content before deletion → keep in trash store
      const content = await window.vaultAPI?.readFile(absolutePath) ?? ''
      const doc = loadedDocuments?.find(d => d.absolutePath === absolutePath)
      pushTrash({
        filename,
        absolutePath,
        folderPath: doc?.folderPath ?? '',
        content,
      })
      await window.vaultAPI?.deleteFile(absolutePath)
      await reloadVault()
    } catch (e) {
      console.error('[FileTree] delete failed:', e)
    }
  }

  // ── Create folder ──────────────────────────────────────────────────────────

  const handleCreateFolder = async () => {
    if (!vaultPath || !window.vaultAPI?.createFolder) return
    const name = window.prompt('New folder name (nested allowed: parent/child):')
    if (!name || !name.trim()) return
    const sep = vaultPath.includes('\\') ? '\\' : '/'
    const folderRelPath = name.trim().replace(/[/\\]/g, sep)
    const folderAbsPath = `${vaultPath}${sep}${folderRelPath}`
    try {
      await window.vaultAPI.createFolder(folderAbsPath)
      const relNormalized = folderRelPath.replace(/\\/g, '/')
      setExtraFolders(prev => prev.includes(relNormalized) ? prev : [...prev, relNormalized])
      await reloadVault()
    } catch (e) {
      console.error('[FileTree] create folder failed:', e)
    }
  }

  // ── Move file to folder ────────────────────────────────────────────────────

  const handleMoveRequest = (absolutePath: string, filename: string, x: number, y: number) => {
    setMoveTarget({ absolutePath, filename, x, y })
  }

  const handleMoveTo = async (destFolderRelPath: string) => {
    if (!moveTarget || !vaultPath || !window.vaultAPI?.moveFile) return
    const { absolutePath, filename } = moveTarget
    setMoveTarget(null)

    const oldDoc = loadedDocuments?.find(d => (d as LoadedDocument).absolutePath === absolutePath)
    const wasEditing = Boolean(oldDoc && editingDocId === oldDoc.id)

    const sep = vaultPath.includes('\\') ? '\\' : '/'
    const destAbsPath = destFolderRelPath
      ? `${vaultPath}${sep}${destFolderRelPath.replace(/[/\\]/g, sep)}`
      : vaultPath

    try {
      await window.vaultAPI.moveFile(absolutePath, destAbsPath)
      const docs = await reloadVault()

      if (wasEditing) {
        const newRelPath = (destFolderRelPath ? `${destFolderRelPath}/` : '') + filename
        const newDoc = docs.find(d =>
          d.absolutePath.replace(/\\/g, '/').endsWith(newRelPath.replace(/\\/g, '/'))
        )
        if (newDoc) openInEditor(newDoc.id)
      }
    } catch (e) {
      console.error('[FileTree] move failed:', e)
    }
  }

  // ── New document ───────────────────────────────────────────────────────────

  const handleNewDocument = async () => {
    if (!vaultPath || !window.vaultAPI) return
    const sep = vaultPath.includes('\\') ? '\\' : '/'
    const existing = new Set(
      (loadedDocuments ?? []).map(d => (d as LoadedDocument).absolutePath.replace(/\\/g, '/'))
    )
    let name = 'Untitled'
    let counter = 1
    let newPath = `${vaultPath}${sep}${name}.md`
    while (existing.has(newPath.replace(/\\/g, '/'))) {
      counter++
      name = `Untitled ${counter}`
      newPath = `${vaultPath}${sep}${name}.md`
    }
    try {
      await window.vaultAPI.saveFile(newPath, `# ${name}\n\n`)
      const docs = await reloadVault()
      const newDoc = docs.find(d =>
        d.absolutePath.replace(/\\/g, '/') === newPath.replace(/\\/g, '/')
      )
      if (newDoc) openInEditor(newDoc.id)
    } catch (e) {
      console.error('[FileTree] new document failed:', e)
    }
  }

  return (
    <div className="flex flex-col h-full" data-testid="file-tree">

      {/* ── Toolbar ── */}
      <div
        style={{
          borderBottom: '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          padding: '0 4px',
          minHeight: 34,
          flexShrink: 0,
          justifyContent: 'center',
        }}
      >
        <button
          style={iconBtn(sortBy === 'name')}
          title={`By name${sortBy === 'name' ? (sortDir === 'asc' ? ' (ascending)' : ' (descending)') : ''}`}
          onClick={() => sortBy === 'name' ? toggleSortDir() : setSortBy('name')}
        >
          {sortBy === 'name'
            ? (sortDir === 'asc' ? <SortAsc size={11} /> : <SortDesc size={11} />)
            : <Type size={11} />}
        </button>

        <button
          style={iconBtn(sortBy === 'date')}
          title={`By date${sortBy === 'date' ? (sortDir === 'asc' ? ' (ascending)' : ' (descending)') : ''}`}
          onClick={() => sortBy === 'date' ? toggleSortDir() : setSortBy('date')}
        >
          {sortBy === 'date'
            ? (sortDir === 'asc' ? <SortAsc size={11} /> : <SortDesc size={11} />)
            : <Clock size={11} />}
        </button>

        <div style={{ width: 1, height: 14, background: 'var(--color-border)', margin: '0 2px' }} />

        <button
          style={iconBtn(expandOverride !== null)}
          title={expandOverride === true ? 'Collapse all' : 'Expand all'}
          onClick={handleExpandCollapseToggle}
        >
          {expandOverride === true ? <ChevronsDownUp size={11} /> : <ChevronsUpDown size={11} />}
        </button>

        <button
          style={iconBtn(isVaultLoaded)}
          title={groupMode === 'folder' ? 'Switch to tag view' : 'Switch to folder view'}
          onClick={handleGroupModeToggle}
          disabled={!isVaultLoaded}
        >
          {groupMode === 'tag' ? <Tag size={11} /> : <Folder size={11} />}
        </button>

        <div style={{ width: 1, height: 14, background: 'var(--color-border)', margin: '0 2px' }} />

        <button
          style={iconBtn()}
          title={vaultPath ? 'Create new folder' : 'Please select a vault first'}
          onClick={handleCreateFolder}
          disabled={!vaultPath}
        >
          <FolderPlus size={11} />
        </button>

        <button
          style={iconBtn()}
          title={vaultPath ? 'Create new document' : 'Please select a vault first'}
          onClick={handleNewDocument}
          disabled={!vaultPath}
        >
          <FilePlus size={11} />
        </button>
      </div>

      <SearchBar value={search} onChange={setSearch} />

      {/* ── Document groups ── */}
      <div className="flex-1 overflow-y-auto py-1" onClick={handleGroupToggle}>
        {isVaultLoaded
          ? groupMode === 'folder'
            ? <>
              {folderGroups.map(fg => (
                <FolderGroup
                  key={fg.folderPath}
                  folderPath={fg.folderPath}
                  docs={fg.docs}
                  isOpenOverride={expandOverride}
                  onContextMenu={setContextMenu}
                />
              ))}
              {emptyFolders.map(f => (
                <FolderGroup
                  key={f}
                  folderPath={f}
                  docs={[]}
                  isOpenOverride={expandOverride}
                  onContextMenu={setContextMenu}
                />
              ))}
            </>
            : tagGroups.map(tg => (
                <TagGroup
                  key={tg.tag || '__untagged__'}
                  tag={tg.tag}
                  docs={tg.docs}
                  isOpenOverride={expandOverride}
                  onContextMenu={setContextMenu}
                />
              ))
          : groupsToShow.map(id => (
              <SpeakerGroup
                key={id}
                speakerId={id}
                docs={grouped[id] ?? []}
                isOpenOverride={expandOverride}
                onContextMenu={setContextMenu}
              />
            ))
        }

        {filtered.length === 0 && (
          <div className="px-4 py-6 text-xs text-center" style={{ color: 'var(--color-text-muted)' }}>
            No results found
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div
        className="px-3 py-2 text-[10px] shrink-0"
        style={{ color: 'var(--color-text-muted)', borderTop: '1px solid var(--color-border)' }}
      >
        <span>{filtered.length} / {totalCount} docs</span>
        {nodes.length > 0 && (
          <span style={{ opacity: 0.6 }}>
            {' · '}{nodes.length} nodes · {links.length} wires
          </span>
        )}
      </div>

      {/* ── Context menu (portal to document.body) ── */}
      {contextMenu && (
        <ContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onOpenInEditor={handleOpenInEditor}
          onCreateCopy={handleCreateCopy}
          onBookmark={handleBookmark}
          onRename={handleRename}
          onDelete={handleDelete}
          onMove={handleMoveRequest}
        />
      )}

      {/* ── Folder picker modal (portal) ── */}
      {moveTarget && (
        <FolderPickerModal
          folders={allFolders}
          x={moveTarget.x}
          y={moveTarget.y}
          onPick={handleMoveTo}
          onClose={() => setMoveTarget(null)}
        />
      )}
    </div>
  )
}
