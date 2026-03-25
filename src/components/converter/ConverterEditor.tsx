/**
 * ConverterEditor — MD conversion editor (center panel 'editor' tab)
 *
 * 3-stage pipeline:
 *   Stage 1 — Input: paste text / upload file / batch folder conversion
 *   Stage 2 — AI Processing: Claude extracts keywords + builds Obsidian structure (streaming)
 *   Stage 3 — Review & Approve: editable textarea + keyword chips + save/download
 */

import { useState, useRef, useEffect, useMemo } from 'react'
import { ChevronLeft, ArrowRight, Check, Download, Save, RotateCcw, Upload, Folder, Globe } from 'lucide-react'
import ConfluenceImporter from './ConfluenceImporter'
import { useUIStore } from '@/stores/uiStore'
import { useVaultStore } from '@/stores/vaultStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { SPEAKER_IDS, SPEAKER_CONFIG } from '@/lib/speakerConfig'
import { convertToObsidianMD } from '@/services/llmClient'
import { readFileAsText, type ConversionMeta, type ConversionType } from '@/lib/mdConverter'
import { cn } from '@/lib/utils'

const DOC_TYPES: { value: ConversionType; label: string }[] = [
  { value: 'minutes',  label: 'Meeting Minutes' },
  { value: 'report',   label: 'Report' },
  { value: 'proposal', label: 'Proposal' },
  { value: 'other',    label: 'Other' },
]

const SUPPORTED_EXTS = ['.txt', '.md', '.html', '.htm', '.docx', '.pdf']
function isSupportedFile(name: string): boolean {
  const lower = name.toLowerCase()
  return SUPPORTED_EXTS.some(ext => lower.endsWith(ext))
}

type InputTab = 'paste' | 'upload' | 'folder' | 'confluence'
type Stage = 'input' | 'processing' | 'review'
type Step2State = 'pending' | 'running' | 'done'

interface Step2Status {
  analyze: Step2State
  keywords: Step2State
  structure: Step2State
}

interface BatchItem {
  file: File
  status: 'pending' | 'running' | 'done' | 'error'
  mdResult?: string
  keywords?: string[]
  error?: string
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function today(): string {
  return new Date().toISOString().split('T')[0]
}

function safeName(title: string): string {
  return (title.trim() || 'converted_document')
    .replace(/[\\/:*?"<>|]/g, '_')
    .slice(0, 60)
}

function parseKeywords(text: string): string[] {
  const firstLine = text.split('\n')[0] ?? ''
  if (!firstLine.startsWith('KEYWORDS:')) return []
  return firstLine
    .replace('KEYWORDS:', '')
    .split(',')
    .map(k => k.trim())
    .filter(Boolean)
}

function extractMdBody(text: string): string {
  const withoutKeywords = text.replace(/^KEYWORDS:.*\n?/, '')
  const withoutSep = withoutKeywords.replace(/^\n?---\n/, '')
  return withoutSep.trim()
}

function fileExt(name: string): string {
  return name.slice(name.lastIndexOf('.')).toLowerCase()
}

function downloadMd(mdText: string, basename: string) {
  const filename = `${safeName(basename)}.md`
  const blob = new Blob([mdText], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StepIndicator({
  stage,
  step2Status,
}: {
  stage: Stage
  step2Status: Step2Status
}) {
  const steps: { key: Stage | 'processing'; label: string }[] = [
    { key: 'input',      label: '1. Input' },
    { key: 'processing', label: '2. AI Processing' },
    { key: 'review',     label: '3. Review & Approve' },
  ]

  return (
    <div
      className="flex items-center gap-0 px-4 py-2 shrink-0"
      style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)' }}
    >
      {steps.map((step, i) => {
        const isActive = stage === step.key || (stage === 'processing' && step.key === 'processing')
        const isDone =
          (step.key === 'input' && (stage === 'processing' || stage === 'review')) ||
          (step.key === 'processing' && stage === 'review')
        return (
          <div key={step.key} className="flex items-center">
            {i > 0 && (
              <ArrowRight size={12} style={{ color: 'var(--color-text-muted)', margin: '0 6px' }} />
            )}
            <span
              className="text-xs px-2 py-0.5 rounded"
              style={{
                color: isDone
                  ? 'var(--color-accent)'
                  : isActive
                  ? 'var(--color-text-primary)'
                  : 'var(--color-text-muted)',
                fontWeight: isActive ? 600 : 400,
                background: isActive ? 'var(--color-bg-hover)' : 'transparent',
              }}
            >
              {isDone ? '✓ ' : ''}{step.label}
            </span>
          </div>
        )
      })}

      {stage === 'processing' && (
        <div className="flex items-center gap-3 ml-6">
          {([
            { key: 'analyze',  label: 'Document analysis' },
            { key: 'keywords', label: 'Keyword extraction' },
            { key: 'structure',label: 'MD generation' },
          ] as const).map(s => (
            <span
              key={s.key}
              className="text-xs flex items-center gap-1"
              style={{ color: step2Status[s.key] === 'done' ? 'var(--color-accent)' : 'var(--color-text-muted)' }}
            >
              {step2Status[s.key] === 'done' ? '✓' : step2Status[s.key] === 'running' ? '⟳' : '○'}
              {' '}{s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

interface ConverterEditorProps {
  /** When provided (embedded in Settings), hides the "← Graph" back button. */
  onBack?: () => void
}

export default function ConverterEditor({ onBack }: ConverterEditorProps = {}) {
  const { setCenterTab } = useUIStore()
  const { vaultPath } = useVaultStore()
  const customPersonas = useSettingsStore(s => s.customPersonas)
  const disabledPersonaIds = useSettingsStore(s => s.disabledPersonaIds)

  // Merge built-in speakers (excluding disabled) with custom personas
  const speakers = useMemo(() => [
    ...SPEAKER_IDS
      .filter(id => !disabledPersonaIds.includes(id))
      .map(id => ({ id, label: SPEAKER_CONFIG[id].label })),
    ...customPersonas.map(p => ({ id: p.id, label: p.label })),
  ], [customPersonas, disabledPersonaIds])

  // Stage / tab
  const [stage, setStage] = useState<Stage>('input')
  const [inputTab, setInputTab] = useState<InputTab>('paste')

  // Stage 1 — single file state
  const [content, setContent] = useState('')
  const [meta, setMeta] = useState<ConversionMeta>({
    title: '',
    speaker: 'chief_director',
    date: today(),
    type: 'minutes',
  })

  // Keep meta.speaker in sync if currently selected speaker is removed
  useEffect(() => {
    if (speakers.length > 0 && !speakers.some(s => s.id === meta.speaker)) {
      setMeta(m => ({ ...m, speaker: speakers[0].id }))
    }
  }, [speakers, meta.speaker])
  const [uploadFileName, setUploadFileName] = useState('')
  const [uploadError, setUploadError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Stage 1 — folder batch state
  const [folderFiles, setFolderFiles] = useState<File[]>([])
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set())
  const folderInputRef = useRef<HTMLInputElement>(null)

  // Set webkitdirectory on the folder input (not in JSX type defs)
  useEffect(() => {
    folderInputRef.current?.setAttribute('webkitdirectory', '')
  }, [])

  // Stage 2 — shared streaming state
  const [streamedText, setStreamedText] = useState('')
  const [step2Status, setStep2Status] = useState<Step2Status>({
    analyze: 'pending', keywords: 'pending', structure: 'pending',
  })
  const [processError, setProcessError] = useState('')

  // Stage 2 — batch progress
  const [batchItems, setBatchItems] = useState<BatchItem[]>([])
  const [batchCurrentIdx, setBatchCurrentIdx] = useState(0)

  // Stage 3 — single file state
  const [keywords, setKeywords] = useState<string[]>([])
  const [finalMd, setFinalMd] = useState('')
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  const isBatchMode = inputTab === 'folder'

  // ── Handlers — folder ──────────────────────────────────────────────────────

  const handleFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    const supported = Array.from(files)
      .filter(f => isSupportedFile(f.name))
      .sort((a, b) => a.name.localeCompare(b.name))
    setFolderFiles(supported)
    setSelectedIndices(new Set(supported.map((_, i) => i)))
  }

  const toggleFile = (idx: number) => {
    setSelectedIndices(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  const toggleAll = () => {
    if (selectedIndices.size === folderFiles.length) {
      setSelectedIndices(new Set())
    } else {
      setSelectedIndices(new Set(folderFiles.map((_, i) => i)))
    }
  }

  // ── Handlers — single file ─────────────────────────────────────────────────

  const handleFileSelect = async (file: File) => {
    setUploadError('')
    setUploadFileName(file.name)
    try {
      const text = await readFileAsText(file)
      setContent(text)
      if (!meta.title) {
        setMeta(m => ({ ...m, title: file.name.replace(/\.[^.]+$/, '') }))
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to read file')
    }
  }

  // ── Core conversion helper (used by both single and batch) ─────────────────

  async function runConversion(
    fileContent: string,
    fileMeta: ConversionMeta,
    onStream: (text: string) => void,
    onStatus: (s: Step2Status) => void,
  ): Promise<{ mdResult: string; kws: string[] }> {
    let buffer = ''
    let kwsParsed = false
    let firstChunk = true

    await convertToObsidianMD(fileContent, fileMeta, (chunk: string) => {
      buffer += chunk
      onStream(buffer)
      if (firstChunk) {
        firstChunk = false
        onStatus({ analyze: 'done', keywords: 'running', structure: 'pending' })
      }
      if (!kwsParsed && buffer.includes('\n')) {
        const kws = parseKeywords(buffer)
        if (kws.length > 0) {
          kwsParsed = true
          onStatus({ analyze: 'done', keywords: 'done', structure: 'running' })
        }
      }
    })

    onStatus({ analyze: 'done', keywords: 'done', structure: 'done' })
    return { mdResult: extractMdBody(buffer), kws: parseKeywords(buffer) }
  }

  // ── Handler — single file conversion ──────────────────────────────────────

  const handleStartConversion = async () => {
    if (!content.trim()) return
    setStage('processing')
    setStreamedText('')
    setProcessError('')
    setStep2Status({ analyze: 'running', keywords: 'pending', structure: 'pending' })

    try {
      const { mdResult, kws } = await runConversion(
        content,
        meta,
        text => setStreamedText(text),
        status => setStep2Status(status),
      )
      setKeywords(kws)
      setFinalMd(mdResult)
      setTimeout(() => setStage('review'), 400)
    } catch (err) {
      setProcessError(err instanceof Error ? err.message : 'Error during conversion')
      setStep2Status(s => ({ ...s, structure: 'pending' }))
    }
  }

  // ── Handler — batch folder conversion ─────────────────────────────────────

  const handleBatchStart = async () => {
    const selected = folderFiles.filter((_, i) => selectedIndices.has(i))
    if (selected.length === 0) return

    const items: BatchItem[] = selected.map(file => ({ file, status: 'pending' }))
    setBatchItems(items)
    setBatchCurrentIdx(0)
    setStage('processing')
    setStreamedText('')
    setProcessError('')

    const updatedItems = [...items]

    for (let i = 0; i < items.length; i++) {
      setBatchCurrentIdx(i)
      updatedItems[i] = { ...updatedItems[i], status: 'running' }
      setBatchItems([...updatedItems])
      setStreamedText('')
      setStep2Status({ analyze: 'running', keywords: 'pending', structure: 'pending' })

      try {
        const fileContent = await readFileAsText(items[i].file)
        const title = items[i].file.name.replace(/\.[^.]+$/, '')
        const fileMeta: ConversionMeta = {
          title,
          speaker: meta.speaker,
          date: meta.date,
          type: meta.type,
        }

        const { mdResult, kws } = await runConversion(
          fileContent,
          fileMeta,
          text => setStreamedText(text),
          status => setStep2Status(status),
        )

        updatedItems[i] = { ...updatedItems[i], status: 'done', mdResult, keywords: kws }
        setBatchItems([...updatedItems])
      } catch (err) {
        updatedItems[i] = {
          ...updatedItems[i],
          status: 'error',
          error: err instanceof Error ? err.message : 'Conversion failed',
        }
        setBatchItems([...updatedItems])
      }
    }

    setTimeout(() => setStage('review'), 400)
  }

  // ── Handlers — save / download ─────────────────────────────────────────────

  const handleSaveToVault = async () => {
    if (!vaultPath) { setSaveStatus('error'); return }
    setSaveStatus('saving')
    const filename = `${safeName(meta.title)}.md`
    try {
      await window.vaultAPI?.saveFile(`${vaultPath}/${filename}`, finalMd)
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2500)
    } catch {
      setSaveStatus('error')
    }
  }

  const handleDownload = () => {
    downloadMd(finalMd, meta.title)
  }

  const handleBatchDownloadOne = (item: BatchItem) => {
    if (item.mdResult) downloadMd(item.mdResult, item.file.name.replace(/\.[^.]+$/, ''))
  }

  const handleBatchDownloadAll = () => {
    batchItems
      .filter(item => item.status === 'done' && item.mdResult)
      .forEach(item => handleBatchDownloadOne(item))
  }

  const handleReset = () => {
    setStage('input')
    setStreamedText('')
    setKeywords([])
    setFinalMd('')
    setSaveStatus('idle')
    setStep2Status({ analyze: 'pending', keywords: 'pending', structure: 'pending' })
    setProcessError('')
    setBatchItems([])
    setBatchCurrentIdx(0)
    // Keep folderFiles/selectedIndices so user doesn't have to re-pick the folder
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  const canStartSingle = content.trim().length > 0
  const canStartBatch = selectedIndices.size > 0

  const batchDoneCount = batchItems.filter(i => i.status === 'done').length

  return (
    <div className="flex flex-col h-full">

      {/* ── Tab bar ── */}
      {!onBack && (
        <div
          className="flex items-center shrink-0 gap-1 px-2"
          style={{ height: 34, borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)' }}
        >
          <button
            onClick={() => setCenterTab('graph')}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors hover:bg-[var(--color-bg-hover)]"
            style={{ color: 'var(--color-text-muted)' }}
            title="Back to graph"
          >
            <ChevronLeft size={12} />
            Graph
          </button>
          <span
            className="text-xs font-medium px-2"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            ✏️ MD Conversion Editor
          </span>
        </div>
      )}

      {/* ── Step indicator ── */}
      <StepIndicator stage={stage} step2Status={step2Status} />

      {/* ── Content area ── */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4">

        {/* ════════════════════════════════════════════════════════════════════
            STAGE 1: Input
        ════════════════════════════════════════════════════════════════════ */}
        {stage === 'input' && (
          <div className="flex flex-col gap-4 max-w-2xl mx-auto">

            {/* Input tabs */}
            <div className="flex gap-1">
              {([
                { id: 'paste',      label: 'Paste',        icon: null },
                { id: 'upload',     label: 'Upload File',  icon: null },
                { id: 'folder',     label: 'Batch Folder', icon: <Folder size={11} /> },
                { id: 'confluence', label: 'Confluence', icon: <Globe size={11} /> },
              ] as const).map(t => (
                <button
                  key={t.id}
                  onClick={() => setInputTab(t.id)}
                  className={cn('px-3 py-1.5 text-xs rounded transition-colors flex items-center gap-1.5', inputTab === t.id && 'font-medium')}
                  style={{
                    background: inputTab === t.id ? 'var(--color-bg-hover)' : 'transparent',
                    color: inputTab === t.id ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                    border: '1px solid var(--color-border)',
                  }}
                >
                  {t.icon}
                  {t.label}
                </button>
              ))}
            </div>

            {/* ── Paste ──────────────────────────────────────────────────── */}
            {inputTab === 'paste' && (
              <textarea
                value={content}
                onChange={e => setContent(e.target.value)}
                placeholder="Paste your source text here..."
                rows={10}
                className="w-full resize-none rounded-lg px-3 py-2 text-sm"
                style={{
                  background: 'var(--color-bg-secondary)',
                  color: 'var(--color-text-primary)',
                  border: '1px solid var(--color-border)',
                  outline: 'none',
                  lineHeight: 1.6,
                }}
              />
            )}

            {/* ── File Upload ───────────────────────────────────────────── */}
            {inputTab === 'upload' && (
              <div
                className="flex flex-col items-center justify-center gap-3 rounded-lg p-8 cursor-pointer transition-colors hover:bg-[var(--color-bg-hover)]"
                style={{ border: '1.5px dashed var(--color-border)' }}
                onClick={() => fileInputRef.current?.click()}
                onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFileSelect(f) }}
                onDragOver={e => e.preventDefault()}
              >
                <Upload size={24} style={{ color: 'var(--color-text-muted)' }} />
                <div className="text-center">
                  <div className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                    Drag a file here or click to upload
                  </div>
                  <div className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                    .txt .md .html .docx .pdf
                  </div>
                </div>
                {uploadFileName && (
                  <div className="text-xs font-medium" style={{ color: 'var(--color-accent)' }}>
                    ✓ {uploadFileName}
                  </div>
                )}
                {uploadError && (
                  <div className="text-xs" style={{ color: '#e74c3c' }}>{uploadError}</div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.md,.html,.htm,.docx,.pdf"
                  className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleFileSelect(f) }}
                />
              </div>
            )}

            {/* ── Batch Folder ───────────────────────────────────────────── */}
            {inputTab === 'folder' && (
              <div className="flex flex-col gap-3">
                {/* Folder picker trigger */}
                <div
                  className="flex flex-col items-center justify-center gap-3 rounded-lg p-6 cursor-pointer transition-colors hover:bg-[var(--color-bg-hover)]"
                  style={{ border: '1.5px dashed var(--color-border)' }}
                  onClick={() => folderInputRef.current?.click()}
                  onDrop={e => {
                    e.preventDefault()
                    // webkitdirectory doesn't fire drop — just prompt click
                    folderInputRef.current?.click()
                  }}
                  onDragOver={e => e.preventDefault()}
                >
                  <Folder size={24} style={{ color: 'var(--color-text-muted)' }} />
                  <div className="text-center">
                    <div className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                      Click to select a folder
                    </div>
                    <div className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                      Supported formats: .txt .md .html .docx .pdf
                    </div>
                  </div>
                  {folderFiles.length > 0 && (
                    <div className="text-xs font-medium" style={{ color: 'var(--color-accent)' }}>
                      ✓ {folderFiles.length} file{folderFiles.length !== 1 ? 's' : ''} found
                    </div>
                  )}
                  {/* webkitdirectory set imperatively in useEffect */}
                  <input
                    ref={folderInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={handleFolderSelect}
                  />
                </div>

                {/* File list */}
                {folderFiles.length > 0 && (
                  <div
                    className="rounded-lg overflow-hidden"
                    style={{ border: '1px solid var(--color-border)' }}
                  >
                    {/* Header */}
                    <div
                      className="flex items-center justify-between px-3 py-2"
                      style={{ background: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border)' }}
                    >
                      <label className="flex items-center gap-2 cursor-pointer text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                        <input
                          type="checkbox"
                          checked={selectedIndices.size === folderFiles.length}
                          onChange={toggleAll}
                          className="cursor-pointer"
                        />
                        Select all ({selectedIndices.size}/{folderFiles.length} selected)
                      </label>
                      <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                        Choose files to convert
                      </span>
                    </div>

                    {/* File rows */}
                    <div className="max-h-48 overflow-y-auto">
                      {folderFiles.map((file, idx) => {
                        const ext = fileExt(file.name)
                        const isChecked = selectedIndices.has(idx)
                        return (
                          <label
                            key={idx}
                            className="flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors hover:bg-[var(--color-bg-hover)]"
                            style={{
                              borderBottom: idx < folderFiles.length - 1 ? '1px solid var(--color-border)' : undefined,
                              background: isChecked ? undefined : 'transparent',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleFile(idx)}
                              className="cursor-pointer shrink-0"
                            />
                            {/* Ext badge */}
                            <span
                              className="text-[9px] px-1.5 py-0.5 rounded font-mono shrink-0"
                              style={{
                                background: 'var(--color-bg-hover)',
                                color: 'var(--color-accent)',
                                border: '1px solid var(--color-border)',
                              }}
                            >
                              {ext}
                            </span>
                            {/* Filename — show relative path if available */}
                            <span
                              className="text-xs truncate"
                              style={{ color: isChecked ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }}
                              title={file.webkitRelativePath || file.name}
                            >
                              {file.webkitRelativePath || file.name}
                            </span>
                            {/* Size */}
                            <span className="text-[10px] shrink-0 ml-auto" style={{ color: 'var(--color-text-muted)' }}>
                              {(file.size / 1024).toFixed(1)}KB
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Confluence Import ─────────────────────────────────────── */}
            {inputTab === 'confluence' && <ConfluenceImporter />}

            {/* ── Metadata form (paste / upload / folder only) ───────────── */}
            {inputTab !== 'confluence' && (<>
            <div className="grid grid-cols-2 gap-3">
              {/* Title — only for single-file modes */}
              {inputTab !== 'folder' && (
                <div className="col-span-2">
                  <label className="text-xs mb-1 block" style={{ color: 'var(--color-text-muted)' }}>Title</label>
                  <input
                    value={meta.title}
                    onChange={e => setMeta(m => ({ ...m, title: e.target.value }))}
                    placeholder="Document title (Obsidian filename)"
                    className="w-full px-3 py-1.5 text-sm rounded"
                    style={{
                      background: 'var(--color-bg-secondary)',
                      color: 'var(--color-text-primary)',
                      border: '1px solid var(--color-border)',
                      outline: 'none',
                    }}
                  />
                </div>
              )}
              {inputTab === 'folder' && (
                <div className="col-span-2">
                  <div
                    className="text-xs px-3 py-2 rounded"
                    style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}
                  >
                    📝 The filename will be used as the title for each document
                  </div>
                </div>
              )}
              <div>
                <label className="text-xs mb-1 block" style={{ color: 'var(--color-text-muted)' }}>Speaker</label>
                <select
                  value={meta.speaker}
                  onChange={e => setMeta(m => ({ ...m, speaker: e.target.value }))}
                  className="w-full px-3 py-1.5 text-sm rounded"
                  style={{
                    background: 'var(--color-bg-secondary)',
                    color: 'var(--color-text-primary)',
                    border: '1px solid var(--color-border)',
                    outline: 'none',
                  }}
                >
                  {speakers.map(s => (
                    <option key={s.id} value={s.id}>{s.label} ({s.id})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: 'var(--color-text-muted)' }}>Date</label>
                <input
                  type="date"
                  value={meta.date}
                  onChange={e => setMeta(m => ({ ...m, date: e.target.value }))}
                  className="w-full px-3 py-1.5 text-sm rounded"
                  style={{
                    background: 'var(--color-bg-secondary)',
                    color: 'var(--color-text-primary)',
                    border: '1px solid var(--color-border)',
                    outline: 'none',
                    colorScheme: 'dark',
                  }}
                />
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: 'var(--color-text-muted)' }}>Type</label>
                <select
                  value={meta.type}
                  onChange={e => setMeta(m => ({ ...m, type: e.target.value as ConversionType }))}
                  className="w-full px-3 py-1.5 text-sm rounded"
                  style={{
                    background: 'var(--color-bg-secondary)',
                    color: 'var(--color-text-primary)',
                    border: '1px solid var(--color-border)',
                    outline: 'none',
                  }}
                >
                  {DOC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
            </div>

            {/* ── Start button ─────────────────────────────────────────── */}
            <div className="flex justify-end">
              {isBatchMode ? (
                <button
                  onClick={handleBatchStart}
                  disabled={!canStartBatch}
                  className="flex items-center gap-2 px-5 py-2 rounded text-sm font-medium transition-colors disabled:opacity-40"
                  style={{
                    background: canStartBatch ? 'var(--color-accent)' : 'var(--color-bg-surface)',
                    color: canStartBatch ? '#fff' : 'var(--color-text-muted)',
                  }}
                >
                  <Folder size={14} />
                  Batch convert {selectedIndices.size} file{selectedIndices.size !== 1 ? 's' : ''}
                  <ArrowRight size={14} />
                </button>
              ) : (
                <button
                  onClick={handleStartConversion}
                  disabled={!canStartSingle}
                  className="flex items-center gap-2 px-5 py-2 rounded text-sm font-medium transition-colors disabled:opacity-40"
                  style={{
                    background: canStartSingle ? 'var(--color-accent)' : 'var(--color-bg-surface)',
                    color: canStartSingle ? '#fff' : 'var(--color-text-muted)',
                  }}
                >
                  Start AI Conversion
                  <ArrowRight size={14} />
                </button>
              )}
            </div>
            </>)}
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════════
            STAGE 2: AI Processing
        ════════════════════════════════════════════════════════════════════ */}
        {stage === 'processing' && (
          <div className="flex flex-col gap-4 max-w-2xl mx-auto">

            {/* Batch progress header */}
            {isBatchMode && batchItems.length > 0 && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                    Converting file {batchCurrentIdx + 1} / {batchItems.length}…
                  </div>
                  <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {batchItems[batchCurrentIdx]?.file.name}
                  </div>
                </div>
                {/* Progress bar */}
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-bg-secondary)' }}>
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${((batchCurrentIdx) / batchItems.length) * 100}%`,
                      background: 'var(--color-accent)',
                    }}
                  />
                </div>
                {/* File status list */}
                <div
                  className="rounded-lg overflow-hidden"
                  style={{ border: '1px solid var(--color-border)' }}
                >
                  {batchItems.map((item, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 px-3 py-1.5 text-xs"
                      style={{
                        borderBottom: i < batchItems.length - 1 ? '1px solid var(--color-border)' : undefined,
                        background: i === batchCurrentIdx ? 'var(--color-bg-hover)' : undefined,
                        color: item.status === 'done'
                          ? 'var(--color-accent)'
                          : item.status === 'error'
                          ? '#e74c3c'
                          : item.status === 'running'
                          ? 'var(--color-text-primary)'
                          : 'var(--color-text-muted)',
                      }}
                    >
                      <span>
                        {item.status === 'done' ? '✓' : item.status === 'error' ? '✗' : item.status === 'running' ? '⟳' : '○'}
                      </span>
                      <span className="truncate">{item.file.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Single-file processing header */}
            {!isBatchMode && (
              <div className="text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                Claude is analyzing the document...
              </div>
            )}

            {/* Streaming output */}
            <div
              className="rounded-lg px-3 py-3 text-xs font-mono overflow-y-auto"
              style={{
                background: 'var(--color-bg-secondary)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-secondary)',
                minHeight: isBatchMode ? 120 : 240,
                maxHeight: isBatchMode ? 200 : 480,
                lineHeight: 1.7,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {streamedText || (
                <span style={{ color: 'var(--color-text-muted)' }}>Waiting...</span>
              )}
              <span
                style={{
                  display: 'inline-block',
                  width: '0.5em',
                  height: '1em',
                  background: 'var(--color-accent)',
                  marginLeft: 2,
                  verticalAlign: 'middle',
                  animation: 'blink 1s step-end infinite',
                  opacity: 0.8,
                }}
                aria-hidden="true"
              />
            </div>

            {processError && (
              <div
                className="text-xs px-3 py-2 rounded"
                style={{ background: '#3d1a1a', color: '#e74c3c', border: '1px solid #5a2020' }}
              >
                Error: {processError}
                <button onClick={handleReset} className="ml-3 underline" style={{ color: 'var(--color-accent)' }}>
                  Start over
                </button>
              </div>
            )}
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════════
            STAGE 3: Review & Approve
        ════════════════════════════════════════════════════════════════════ */}
        {stage === 'review' && (
          <div className="flex flex-col gap-4 max-w-2xl mx-auto">

            {/* ── Batch review ───────────────────────────────────────────── */}
            {isBatchMode ? (
              <>
                {/* Summary */}
                <div
                  className="flex items-center justify-between px-4 py-3 rounded-lg"
                  style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
                >
                  <div>
                    <div className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
                      Batch conversion complete
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                      Success: {batchDoneCount} / {batchItems.length} total
                    </div>
                  </div>
                  <button
                    onClick={handleBatchDownloadAll}
                    disabled={batchDoneCount === 0}
                    className="flex items-center gap-1.5 px-4 py-1.5 text-xs rounded font-medium transition-colors disabled:opacity-40"
                    style={{ background: 'var(--color-accent)', color: '#fff' }}
                  >
                    <Download size={12} />
                    Download all ({batchDoneCount})
                  </button>
                </div>

                {/* Per-file results */}
                <div
                  className="rounded-lg overflow-hidden"
                  style={{ border: '1px solid var(--color-border)' }}
                >
                  {batchItems.map((item, i) => (
                    <div
                      key={i}
                      className="flex flex-col gap-1.5 px-3 py-2.5"
                      style={{
                        borderBottom: i < batchItems.length - 1 ? '1px solid var(--color-border)' : undefined,
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="text-xs font-medium"
                          style={{
                            color: item.status === 'done' ? 'var(--color-accent)' : item.status === 'error' ? '#e74c3c' : 'var(--color-text-muted)',
                          }}
                        >
                          {item.status === 'done' ? '✓' : '✗'}
                        </span>
                        <span className="text-xs truncate flex-1" style={{ color: 'var(--color-text-primary)' }}>
                          {item.file.name}
                        </span>
                        {item.status === 'done' && (
                          <button
                            onClick={() => handleBatchDownloadOne(item)}
                            className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors hover:bg-[var(--color-bg-hover)] shrink-0"
                            style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
                          >
                            <Download size={10} />
                            .md
                          </button>
                        )}
                      </div>
                      {item.status === 'error' && (
                        <div className="text-[10px] pl-4" style={{ color: '#e74c3c' }}>
                          {item.error}
                        </div>
                      )}
                      {item.status === 'done' && item.keywords && item.keywords.length > 0 && (
                        <div className="flex flex-wrap gap-1 pl-4">
                          {item.keywords.slice(0, 4).map(kw => (
                            <span
                              key={kw}
                              className="text-[9px] px-1.5 py-0.5 rounded-full"
                              style={{ background: 'var(--color-bg-hover)', color: 'var(--color-accent)', border: '1px solid var(--color-accent)' }}
                            >
                              {kw}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="flex justify-end">
                  <button
                    onClick={handleReset}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded transition-colors hover:bg-[var(--color-bg-hover)]"
                    style={{ color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}
                  >
                    <RotateCcw size={12} />
                    Convert again
                  </button>
                </div>
              </>
            ) : (
              /* ── Single file review ───────────────────────────────────── */
              <>
                {/* Keyword chips */}
                {keywords.length > 0 && (
                  <div>
                    <div className="text-xs mb-2" style={{ color: 'var(--color-text-muted)' }}>
                      Extracted keywords
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {keywords.map(kw => (
                        <span
                          key={kw}
                          className="text-xs px-2 py-0.5 rounded-full"
                          style={{
                            background: 'var(--color-bg-hover)',
                            color: 'var(--color-accent)',
                            border: '1px solid var(--color-accent)',
                          }}
                        >
                          {kw}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Editable MD textarea */}
                <div>
                  <div className="text-xs mb-2" style={{ color: 'var(--color-text-muted)' }}>
                    Generated markdown (editable)
                  </div>
                  <textarea
                    value={finalMd}
                    onChange={e => setFinalMd(e.target.value)}
                    rows={20}
                    className="w-full resize-none rounded-lg px-3 py-3 text-xs font-mono"
                    style={{
                      background: 'var(--color-bg-secondary)',
                      color: 'var(--color-text-primary)',
                      border: '1px solid var(--color-border)',
                      outline: 'none',
                      lineHeight: 1.7,
                    }}
                    spellCheck={false}
                  />
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={handleReset}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded transition-colors hover:bg-[var(--color-bg-hover)]"
                    style={{ color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}
                  >
                    <RotateCcw size={12} />
                    Edit again
                  </button>
                  <div className="flex-1" />
                  <button
                    onClick={handleSaveToVault}
                    disabled={!vaultPath || saveStatus === 'saving'}
                    className="flex items-center gap-1.5 px-4 py-1.5 text-xs rounded font-medium transition-colors disabled:opacity-40"
                    style={{
                      background: saveStatus === 'saved' ? '#2ecc71' : 'var(--color-accent)',
                      color: '#fff',
                    }}
                    title={!vaultPath ? 'Please select a vault first (⚙️ Settings)' : undefined}
                  >
                    {saveStatus === 'saving' ? 'Saving...'
                      : saveStatus === 'saved' ? <><Check size={12} /> Saved</>
                      : saveStatus === 'error' ? 'Save failed'
                      : <><Save size={12} /> Approve &amp; Save</>
                    }
                  </button>
                  <button
                    onClick={handleDownload}
                    className="flex items-center gap-1.5 px-4 py-1.5 text-xs rounded font-medium transition-colors hover:bg-[var(--color-bg-hover)]"
                    style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
                  >
                    <Download size={12} />
                    Download .md
                  </button>
                </div>

                {saveStatus === 'error' && (
                  <div className="text-xs" style={{ color: '#e74c3c' }}>
                    Save failed — please select a vault first (⚙️ Settings → Select Vault)
                  </div>
                )}
              </>
            )}
          </div>
        )}

      </div>
    </div>
  )
}
