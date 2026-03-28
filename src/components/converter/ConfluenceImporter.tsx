/**
 * ConfluenceImporter — Confluence batch converter
 *
 * Two import modes:
 *   Folder — webkitdirectory: pick downloaded_pages folder (offline)
 *   API    — enter Confluence URL + credentials, fetch live (Confluence Cloud or Server)
 *
 * Both modes produce the same ConfluenceExportPage objects and use the same
 * convertConfluenceExportPage() → MD pipeline.
 */

import { useState, useRef, useEffect } from 'react'
import { Folder, Globe, Download, RotateCcw, Eye, EyeOff } from 'lucide-react'
import {
  parseConfluenceFolder,
  convertConfluenceExportPage,
  type ConfluenceExportPage,
} from '@/lib/confluenceConverter'
import {
  fetchPages,
  buildConfluenceExportPage,
  makeBasicAuth,
  makePATAuth,
  type ConfluenceCredentials,
  type ConfluenceExportPageSummary,
} from '@/services/confluenceApi'

// ── Types ─────────────────────────────────────────────────────────────────────

type ImportMode = 'folder' | 'api'

interface PageItem {
  id: string
  title: string
  /** Available in folder mode immediately; built lazily in API mode */
  page?: ConfluenceExportPage
  status: 'pending' | 'running' | 'done' | 'error'
  markdown?: string
  error?: string
  progressMsg?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function downloadMd(text: string, title: string) {
  const safe = (title.trim() || 'converted_doc').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${safe}.md`
  a.click()
  URL.revokeObjectURL(url)
}

function InputField({
  label, value, onChange, placeholder, type = 'text', disabled = false,
}: {
  label: string; value: string; onChange: (v: string) => void
  placeholder?: string; type?: string; disabled?: boolean
}) {
  return (
    <div>
      <label className="text-[10px] block mb-1" style={{ color: 'var(--color-text-muted)' }}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full px-2.5 py-1.5 text-xs rounded"
        style={{
          background: 'var(--color-bg-secondary)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-text-primary)',
          outline: 'none',
        }}
      />
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ConfluenceImporter() {
  const [mode, setMode] = useState<ImportMode>('folder')

  // ── Shared: page list + selection ──────────────────────────────────────────
  const [pages, setPages] = useState<PageItem[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(false)

  // ── Folder mode ────────────────────────────────────────────────────────────
  const folderInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    folderInputRef.current?.setAttribute('webkitdirectory', '')
  }, [])

  const handleFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    const detected = parseConfluenceFolder(Array.from(files))
    const items: PageItem[] = detected.map(p => ({
      id: p.id, title: p.title, page: p, status: 'pending',
    }))
    setPages(items)
    setSelectedIds(new Set(detected.map(p => p.id)))
    setDone(false)
  }

  // ── API mode ───────────────────────────────────────────────────────────────
  const [apiUrl, setApiUrl] = useState('')
  const [authType, setAuthType] = useState<'cloud' | 'server'>('cloud')
  const [apiEmail, setApiEmail] = useState('')
  const [apiToken, setApiToken] = useState('')
  const [apiPat, setApiPat] = useState('')
  const [spaceKey, setSpaceKey] = useState('')
  const [showSecret, setShowSecret] = useState(false)
  const [apiFetching, setApiFetching] = useState(false)
  const [apiFetchError, setApiFetchError] = useState('')

  const buildCreds = (): ConfluenceCredentials => ({
    baseUrl: apiUrl.replace(/\/+$/, ''),
    authHeader:
      authType === 'cloud'
        ? makeBasicAuth(apiEmail, apiToken)
        : makePATAuth(apiPat),
  })

  const handleFetchPages = async () => {
    const urlTrim = apiUrl.trim()
    if (!urlTrim) { setApiFetchError('Please enter a Confluence URL.'); return }
    if (authType === 'cloud' && (!apiEmail.trim() || !apiToken.trim())) {
      setApiFetchError('Please enter email and API token.'); return
    }
    if (authType === 'server' && !apiPat.trim()) {
      setApiFetchError('Please enter a Personal Access Token.'); return
    }

    setApiFetching(true)
    setApiFetchError('')
    setPages([])
    setDone(false)

    try {
      const summaries: ConfluenceExportPageSummary[] = await fetchPages(
        buildCreds(),
        spaceKey.trim() || undefined,
      )
      const items: PageItem[] = summaries.map(s => ({
        id: s.id, title: s.title, status: 'pending',
      }))
      setPages(items)
      setSelectedIds(new Set(items.map(p => p.id)))
    } catch (err) {
      setApiFetchError(err instanceof Error ? err.message : 'Failed to fetch page list')
    } finally {
      setApiFetching(false)
    }
  }

  // ── Selection helpers ──────────────────────────────────────────────────────
  const toggle = (id: string) =>
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const toggleAll = () =>
    setSelectedIds(
      selectedIds.size === pages.length
        ? new Set()
        : new Set(pages.map(p => p.id))
    )

  // ── Conversion ─────────────────────────────────────────────────────────────
  const handleConvert = async () => {
    if (selectedIds.size === 0) return
    setRunning(true)
    setDone(false)

    const creds = mode === 'api' ? buildCreds() : null
    const updated = [...pages]

    for (let i = 0; i < updated.length; i++) {
      if (!selectedIds.has(updated[i].id)) continue

      updated[i] = { ...updated[i], status: 'running', progressMsg: 'Preparing...' }
      setPages([...updated])

      try {
        let confluencePage: ConfluenceExportPage

        if (mode === 'folder') {
          // Folder mode: page already has the File objects
          confluencePage = updated[i].page!
        } else {
          // API mode: fetch page + attachments on-demand
          const summary: ConfluenceExportPageSummary = {
            id: updated[i].id,
            title: updated[i].title,
            spaceKey: '',
          }
          confluencePage = await buildConfluenceExportPage(creds!, summary, msg => {
            updated[i] = { ...updated[i], progressMsg: msg }
            setPages([...updated])
          })
        }

        const markdown = await convertConfluenceExportPage(confluencePage)
        updated[i] = { ...updated[i], status: 'done', markdown, progressMsg: undefined }
      } catch (err) {
        updated[i] = {
          ...updated[i],
          status: 'error',
          error: err instanceof Error ? err.message : 'Conversion failed',
          progressMsg: undefined,
        }
      }

      setPages([...updated])
    }

    setRunning(false)
    setDone(true)
  }

  // ── Download ───────────────────────────────────────────────────────────────
  const handleDownloadOne = (item: PageItem) => {
    if (item.markdown) downloadMd(item.markdown, item.title)
  }
  const handleDownloadAll = () =>
    pages.filter(p => p.status === 'done' && p.markdown).forEach(handleDownloadOne)

  // ── Reset ──────────────────────────────────────────────────────────────────
  const handleReset = () => {
    setPages([])
    setSelectedIds(new Set())
    setRunning(false)
    setDone(false)
    setApiFetchError('')
    if (folderInputRef.current) folderInputRef.current.value = ''
  }

  // ── Derived values ─────────────────────────────────────────────────────────
  const selectedCount = selectedIds.size
  const doneCount = pages.filter(p => p.status === 'done').length
  const currentRunning = pages.find(p => p.status === 'running')

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4">

      {/* Mode toggle */}
      <div className="flex gap-1">
        {([
          { id: 'folder', label: 'Import Folder', icon: <Folder size={11} /> },
          { id: 'api',    label: 'API Connect',  icon: <Globe  size={11} /> },
        ] as const).map(m => (
          <button
            key={m.id}
            onClick={() => { setMode(m.id); handleReset() }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded transition-colors"
            style={{
              background: mode === m.id ? 'var(--color-bg-hover)' : 'transparent',
              color: mode === m.id ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
              border: '1px solid var(--color-border)',
              fontWeight: mode === m.id ? 500 : 400,
            }}
          >
            {m.icon}{m.label}
          </button>
        ))}
      </div>

      {/* ── FOLDER MODE ─────────────────────────────────────────────────── */}
      {mode === 'folder' && (
        <>
          <div
            className="text-xs px-3 py-2 rounded"
            style={{
              background: 'var(--color-bg-secondary)',
              color: 'var(--color-text-muted)',
              border: '1px solid var(--color-border)',
            }}
          >
            📌 <code style={{ color: 'var(--color-accent)' }}>{'ID_제목.html'}</code>
            {' '}+{' '}
            <code style={{ color: 'var(--color-accent)' }}>{'ID_files/'}</code>
            {' '}structure is automatically recognized.
          </div>

          <div
            className="flex flex-col items-center justify-center gap-3 rounded-lg p-6 cursor-pointer transition-colors hover:bg-[var(--color-bg-hover)]"
            style={{ border: '1.5px dashed var(--color-border)' }}
            onClick={() => !running && folderInputRef.current?.click()}
          >
            <Folder size={24} style={{ color: 'var(--color-text-muted)' }} />
            <div className="text-center">
              <div className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                Select downloaded_pages folder
              </div>
              <div className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                HTML + PDF, DOCX, PPTX, XLSX attachments auto-converted
              </div>
            </div>
            {pages.length > 0 && (
              <div className="text-xs font-medium" style={{ color: 'var(--color-accent)' }}>
                ✓ {pages.length} pages detected
              </div>
            )}
            <input
              ref={folderInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFolderSelect}
            />
          </div>
        </>
      )}

      {/* ── API MODE ────────────────────────────────────────────────────── */}
      {mode === 'api' && (
        <div className="flex flex-col gap-3">
          {/* Auth type toggle */}
          <div className="flex gap-1">
            {([
              { id: 'cloud',  label: 'Cloud (Email + API Token)' },
              { id: 'server', label: 'Server / DC (PAT)' },
            ] as const).map(t => (
              <button
                key={t.id}
                onClick={() => setAuthType(t.id)}
                className="px-2.5 py-1 text-[10px] rounded transition-colors"
                style={{
                  background: authType === t.id ? 'var(--color-accent)' : 'var(--color-bg-hover)',
                  color: authType === t.id ? '#fff' : 'var(--color-text-muted)',
                  border: '1px solid var(--color-border)',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Credentials form */}
          <div className="flex flex-col gap-2">
            <InputField
              label="Confluence URL"
              value={apiUrl}
              onChange={setApiUrl}
              placeholder="https://company.atlassian.net/wiki"
              disabled={running}
            />

            {authType === 'cloud' ? (
              <>
                <InputField
                  label="Email"
                  value={apiEmail}
                  onChange={setApiEmail}
                  placeholder="you@company.com"
                  disabled={running}
                />
                <div>
                  <label className="text-[10px] block mb-1" style={{ color: 'var(--color-text-muted)' }}>
                    API Token{' '}
                    <a
                      href="https://id.atlassian.com/manage-profile/security/api-tokens"
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                      style={{ color: 'var(--color-accent)' }}
                    >
                      Get one ↗
                    </a>
                  </label>
                  <div className="relative">
                    <input
                      type={showSecret ? 'text' : 'password'}
                      value={apiToken}
                      onChange={e => setApiToken(e.target.value)}
                      placeholder="ATATT3…"
                      disabled={running}
                      className="w-full px-2.5 py-1.5 pr-8 text-xs rounded"
                      style={{
                        background: 'var(--color-bg-secondary)',
                        border: '1px solid var(--color-border)',
                        color: 'var(--color-text-primary)',
                        outline: 'none',
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowSecret(v => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2"
                      style={{ color: 'var(--color-text-muted)' }}
                    >
                      {showSecret ? <EyeOff size={11} /> : <Eye size={11} />}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div>
                <label className="text-[10px] block mb-1" style={{ color: 'var(--color-text-muted)' }}>
                  Personal Access Token
                </label>
                <div className="relative">
                  <input
                    type={showSecret ? 'text' : 'password'}
                    value={apiPat}
                    onChange={e => setApiPat(e.target.value)}
                    placeholder="Enter token"
                    disabled={running}
                    className="w-full px-2.5 py-1.5 pr-8 text-xs rounded"
                    style={{
                      background: 'var(--color-bg-secondary)',
                      border: '1px solid var(--color-border)',
                      color: 'var(--color-text-primary)',
                      outline: 'none',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret(v => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    {showSecret ? <EyeOff size={11} /> : <Eye size={11} />}
                  </button>
                </div>
              </div>
            )}

            <InputField
              label="Space Key (optional, blank for all)"
              value={spaceKey}
              onChange={setSpaceKey}
              placeholder="e.g.: PROJ"
              disabled={running}
            />
          </div>

          {/* Fetch button */}
          <button
            onClick={handleFetchPages}
            disabled={apiFetching || running}
            className="flex items-center justify-center gap-1.5 px-4 py-2 text-xs rounded font-medium transition-colors disabled:opacity-40"
            style={{
              background: 'var(--color-accent)',
              color: 'white',
            }}
          >
            {apiFetching ? '⟳ Fetching page list...' : '📥 Fetch Page List'}
          </button>

          {/* Fetch error */}
          {apiFetchError && (
            <div
              className="text-xs px-3 py-2 rounded"
              style={{ background: '#3d1a1a', color: '#e74c3c', border: '1px solid #5a2020' }}
            >
              {apiFetchError}
            </div>
          )}
        </div>
      )}

      {/* ── Shared: Page list ───────────────────────────────────────────── */}
      {pages.length > 0 && (
        <div
          className="rounded-lg overflow-hidden"
          style={{ border: '1px solid var(--color-border)' }}
        >
          {/* List header */}
          <div
            className="flex items-center justify-between px-3 py-2"
            style={{
              background: 'var(--color-bg-secondary)',
              borderBottom: '1px solid var(--color-border)',
            }}
          >
            {done ? (
              <span className="text-xs" style={{ color: 'var(--color-accent)' }}>
                ✓ {doneCount} / {pages.filter(p => selectedIds.has(p.id)).length} converted
              </span>
            ) : (
              <label
                className="flex items-center gap-2 cursor-pointer text-xs"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.size === pages.length && pages.length > 0}
                  onChange={toggleAll}
                  disabled={running}
                  className="cursor-pointer"
                />
                Select All ({selectedIds.size}/{pages.length})
              </label>
            )}
            {running && currentRunning?.progressMsg && (
              <span
                className="text-[10px] truncate max-w-[200px]"
                style={{ color: 'var(--color-text-muted)' }}
              >
                ⟳ {currentRunning.progressMsg}
              </span>
            )}
          </div>

          {/* Progress bar */}
          {running && (
            <div className="h-0.5" style={{ background: 'var(--color-bg-hover)' }}>
              <div
                className="h-full transition-all duration-300"
                style={{
                  width: `${selectedCount > 0 ? (doneCount / selectedCount) * 100 : 0}%`,
                  background: 'var(--color-accent)',
                }}
              />
            </div>
          )}

          {/* Page rows */}
          <div className="max-h-72 overflow-y-auto">
            {pages.map((item, idx) => {
              const isSelected = selectedIds.has(item.id)
              const docCount = item.page?.attachments.filter(
                a => ['pdf', 'docx', 'pptx', 'xlsx'].includes(a.type)
              ).length
              const imgCount = item.page?.attachments.filter(a => a.type === 'image').length

              return (
                <div
                  key={item.id}
                  className="flex items-center gap-2 px-3 py-2 transition-colors hover:bg-[var(--color-bg-hover)]"
                  style={{
                    borderBottom: idx < pages.length - 1 ? '1px solid var(--color-border)' : undefined,
                    background: item.status === 'running' ? 'var(--color-bg-hover)' : undefined,
                  }}
                >
                  {!done && (
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggle(item.id)}
                      disabled={running}
                      className="cursor-pointer shrink-0"
                    />
                  )}

                  {/* Status icon */}
                  <span
                    className="text-xs w-3 text-center shrink-0"
                    style={{
                      color:
                        item.status === 'done' ? 'var(--color-accent)' :
                        item.status === 'error' ? '#e74c3c' : 'transparent',
                    }}
                  >
                    {item.status === 'done' ? '✓' :
                     item.status === 'error' ? '✗' :
                     item.status === 'running' ? '⟳' : '·'}
                  </span>

                  {/* Title */}
                  <span
                    className="text-xs flex-1 truncate"
                    title={item.title}
                    style={{
                      color:
                        item.status === 'done' ? 'var(--color-accent)' :
                        item.status === 'error' ? '#e74c3c' :
                        item.status === 'running' ? 'var(--color-text-primary)' :
                        isSelected ? 'var(--color-text-secondary)' : 'var(--color-text-muted)',
                    }}
                  >
                    {item.title}
                  </span>

                  {/* Attachment counts (folder mode only — known before conversion) */}
                  {mode === 'folder' && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      {(docCount ?? 0) > 0 && (
                        <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                          📄{docCount}
                        </span>
                      )}
                      {(imgCount ?? 0) > 0 && (
                        <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                          🖼{imgCount}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Progress message (API mode running) */}
                  {item.status === 'running' && item.progressMsg && (
                    <span
                      className="text-[10px] shrink-0 max-w-[140px] truncate"
                      style={{ color: 'var(--color-text-muted)' }}
                    >
                      {item.progressMsg}
                    </span>
                  )}

                  {/* Per-file download button */}
                  {item.status === 'done' && item.markdown && (
                    <button
                      onClick={() => handleDownloadOne(item)}
                      className="shrink-0 p-1 rounded transition-colors hover:bg-[var(--color-bg-hover)]"
                      style={{ color: 'var(--color-accent)' }}
                      title="Download MD"
                    >
                      <Download size={11} />
                    </button>
                  )}

                  {/* Error message */}
                  {item.status === 'error' && item.error && (
                    <span
                      className="text-[10px] shrink-0 max-w-[120px] truncate"
                      style={{ color: '#e74c3c' }}
                      title={item.error}
                    >
                      {item.error}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Action buttons ─────────────────────────────────────────────── */}
      {pages.length > 0 && (
        <div className="flex gap-2 justify-end">
          <button
            onClick={handleReset}
            className="flex items-center gap-1 px-3 py-1.5 text-xs rounded transition-colors hover:bg-[var(--color-bg-hover)]"
            style={{ color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}
          >
            <RotateCcw size={11} />
            Reset
          </button>

          {done ? (
            <button
              onClick={handleDownloadAll}
              disabled={doneCount === 0}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs rounded font-medium transition-colors disabled:opacity-40"
              style={{ background: 'var(--color-accent)', color: 'white' }}
            >
              <Download size={11} />
              Download All ({doneCount})
            </button>
          ) : (
            <button
              onClick={handleConvert}
              disabled={running || selectedCount === 0}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs rounded font-medium transition-colors disabled:opacity-40"
              style={{
                background: selectedCount > 0 && !running ? 'var(--color-accent)' : 'var(--color-bg-hover)',
                color: selectedCount > 0 && !running ? 'white' : 'var(--color-text-muted)',
              }}
            >
              {running
                ? `⟳ Converting... (${doneCount}/${selectedCount})`
                : `▶ Convert ${selectedCount} pages`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
