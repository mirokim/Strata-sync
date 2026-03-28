/**
 * MarkdownEditor — CodeMirror 6 based vault file editor
 *
 * [[WikiLink]] WYSIWYG: shows rendered links on lines without cursor.
 * Lines with cursor show raw [[...]] syntax (Obsidian-style).
 * [[ triggers autocomplete: React portal dropdown at exact position.
 *
 * Lock = edit permission lock (read-only). Used for multi-user permission control later.
 * Auto-save 3s debounce + Ctrl+S. Rebuilds graph when wikiLinks change on save.
 */

import { useEffect, useRef, useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import { EditorView, keymap, drawSelection, highlightActiveLine } from '@codemirror/view'
import { EditorState, Compartment } from '@codemirror/state'
import { history, defaultKeymap, historyKeymap } from '@codemirror/commands'
import { syntaxHighlighting } from '@codemirror/language'
import { markdown } from '@codemirror/lang-markdown'
import matter from 'gray-matter'
import { ArrowLeft, Save, CheckCircle, AlertCircle, X, Lock, Unlock, Pencil, Wand2, RotateCcw, Loader2 } from 'lucide-react'
import { useUIStore } from '@/stores/uiStore'
import { useVaultStore } from '@/stores/vaultStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { makeBasicAuth, makePATAuth, updatePage } from '@/services/confluenceApi'
import { useGraphStore } from '@/stores/graphStore'
import { parseMarkdownFile, parseVaultFiles } from '@/lib/markdownParser'
import { buildGraph } from '@/lib/graphBuilder'
import { tfidfIndex } from '@/lib/graphAnalysis'
import { updateDocInWorker } from '@/lib/bm25WorkerClient'
import { buildAdjacencyMap } from '@/lib/graphRAG'
import { saveTfIdfCache } from '@/lib/tfidfCache'
import { MOCK_DOCUMENTS } from '@/data/mockDocuments'
import type { LoadedDocument } from '@/types'
import { markdownHighlight, vaultTheme } from '@/lib/editor/codemirrorTheme'
import { buildWikiLinkPlugin, buildHighlightPlugin, buildCommentPlugin } from '@/lib/editor/wikiLinkPlugin'
import {
  mdIndentList,
  mdDedentList,
  mdContinueList,
  mdToggleMark,
  mdContinueBlockquote,
} from '@/lib/editor/markdownHelpers'

const AUTOSAVE_DELAY = 3000

// Returns the full string with YAML frontmatter tags field updated.
function updateFrontmatterTags(rawContent: string, newTags: string[]): string {
  const trimmed = rawContent.trimStart()
  if (!trimmed.startsWith('---')) {
    if (newTags.length === 0) return rawContent
    return `---\ntags: [${newTags.join(', ')}]\n---\n\n${rawContent}`
  }
  const parsed = matter(rawContent)
  if (newTags.length > 0) parsed.data.tags = newTags
  else delete parsed.data.tags
  return matter.stringify(parsed.content, parsed.data)
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

interface DocInfo { name: string; folder: string }

// ── WikiLink Suggest dropdown (React portal) ──────────────────────────────────

interface WikiSuggestState {
  query: string
  from: number   // Position after [[ in editor
  to: number     // Current cursor position
  rect: { top: number; bottom: number; left: number }
  selectedIdx: number
}

interface SuggestDropdownProps {
  docs: DocInfo[]
  selectedIdx: number
  rect: WikiSuggestState['rect']
  onSelect: (name: string) => void
}

function SuggestDropdown({ docs, selectedIdx, rect, onSelect }: SuggestDropdownProps) {
  const listRef = useRef<HTMLDivElement>(null)

  // Scroll to keep selected item visible
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const item = list.children[selectedIdx] as HTMLElement | undefined
    item?.scrollIntoView({ block: 'nearest' })
  }, [selectedIdx])

  if (docs.length === 0) return null

  return createPortal(
    <div
      ref={listRef}
      style={{
        position: 'fixed',
        top: rect.bottom + 4,
        left: rect.left,
        zIndex: 99999,
        background: 'var(--color-bg-secondary)',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 2,
        boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
        overflow: 'hidden',
        maxHeight: 220,
        overflowY: 'auto',
        minWidth: 180,
      }}
    >
      {docs.map(({ name, folder }, i) => (
        <div
          key={name}
          onMouseDown={(e) => {
            e.preventDefault() // Keep editor focus
            onSelect(name)
          }}
          style={{
            padding: '5px 12px',
            cursor: 'pointer',
            fontSize: 12,
            fontFamily: 'ui-monospace, "Cascadia Code", Consolas, monospace',
            background: i === selectedIdx ? 'rgba(255,255,255,0.09)' : 'transparent',
            color: i === selectedIdx ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {name}
          </span>
          {folder && (
            <span style={{ fontSize: 10, color: 'var(--color-text-muted)', flexShrink: 0 }}>
              {folder}
            </span>
          )}
        </div>
      ))}
    </div>,
    document.body,
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function MarkdownEditor() {
  const { editingDocId, closeEditor, openInEditor } = useUIStore()
  const { loadedDocuments, setLoadedDocuments, vaultPath } = useVaultStore()
  const tagPresets = useSettingsStore(s => s.tagPresets)
  const { setNodes, setLinks } = useGraphStore()

  const doc: LoadedDocument | undefined =
    loadedDocuments?.find(d => d.id === editingDocId) ??
    MOCK_DOCUMENTS.find(d => d.id === editingDocId)

  const absolutePath = doc?.absolutePath ?? ''
  const canSave = Boolean(absolutePath && window.vaultAPI)

  const [isLocked, setIsLocked] = useState(false)
  const isLockedRef = useRef(isLocked)
  isLockedRef.current = isLocked
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [localTags, setLocalTags] = useState<string[]>(doc?.tags ?? [])
  const [isAddingTag, setIsAddingTag] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const [previousTags, setPreviousTags] = useState<string[] | null>(null)
  const [isSuggestingTags, setIsSuggestingTags] = useState(false)
  const [suggestedTags, setSuggestedTags] = useState<string[] | null>(null)
  const [isSuggestingSpeaker, setIsSuggestingSpeaker] = useState(false)
  const [suggestedSpeaker, setSuggestedSpeaker] = useState<string | null>(null)
  const [confluenceUploadStatus, setConfluenceUploadStatus] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle')
  const [wikiSuggest, setWikiSuggest] = useState<WikiSuggestState | null>(null)
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)
  const isRenamingRef = useRef(false)
  const renameValueRef = useRef('')
  renameValueRef.current = renameValue

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isDirty = useRef(false)

  const editorMountRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const readOnlyCompartment = useRef(new Compartment())

  // Document list for autocomplete (always up to date)
  const docInfoRef = useRef<DocInfo[]>([])
  docInfoRef.current = loadedDocuments?.map(d => ({
    name: d.filename.replace(/\.md$/i, ''),
    folder: d.folderPath || '',
  })) ?? []

  // Stable mutable refs
  const loadedDocsRef = useRef(loadedDocuments)
  loadedDocsRef.current = loadedDocuments
  const docRef = useRef(doc)
  docRef.current = doc
  const canSaveRef = useRef(canSave)
  canSaveRef.current = canSave
  const absolutePathRef = useRef(absolutePath)
  absolutePathRef.current = absolutePath

  const setWikiSuggestRef = useRef(setWikiSuggest)
  setWikiSuggestRef.current = setWikiSuggest
  const wikiSuggestRef = useRef(wikiSuggest)
  wikiSuggestRef.current = wikiSuggest

  // Filtered document list based on current query (recalculated per render)
  const filteredDocs = wikiSuggest
    ? docInfoRef.current.filter(d => {
        const q = wikiSuggest.query.toLowerCase()
        return q === '' || d.name.toLowerCase().includes(q)
      })
    : []
  const clampedIdx = filteredDocs.length > 0
    ? Math.min(wikiSuggest?.selectedIdx ?? 0, filteredDocs.length - 1)
    : 0

  // ── Rename ─────────────────────────────────────────────────────────────

  const startRename = useCallback(() => {
    if (!canSave) return
    const currentDoc = docRef.current as LoadedDocument
    if (!currentDoc?.absolutePath) return
    setRenameValue(currentDoc.filename.replace(/\.md$/i, ''))
    isRenamingRef.current = true
    setIsRenaming(true)
    setTimeout(() => { renameInputRef.current?.select() }, 20)
  }, [canSave])

  const commitRename = useCallback(async () => {
    // Guard against double invocation from Enter key + onBlur
    if (!isRenamingRef.current) return
    isRenamingRef.current = false
    setIsRenaming(false)
    const value = renameValueRef.current
    const currentDoc = docRef.current as LoadedDocument
    if (!currentDoc?.absolutePath || !value.trim()) return
    const newFilename = value.trim().endsWith('.md')
      ? value.trim()
      : `${value.trim()}.md`
    if (newFilename === currentDoc.filename) return
    try {
      await window.vaultAPI!.renameFile(currentDoc.absolutePath, newFilename)
      if (vaultPath && window.vaultAPI) {
        const { files } = await window.vaultAPI.loadFiles(vaultPath)
        if (files) {
          const docs = parseVaultFiles(files) as LoadedDocument[]
          setLoadedDocuments(docs)
          const { nodes, links } = buildGraph(docs)
          setNodes(nodes)
          setLinks(links)
          const sep = currentDoc.absolutePath.includes('\\') ? '\\' : '/'
          const dir = currentDoc.absolutePath.replace(/[\\/][^\\/]+$/, '')
          const newAbsPath = `${dir}${sep}${newFilename}`
          const newDoc = docs.find(d =>
            d.absolutePath.replace(/\\/g, '/') === newAbsPath.replace(/\\/g, '/')
          )
          if (newDoc) openInEditor(newDoc.id)
        }
      }
    } catch (e) {
      console.error('[MarkdownEditor] rename failed:', e)
    }
  }, [vaultPath, setLoadedDocuments, setNodes, setLinks, openInEditor])

  // ── Save ──────────────────────────────────────────────────────────────────

  const doSave = useCallback(async (text: string) => {
    if (!canSaveRef.current) return
    const path = absolutePathRef.current
    if (!path) return

    setSaveStatus('saving')
    try {
      await window.vaultAPI!.saveFile(path, text)

      const currentDoc = docRef.current as LoadedDocument
      if (loadedDocsRef.current && currentDoc?.absolutePath) {
        const relativePath = currentDoc.folderPath
          ? `${currentDoc.folderPath}/${currentDoc.filename}`
          : currentDoc.filename
        const reparsed = parseMarkdownFile({
          relativePath,
          absolutePath: path,
          content: text,
          mtime: Date.now(),
        })

        const updated = loadedDocsRef.current.map(d =>
          d.id === currentDoc.id ? reparsed : d,
        ) as LoadedDocument[]
        setLoadedDocuments(updated)

        const oldLinks = currentDoc.sections.flatMap(s => s.wikiLinks).sort().join(',')
        const newLinks = reparsed.sections.flatMap(s => s.wikiLinks).sort().join(',')
        const { nodes: graphNodes, links: graphLinks } = buildGraph(updated)
        if (oldLinks !== newLinks) {
          setNodes(graphNodes)
          setLinks(graphLinks)
        }

        // BM25 incremental update — reprocess only the saved document
        if (tfidfIndex.isBuilt) {
          try {
            const fingerprint = String(Date.now())
            const adj = buildAdjacencyMap(graphLinks)
            const { serialized, implicitLinks } = await updateDocInWorker(
              tfidfIndex.serialize(fingerprint), reparsed, adj, fingerprint,
            )
            tfidfIndex.restore(serialized)
            tfidfIndex.setImplicitLinks(implicitLinks, adj)
            const vaultRoot = useVaultStore.getState().vaultPath
            if (vaultRoot) saveTfIdfCache(vaultRoot, serialized).catch(() => {})
          } catch {
            // BM25 update failure is silently handled (recovers on next full load)
          }
        }
      }

      setSaveStatus('saved')
      isDirty.current = false
      setTimeout(() => setSaveStatus('idle'), 2000)
    } catch (e) {
      console.error('[MarkdownEditor] save failed:', e)
      setSaveStatus('error')
    }
  }, [setLoadedDocuments, setNodes, setLinks])

  const doSaveRef = useRef(doSave)
  doSaveRef.current = doSave

  const handleManualSave = useCallback(() => {
    if (!viewRef.current) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    doSaveRef.current(viewRef.current.state.doc.toString())
  }, [])

  const handleManualSaveRef = useRef(handleManualSave)
  handleManualSaveRef.current = handleManualSave

  // ── WikiLink click navigation ─────────────────────────────────────────────────────

  const handleLinkClick = useCallback((slug: string) => {
    const target = loadedDocsRef.current?.find(d =>
      d.filename.replace(/\.md$/i, '').toLowerCase() === slug.toLowerCase(),
    )
    if (target) openInEditor(target.id)
  }, [openInEditor])

  const handleLinkClickRef = useRef(handleLinkClick)
  handleLinkClickRef.current = handleLinkClick

  // Open image gallery when clicking ![[image.png]] in locked state
  // Opens the gallery node (gallery:{docId}) of the document containing the clicked image.
  const handleImageClick = useCallback((_ref: string) => {
    if (editingDocId) openInEditor(`gallery:${editingDocId}`)
  }, [openInEditor, editingDocId])

  const handleImageClickRef = useRef(handleImageClick)
  handleImageClickRef.current = handleImageClick

  // ── WikiLink autocomplete confirm ─────────────────────────────────────────────────

  const applyWikiSuggest = useCallback((name: string) => {
    const view = viewRef.current
    const suggest = wikiSuggestRef.current
    if (!view || !suggest) return
    const textAfter = view.state.doc.sliceString(suggest.to, suggest.to + 2)
    const closeStr = textAfter === ']]' ? '' : ']]'
    const insert = name + closeStr
    view.dispatch({
      changes: { from: suggest.from, to: suggest.to, insert },
      selection: { anchor: suggest.from + insert.length },
    })
    setWikiSuggestRef.current(null)
    view.focus()
  }, [])

  const applyRef = useRef(applyWikiSuggest)
  applyRef.current = applyWikiSuggest

  // ── EditorView initialization ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!editorMountRef.current || !doc) return

    viewRef.current?.destroy()
    viewRef.current = null
    isDirty.current = false
    setSaveStatus('idle')
    setWikiSuggestRef.current(null)

    const wikiPlugin = buildWikiLinkPlugin(
      (slug) => handleLinkClickRef.current(slug),
      {
        isLockedRef,
        onImageClick: (ref) => handleImageClickRef.current(ref),
      },
    )

    const view = new EditorView({
      state: EditorState.create({
        doc: doc.rawContent ?? '',
        extensions: [
          history(),
          drawSelection(),
          highlightActiveLine(),
          keymap.of([
            // WikiLink autocomplete keys (registered before defaultKeymap)
            {
              key: 'ArrowDown',
              run: () => {
                if (!wikiSuggestRef.current) return false
                const docs = docInfoRef.current.filter(d => {
                  const q = wikiSuggestRef.current!.query.toLowerCase()
                  return q === '' || d.name.toLowerCase().includes(q)
                })
                setWikiSuggestRef.current(prev =>
                  prev ? { ...prev, selectedIdx: Math.min(prev.selectedIdx + 1, docs.length - 1) } : null,
                )
                return true
              },
            },
            {
              key: 'ArrowUp',
              run: () => {
                if (!wikiSuggestRef.current) return false
                setWikiSuggestRef.current(prev =>
                  prev ? { ...prev, selectedIdx: Math.max(prev.selectedIdx - 1, 0) } : null,
                )
                return true
              },
            },
            {
              key: 'Enter',
              run: () => {
                const suggest = wikiSuggestRef.current
                if (!suggest) return false
                const docs = docInfoRef.current.filter(d => {
                  const q = suggest.query.toLowerCase()
                  return q === '' || d.name.toLowerCase().includes(q)
                })
                const idx = Math.min(suggest.selectedIdx, docs.length - 1)
                const selected = docs[idx]
                if (selected) { applyRef.current(selected.name); return true }
                return false
              },
            },
            {
              key: 'Escape',
              run: () => {
                if (!wikiSuggestRef.current) return false
                setWikiSuggestRef.current(null)
                return true
              },
            },
            // ── Markdown list indentation ──
            { key: 'Tab',       run: mdIndentList },
            { key: 'Shift-Tab', run: mdDedentList },
            // ── List / blockquote continuation (only when WikiSuggest is inactive) ──
            {
              key: 'Enter',
              run: (view) => {
                if (wikiSuggestRef.current) return false
                if (mdContinueList(view)) return true
                return mdContinueBlockquote(view)
              },
            },
            // ── Inline formatting ──
            { key: 'Ctrl-b',       run: (view) => mdToggleMark(view, '**') },
            { key: 'Mod-b',        run: (view) => mdToggleMark(view, '**') },
            { key: 'Ctrl-i',       run: (view) => mdToggleMark(view, '*') },
            { key: 'Mod-i',        run: (view) => mdToggleMark(view, '*') },
            { key: 'Ctrl-Shift-s', run: (view) => mdToggleMark(view, '~~') },
            { key: 'Mod-Shift-s',  run: (view) => mdToggleMark(view, '~~') },
            { key: 'Ctrl-Shift-h', run: (view) => mdToggleMark(view, '==') },
            { key: 'Mod-Shift-h',  run: (view) => mdToggleMark(view, '==') },
            { key: 'Ctrl-Shift-c', run: (view) => mdToggleMark(view, '`') },
            { key: 'Mod-Shift-c',  run: (view) => mdToggleMark(view, '`') },
            ...defaultKeymap,
            ...historyKeymap,
            { key: 'Ctrl-s', run: () => { handleManualSaveRef.current(); return true } },
            { key: 'Mod-s', run: () => { handleManualSaveRef.current(); return true } },
          ]),
          markdown(),
          syntaxHighlighting(markdownHighlight),
          wikiPlugin,
          buildHighlightPlugin(),
          buildCommentPlugin(),
          vaultTheme,
          EditorView.lineWrapping,
          readOnlyCompartment.current.of([]),
          EditorView.updateListener.of((update) => {
            // Auto-save
            if (update.docChanged) {
              isDirty.current = true
              setSaveStatus('idle')
              if (saveTimer.current) clearTimeout(saveTimer.current)
              const text = update.state.doc.toString()
              saveTimer.current = setTimeout(() => doSaveRef.current(text), AUTOSAVE_DELAY)
            }

            // [[ autocomplete detection
            if (update.docChanged || update.selectionSet) {
              const { state } = update
              const cursor = state.selection.main.head
              const line = state.doc.lineAt(cursor)
              const textBefore = line.text.slice(0, cursor - line.from)
              const match = textBefore.match(/\[\[([^\]]*)$/)

              if (match) {
                const coords = update.view.coordsAtPos(cursor)
                if (coords) {
                  const from = cursor - match[1].length
                  setWikiSuggestRef.current(prev => ({
                    query: match[1],
                    from,
                    to: cursor,
                    rect: coords,
                    selectedIdx: prev?.query === match[1] ? prev.selectedIdx : 0,
                  }))
                }
              } else {
                setWikiSuggestRef.current(null)
              }
            }
          }),
        ],
      }),
      parent: editorMountRef.current,
    })

    viewRef.current = view

    return () => {
      if (isDirty.current && saveTimer.current) {
        clearTimeout(saveTimer.current)
        doSaveRef.current(view.state.doc.toString())
      }
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id])

  // Lock toggle
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: readOnlyCompartment.current.reconfigure(
        isLocked ? EditorState.readOnly.of(true) : [],
      ),
    })
  }, [isLocked])

  // Sync localTags on document switch
  useEffect(() => {
    setLocalTags(doc?.tags ?? [])
    setIsAddingTag(false)
    setTagInput('')
    setPreviousTags(null)
    setSuggestedTags(null)
    setIsSuggestingTags(false)
    setSuggestedSpeaker(null)
    setIsSuggestingSpeaker(false)
  }, [doc?.id])

  // ── Tag editing ──────────────────────────────────────────────────────────────

  const handleTagChange = useCallback((newTags: string[], saveUndo = true) => {
    if (saveUndo) setPreviousTags(localTags)
    setLocalTags(newTags)
    const currentRaw = viewRef.current?.state.doc.toString() ?? ''
    const newRaw = updateFrontmatterTags(currentRaw, newTags)
    if (viewRef.current) {
      viewRef.current.dispatch({
        changes: { from: 0, to: viewRef.current.state.doc.length, insert: newRaw },
      })
    }
  }, [localTags])

  const commitTag = useCallback(() => {
    const trimmed = tagInput.trim()
    if (trimmed) handleTagChange([...localTags, trimmed])
    setTagInput('')
    setIsAddingTag(false)
  }, [tagInput, localTags, handleTagChange])

  const handleUndoTags = useCallback(() => {
    if (previousTags === null) return
    handleTagChange(previousTags, false)
    setPreviousTags(null)
  }, [previousTags, handleTagChange])

  const handleSuggestTags = useCallback(async () => {
    setIsSuggestingTags(true)
    setSuggestedTags(null)
    try {
      const raw = viewRef.current?.state.doc.toString() ?? docRef.current?.rawContent ?? ''
      const filename = (docRef.current as LoadedDocument)?.filename ?? ''
      const { suggestTagsForDoc } = await import('@/services/tagService')
      const tags = await suggestTagsForDoc(filename, raw)
      setSuggestedTags(tags)
    } catch {
      setSuggestedTags([])
    } finally {
      setIsSuggestingTags(false)
    }
  }, [])

  const handleSuggestSpeaker = useCallback(async () => {
    setIsSuggestingSpeaker(true)
    setSuggestedSpeaker(null)
    try {
      const raw = viewRef.current?.state.doc.toString() ?? docRef.current?.rawContent ?? ''
      const filename = (docRef.current as LoadedDocument)?.filename ?? ''
      const { suggestSpeakerForDoc } = await import('@/services/tagService')
      const speaker = await suggestSpeakerForDoc(filename, raw)
      setSuggestedSpeaker(speaker)
    } catch {
      setSuggestedSpeaker(null)
    } finally {
      setIsSuggestingSpeaker(false)
    }
  }, [])

  const handleConfluenceUpload = useCallback(async () => {
    const currentDoc = docRef.current as LoadedDocument
    if (!currentDoc) return
    const raw = viewRef.current?.state.doc.toString() ?? currentDoc.rawContent
    const parsed = matter(raw)
    const pageId = parsed.data?.confluence_page_id as string | undefined
    if (!pageId) {
      alert('No confluence_page_id in frontmatter.\nExample: confluence_page_id: "12345"')
      return
    }
    const { activeVaultId } = useVaultStore.getState()
    const { confluenceConfigs } = useSettingsStore.getState()
    const cfg = confluenceConfigs[activeVaultId]
    if (!cfg?.baseUrl) {
      alert('Please configure Confluence integration in settings first.')
      return
    }
    const authHeader = cfg.authType === 'cloud' || cfg.authType === 'server_basic'
      ? makeBasicAuth(cfg.email, cfg.apiToken)
      : makePATAuth(cfg.apiToken)
    const creds = { baseUrl: cfg.baseUrl, authHeader }

    // markdown body (frontmatter removed)
    const bodyMd = parsed.content.trimStart()
    const title = currentDoc.filename.replace(/\.md$/i, '')

    setConfluenceUploadStatus('uploading')
    try {
      await updatePage(creds, pageId, title, bodyMd)
      setConfluenceUploadStatus('done')
      setTimeout(() => setConfluenceUploadStatus('idle'), 3000)
    } catch (e) {
      setConfluenceUploadStatus('error')
      alert(`Confluence upload failed: ${e instanceof Error ? e.message : String(e)}`)
      setTimeout(() => setConfluenceUploadStatus('idle'), 3000)
    }
  }, [])

  const applySuggestedSpeaker = useCallback(() => {
    if (!suggestedSpeaker) return
    const view = viewRef.current
    if (!view) return
    const raw = view.state.doc.toString()
    const parsed = matter(raw)
    parsed.data.speaker = suggestedSpeaker
    const updated = matter.stringify(parsed.content, parsed.data)
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: updated } })
    setSuggestedSpeaker(null)
  }, [suggestedSpeaker])

  // ── No document ─────────────────────────────────────────────────────────────

  if (!doc) {
    return (
      <div
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', gap: 12, height: '100%',
          color: 'var(--color-text-muted)', fontSize: 13,
        }}
      >
        <span>No file open</span>
        <button
          onClick={closeEditor}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'var(--color-bg-secondary)', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 2, color: 'var(--color-text-secondary)', cursor: 'pointer',
            padding: '6px 14px', fontSize: 12, transition: 'color 0.15s, border-color 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-text-primary)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.25)' }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-secondary)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)' }}
        >
          <ArrowLeft size={13} />
          Back to Graph
        </button>
      </div>
    )
  }

  const displayName = doc.filename.replace(/\.md$/i, '')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* ── Toolbar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
        <button
          onClick={closeEditor}
          style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: '3px 6px', borderRadius: 4, fontSize: 11, transition: 'color 0.1s' }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-text-primary)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
          title="Close editor"
        >
          <ArrowLeft size={13} />
        </button>

        {isRenaming ? (
          <input
            ref={renameInputRef}
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); commitRename() }
              if (e.key === 'Escape') { e.preventDefault(); isRenamingRef.current = false; setIsRenaming(false) }
            }}
            style={{
              flex: 1, fontSize: 12, fontWeight: 500,
              background: 'var(--color-bg-surface)',
              color: 'var(--color-text-primary)',
              border: '1px solid var(--color-accent)',
              borderRadius: 4, padding: '1px 6px', outline: 'none',
            }}
            autoFocus
          />
        ) : (
          <button
            onClick={canSave ? startRename : undefined}
            title={canSave ? 'Click to rename' : doc.filename}
            style={{
              flex: 1, fontSize: 12, fontWeight: 500,
              color: 'var(--color-text-primary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              background: 'transparent', border: 'none',
              cursor: canSave ? 'text' : 'default',
              textAlign: 'left', padding: 0,
              display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayName}</span>
            {canSave && <Pencil size={10} style={{ flexShrink: 0, color: 'var(--color-text-muted)', opacity: 0.5 }} />}
          </button>
        )}

        <button
          onClick={() => setIsLocked(v => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 3, background: 'transparent', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, color: isLocked ? 'var(--color-error)' : 'var(--color-text-muted)', cursor: 'pointer', padding: '3px 7px', fontSize: 11, transition: 'color 0.15s, border-color 0.15s' }}
          title={isLocked ? 'Unlock (allow editing)' : 'Lock (restrict editing)'}
        >
          {isLocked ? <Lock size={11} /> : <Unlock size={11} />}
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: !canSave ? 'var(--color-text-muted)' : saveStatus === 'saved' ? 'var(--color-success)' : saveStatus === 'error' ? 'var(--color-error)' : 'var(--color-text-muted)', transition: 'color 0.2s' }}>
          {!canSave && 'Read-only'}
          {canSave && saveStatus === 'saved' && <><CheckCircle size={11} />Saved</>}
          {canSave && saveStatus === 'saving' && 'Saving...'}
          {canSave && saveStatus === 'error' && <><AlertCircle size={11} />Save failed</>}
        </div>

        <button
          onClick={handleManualSave}
          disabled={!canSave}
          style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'transparent', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, color: 'var(--color-text-muted)', cursor: canSave ? 'pointer' : 'not-allowed', opacity: canSave ? 1 : 0.3, padding: '3px 7px', fontSize: 11, transition: 'color 0.1s, border-color 0.1s' }}
          onMouseEnter={e => { if (canSave) { e.currentTarget.style.color = 'var(--color-text-primary)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)' } }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-muted)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)' }}
          title={canSave ? 'Save (Ctrl+S)' : 'Cannot save non-vault files'}
        >
          <Save size={11} />
        </button>

        {/* Confluence reverse upload button — active when frontmatter has confluence_page_id */}
        {canSave && (() => {
          const raw = (doc as LoadedDocument)?.rawContent ?? ''
          const hasCfId = raw.includes('confluence_page_id')
          if (!hasCfId) return null
          const uploading = confluenceUploadStatus === 'uploading'
          const done = confluenceUploadStatus === 'done'
          const err = confluenceUploadStatus === 'error'
          return (
            <button
              onClick={handleConfluenceUpload}
              disabled={uploading}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                background: done ? 'rgba(52,211,153,0.12)' : err ? 'rgba(248,113,113,0.1)' : 'transparent',
                border: `1px solid ${done ? 'rgba(52,211,153,0.3)' : err ? 'rgba(248,113,113,0.3)' : 'rgba(255,255,255,0.08)'}`,
                borderRadius: 4, fontSize: 11,
                color: done ? 'var(--color-success)' : err ? 'var(--color-error)' : 'var(--color-text-muted)',
                cursor: uploading ? 'default' : 'pointer', opacity: uploading ? 0.5 : 1,
                padding: '3px 7px', transition: 'all 0.1s',
              }}
              title="Upload to Confluence page"
            >
              {uploading ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : '↑'}
              {done ? 'Uploaded' : err ? 'Failed' : 'Confluence'}
            </button>
          )
        })()}

        <button
          onClick={closeEditor}
          style={{ display: 'flex', alignItems: 'center', background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: '3px', borderRadius: 4, transition: 'color 0.1s' }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-text-primary)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
          title="Close"
        >
          <X size={13} />
        </button>
      </div>

      {/* ── Metadata bar (tags + folder) ── */}
      {(doc as LoadedDocument).absolutePath && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderBottom: '1px solid var(--color-border)', flexShrink: 0, flexWrap: 'wrap', minHeight: 28 }}>
          {(doc as LoadedDocument).folderPath && (
            <span style={{ fontSize: 10, color: 'var(--color-text-muted)', marginRight: 2 }}>
              📁 {(doc as LoadedDocument).folderPath}
            </span>
          )}

          {localTags.map(tag => (
            <span
              key={tag}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--color-accent)', background: 'var(--color-bg-active)', borderRadius: 3, padding: '1px 5px' }}
            >
              #{tag}
              {!isLocked && (
                <button
                  onClick={() => handleTagChange(localTags.filter(t => t !== tag))}
                  style={{ display: 'flex', alignItems: 'center', background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: 0, fontSize: 10, lineHeight: 1 }}
                  title={`Remove "${tag}" tag`}
                >
                  ×
                </button>
              )}
            </span>
          ))}

          {!isLocked && (
            isAddingTag
              ? <>
                  {/* Preset tag quick selection */}
                  {tagPresets.filter(p => !localTags.includes(p)).map(p => (
                    <button
                      key={p}
                      onMouseDown={e => {
                        e.preventDefault()
                        handleTagChange([...localTags, p])
                        setIsAddingTag(false)
                      }}
                      style={{ fontSize: 10, color: 'var(--color-accent)', background: 'var(--color-bg-active)', border: '1px solid rgba(96,165,250,0.3)', cursor: 'pointer', padding: '1px 5px', borderRadius: 3, transition: 'opacity 0.1s' }}
                      title={`Add #${p} tag`}
                    >
                      #{p}
                    </button>
                  ))}
                  <input
                    autoFocus
                    value={tagInput}
                    placeholder="Type tag..."
                    onChange={e => setTagInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { e.preventDefault(); commitTag() }
                      if (e.key === 'Escape') { setTagInput(''); setIsAddingTag(false) }
                    }}
                    onBlur={commitTag}
                    style={{ fontSize: 10, background: 'transparent', border: 'none', borderBottom: '1px solid var(--color-accent)', color: 'var(--color-text-primary)', width: 72, outline: 'none', padding: '1px 0' }}
                  />
                </>
              : <button
                  onClick={() => setIsAddingTag(true)}
                  style={{ fontSize: 10, color: 'var(--color-text-muted)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '1px 4px', borderRadius: 3, transition: 'color 0.1s' }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-text-primary)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
                  title="Add tag"
                >
                  + Tag
                </button>
          )}

          {!isLocked && !isAddingTag && (
            <>
              <button
                onClick={handleSuggestTags}
                disabled={isSuggestingTags}
                style={{ display: 'flex', alignItems: 'center', background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: isSuggestingTags ? 'default' : 'pointer', padding: '1px 4px', borderRadius: 3, transition: 'color 0.1s', opacity: isSuggestingTags ? 0.5 : 1 }}
                onMouseEnter={e => { if (!isSuggestingTags) e.currentTarget.style.color = 'var(--color-accent)' }}
                onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-muted)' }}
                title="AI tag suggestions"
              >
                {isSuggestingTags ? <Loader2 size={10} /> : <Wand2 size={10} />}
              </button>
              <button
                onClick={handleSuggestSpeaker}
                disabled={isSuggestingSpeaker}
                style={{ display: 'flex', alignItems: 'center', gap: 2, background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: isSuggestingSpeaker ? 'default' : 'pointer', padding: '1px 4px', borderRadius: 3, transition: 'color 0.1s', opacity: isSuggestingSpeaker ? 0.5 : 1, fontSize: 10 }}
                onMouseEnter={e => { if (!isSuggestingSpeaker) e.currentTarget.style.color = 'var(--color-accent)' }}
                onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-muted)' }}
                title="AI persona suggestion"
              >
                {isSuggestingSpeaker ? <Loader2 size={10} /> : '👤'}
              </button>
            </>
          )}

          {!isLocked && previousTags !== null && (
            <button
              onClick={handleUndoTags}
              style={{ display: 'flex', alignItems: 'center', background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: '1px 4px', borderRadius: 3, transition: 'color 0.1s' }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-text-primary)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
              title="Undo tag changes"
            >
              <RotateCcw size={10} />
            </button>
          )}

          {suggestedSpeaker !== null && (
            <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 5, paddingTop: 3 }}>
              <span style={{ fontSize: 9, color: 'var(--color-text-muted)' }}>Persona suggestion:</span>
              <span style={{ fontSize: 10, color: 'var(--color-accent)', background: 'var(--color-bg-active)', borderRadius: 3, padding: '1px 5px' }}>
                {suggestedSpeaker}
              </span>
              <button
                onClick={applySuggestedSpeaker}
                style={{ fontSize: 10, color: 'var(--color-text-muted)', background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', padding: '1px 5px', borderRadius: 3, transition: 'color 0.1s' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-text-primary)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
              >
                Apply
              </button>
              <button
                onClick={() => setSuggestedSpeaker(null)}
                style={{ fontSize: 10, color: 'var(--color-text-muted)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '1px 4px', borderRadius: 3, transition: 'color 0.1s' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-text-primary)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
              >
                Cancel
              </button>
            </div>
          )}

          {suggestedTags !== null && (
            <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 5, paddingTop: 3 }}>
              <span style={{ fontSize: 9, color: 'var(--color-text-muted)' }}>Suggestions:</span>
              {suggestedTags.length === 0
                ? <span style={{ fontSize: 9, color: 'var(--color-text-muted)' }}>No suitable tags</span>
                : suggestedTags.map(t => (
                    <span key={t} style={{ fontSize: 10, color: 'var(--color-accent)', background: 'var(--color-bg-active)', borderRadius: 3, padding: '1px 5px' }}>#{t}</span>
                  ))
              }
              {suggestedTags.length > 0 && (
                <button
                  onClick={() => { handleTagChange(suggestedTags); setSuggestedTags(null) }}
                  style={{ fontSize: 10, color: 'var(--color-text-muted)', background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', padding: '1px 5px', borderRadius: 3, transition: 'color 0.1s' }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-text-primary)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
                >
                  Apply
                </button>
              )}
              <button
                onClick={() => setSuggestedTags(null)}
                style={{ fontSize: 10, color: 'var(--color-text-muted)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '1px 4px', borderRadius: 3, transition: 'color 0.1s' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-text-primary)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── CodeMirror editor ── */}
      <div ref={editorMountRef} style={{ flex: 1, minHeight: 0 }} />

      {/* ── WikiLink autocomplete dropdown (React portal → document.body) ── */}
      {wikiSuggest && filteredDocs.length > 0 && (
        <SuggestDropdown
          docs={filteredDocs}
          selectedIdx={clampedIdx}
          rect={wikiSuggest.rect}
          onSelect={applyWikiSuggest}
        />
      )}
    </div>
  )
}
