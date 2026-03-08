/**
 * ConfluenceTab — Import Confluence pages into the vault.
 *
 * Pipeline:
 *   1. Fetch pages (date-filtered, hard min 2025-01-01)
 *   2. Convert HTML → Markdown (confluenceToMarkdown.ts)
 *   3. Download image attachments per page
 *   4. Save MD files to vault
 *   5. Run Python refinement scripts (audit_and_fix, enhance_wikilinks, gen_index)
 *   6. Claude Haiku per-file quality review
 */

import { useState, useRef } from 'react'
import { useSettingsStore, getApiKey } from '@/stores/settingsStore'
import { useVaultStore } from '@/stores/vaultStore'
import { pageToVaultMarkdown, toStem, type ConfluencePage, type VaultPage } from '@/lib/confluenceToMarkdown'
import { streamCompletion } from '@/services/providers/anthropic'

// ── Type-safe preload API ──────────────────────────────────────────────────────

declare const confluenceAPI: {
  fetchPages: (config: {
    baseUrl: string; email: string; apiToken: string; spaceKey: string
    dateFrom?: string; dateTo?: string
    authType?: string; bypassSSL?: boolean
  }) => Promise<ConfluencePage[]>
  savePages: (
    vaultPath: string,
    targetFolder: string,
    pages: { filename: string; content: string }[],
  ) => Promise<{ saved: number; targetDir: string; activeDir: string; files: string[] }>
  downloadAttachments: (
    config: { baseUrl: string; authType: string; email: string; apiToken: string; bypassSSL?: boolean },
    vaultPath: string,
    targetFolder: string,
    pageId: string,
  ) => Promise<{ downloaded: number; files: string[] }>
  runScript: (
    scriptName: string,
    args: string[],
  ) => Promise<{ stdout: string; stderr: string; exitCode: number }>
  rollback: (
    files: string[],
    dirs: string[],
  ) => Promise<{ deleted: number; errors: string[] }>
  readAppFile: (relativePath: string) => Promise<string | null>
}

// ── URL parser ────────────────────────────────────────────────────────────────

function parseConfluenceUrl(raw: string): {
  baseUrl: string; spaceKey: string; authType: 'cloud' | 'server_pat' | 'server_basic'
} | null {
  try {
    const url = new URL(raw.trim())
    const base = `${url.protocol}//${url.host}`
    const isCloud = url.hostname.endsWith('atlassian.net')
    const authType = isCloud ? 'cloud' : 'server_pat'
    // /display/{SPACE_KEY}/… (Server/DC classic URL)
    let m = url.pathname.match(/\/display\/([A-Z0-9_-]+)/i)
    if (m) return { baseUrl: base, spaceKey: m[1].toUpperCase(), authType }
    // /wiki/spaces/{SPACE_KEY}/… (Cloud & newer Server)
    m = url.pathname.match(/\/wiki\/spaces\/([A-Z0-9_-]+)/i)
    if (m) return { baseUrl: base, spaceKey: m[1].toUpperCase(), authType }
    // /wiki/display/{SPACE_KEY}/… (some Server installations)
    m = url.pathname.match(/\/wiki\/display\/([A-Z0-9_-]+)/i)
    if (m) return { baseUrl: base, spaceKey: m[1].toUpperCase(), authType }
    return null
  } catch { return null }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const HARD_MIN_DATE = '2025-01-01'
const HAIKU_MODEL = 'claude-haiku-4-5-20251001'
const PYTHON_SCRIPTS = ['audit_and_fix.py', 'enhance_wikilinks.py', 'gen_index.py']

function getDateStamp(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function loadManualContext(): Promise<string> {
  try {
    const api = (window as any).confluenceAPI
    if (!api?.readAppFile) return ''
    const text = await api.readAppFile('manual/Graph_RAG_Data_Refinement_Manual_v3.0.md')
    return text ? text.slice(0, 3000) : ''  // Truncated to 3K to avoid rate limit
  } catch { return '' }
}

interface FileIssue { filename: string; issues: string; archive?: boolean }

const ARCHIVE_CRITERIA = `
## Criteria for recommending archive(.archive/) move (Manual 3.2)
If any of the following apply, start the first line with "🗄 Archive recommended:":
- Spec/design documents older than 6 months where changes are clearly already applied
- Discarded proposals or cancelled feature documents
- Legacy architecture documents prior to refactoring/redesign
- Individual weekly/monthly work reports where a consolidated version exists separately
If none apply, no archive mention needed.
`.trim()

async function extractKeywords(pages: VaultPage[], apiKey: string): Promise<string[]> {
  const sample = pages.slice(0, 12)
    .map(p => `[${p.filename}]\n${p.content.slice(0, 500)}`)
    .join('\n\n---\n\n')
  const sysPrompt = [
    'Extract recurring or core domain keywords from the documents below.',
    'Focus on technical terms, system names, feature names, and project names — up to 20.',
    'Output as JSON array only: ["keyword1", "keyword2", ...]',
  ].join('\n')
  let result = ''
  try {
    await streamCompletion(apiKey, HAIKU_MODEL, sysPrompt,
      [{ role: 'user', content: `Document sample:\n\n${sample}` }],
      (chunk: string) => { result += chunk })
    const m = result.match(/\[[\s\S]*?\]/)
    if (m) {
      const parsed = JSON.parse(m[0])
      if (Array.isArray(parsed)) return parsed.filter(k => typeof k === 'string').slice(0, 30)
    }
  } catch { /* ignore */ }
  return []
}

async function fixFileWithClaude(
  content: string,
  issues: string,
  apiKey: string,
): Promise<string | null> {
  const sysPrompt = [
    'You are a markdown file correction expert.',
    'Fix only the issues listed in the review results and output the complete corrected file as raw markdown.',
    'Do not wrap in code blocks (```), output the file contents only without any explanation.',
  ].join('\n')
  const userMsg = `## Review Results (items requiring correction)\n${issues}\n\n## Current file contents\n${content.slice(0, 6000)}`
  let result = ''
  try {
    await streamCompletion(apiKey, HAIKU_MODEL, sysPrompt, [{ role: 'user', content: userMsg }],
      (chunk: string) => { result += chunk })
    return result.trim() || null
  } catch { return null }
}

// Calculate body length after frontmatter (based on --- delimiter)
function getBodyLength(content: string): number {
  const secondDash = content.indexOf('\n---', content.indexOf('---') + 3)
  return secondDash > 0 ? content.slice(secondDash + 4).trim().length : content.length
}

async function reviewFileWithClaude(
  page: VaultPage,
  manualCtx: string,
  apiKey: string,
): Promise<FileIssue> {
  // Body < 600 chars (total file ~1KB) → treat as stub, immediately recommend archive without Claude
  if (getBodyLength(page.content) < 600) {
    return {
      filename: page.filename,
      issues: '🗄 Archive recommended: body content under 1KB — treated as stub/empty page (Claude review skipped)',
      archive: true,
    }
  }

  const sysPrompt = manualCtx
    ? `You are a Graph RAG data quality reviewer.\nBelow is the refinement manual:\n\n${manualCtx}\n\n${ARCHIVE_CRITERIA}\n\nReview the markdown document against the manual criteria and briefly list any issues. If no issues, output "✅ No issues".`
    : `You are a Graph RAG data quality reviewer.\n${ARCHIVE_CRITERIA}\n\nFind structural issues in the markdown document (missing frontmatter, no headings, empty sections, etc.) and briefly list them. If no issues, output "✅ No issues".`

  const userMsg = `File: ${page.filename}\n\n${page.content.slice(0, 4000)}`

  let result = ''
  try {
    await streamCompletion(apiKey, HAIKU_MODEL, sysPrompt, [{ role: 'user', content: userMsg }],
      (chunk: string) => { result += chunk })
  } catch (e) {
    result = `Review error: ${e instanceof Error ? e.message : String(e)}`
  }
  const trimmed = result.trim() || '✅ No issues'
  return { filename: page.filename, issues: trimmed, archive: trimmed.startsWith('🗄') }
}

// ── FieldRow ──────────────────────────────────────────────────────────────────

function FieldRow({
  label, value, onChange, placeholder, type = 'text', minDate,
}: {
  label: string; value: string; onChange: (v: string) => void
  placeholder?: string; type?: string; minDate?: string
}) {
  const [visible, setVisible] = useState(false)
  const isPassword = type === 'password'
  return (
    <div className="flex items-center gap-2">
      <div className="shrink-0 text-[11px] font-medium" style={{ color: 'var(--color-text-secondary)', minWidth: 100 }}>
        {label}
      </div>
      <div className="flex-1 relative">
        <input
          type={isPassword ? (visible ? 'text' : 'password') : type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          min={minDate}
          autoComplete="off"
          spellCheck={false}
          className="w-full text-xs rounded px-2 py-1.5 font-mono"
          style={{
            background: 'var(--color-bg-surface)',
            color: 'var(--color-text-primary)',
            border: '1px solid var(--color-border)',
            outline: 'none',
            paddingRight: isPassword ? 40 : undefined,
          }}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setVisible(v => !v)}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] px-1"
            style={{ color: 'var(--color-text-muted)' }}
            tabIndex={-1}
          >
            {visible ? 'Hide' : 'Show'}
          </button>
        )}
      </div>
    </div>
  )
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface ConvertedFile {
  filename: string
  title: string
  type: string
  date: string
  sizeKb: number
}

type ImportStatus =
  | 'idle' | 'fetching' | 'converting' | 'images'
  | 'saving' | 'scripts' | 'reviewing' | 'done' | 'error'

const STATUS_LABEL: Partial<Record<ImportStatus, string>> = {
  fetching:   '1/6 Fetching pages…',
  converting: '2/6 Converting to markdown…',
  images:     '3/6 Downloading images…',
  saving:     '4/6 Saving to vault…',
  scripts:    '5/6 Running Python scripts…',
  reviewing:  '6/6 Claude Haiku quality review…',
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ConfluenceTab() {
  const { confluenceConfig, setConfluenceConfig } = useSettingsStore()
  const vaultPath = useVaultStore(s => s.vaultPath)

  const [status, setStatus] = useState<ImportStatus>('idle')
  const [log, setLog] = useState<string[]>([])
  const [reviews, setReviews] = useState<FileIssue[]>([])
  const [convertedFiles, setConvertedFiles] = useState<ConvertedFile[]>([])
  const [pageCount, setPageCount] = useState(0)
  const [reviewProgress, setReviewProgress] = useState({ done: 0, total: 0 })
  const [urlInput, setUrlInput] = useState('')
  const [urlError, setUrlError] = useState('')
  const [skipImages, setSkipImages] = useState(false)
  const [resultTab, setResultTab] = useState<'files' | 'review' | 'keywords'>('files')
  // Rollback tracking
  const [savedFilePaths, setSavedFilePaths] = useState<string[]>([])
  const [savedDirs, setSavedDirs] = useState<string[]>([])
  const [rollbackStatus, setRollbackStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const cancelledRef = useRef(false)
  const activeDirRef = useRef('')   // set after save step; e.g. vault/active_20260304
  const archiveDirRef = useRef('')  // e.g. vault/archive_20260304

  const [autoFixStatus, setAutoFixStatus] = useState<'idle' | 'running' | 'done'>('idle')
  const [fixProgress, setFixProgress] = useState({ done: 0, total: 0 })
  const [fixedFiles, setFixedFiles] = useState<{ filename: string; ok: boolean }[]>([])
  const [archiveMoveStatus, setArchiveMoveStatus] = useState<'idle' | 'running' | 'done'>('idle')
  const [movedToArchive, setMovedToArchive] = useState(0)
  const [extractedKeywords, setExtractedKeywords] = useState<string[]>([])
  const [keywordSaveStatus, setKeywordSaveStatus] = useState<'idle' | 'saving' | 'done'>('idle')

  const addLog = (msg: string) => setLog(prev => [...prev, msg])

  const cfg = confluenceConfig
  const hasAnthropicKey = Boolean(getApiKey('anthropic'))
  const dateWarn = cfg.dateFrom && cfg.dateFrom < HARD_MIN_DATE

  const isRunning = !['idle', 'done', 'error'].includes(status)

  const canImport =
    typeof confluenceAPI !== 'undefined' &&
    Boolean(cfg.baseUrl && cfg.email && cfg.apiToken && cfg.spaceKey && vaultPath)

  const handleCancel = () => {
    cancelledRef.current = true
    addLog('⏹ Stop requested — will halt after current step completes…')
  }

  const handleImport = async () => {
    if (!canImport || isRunning) return
    cancelledRef.current = false

    setStatus('fetching')
    setLog([])
    setReviews([])
    setConvertedFiles([])
    setSavedFilePaths([])
    setSavedDirs([])
    setRollbackStatus('idle')
    setPageCount(0)
    setReviewProgress({ done: 0, total: 0 })
    setAutoFixStatus('idle')
    setFixedFiles([])
    setArchiveMoveStatus('idle')
    setMovedToArchive(0)
    setExtractedKeywords([])
    setKeywordSaveStatus('idle')

    const stamp = getDateStamp()
    const targetFolder = `active_${stamp}`  // e.g. active_20260304
    archiveDirRef.current = vaultPath + `/archive_${stamp}`

    try {
      // ── 1. Fetch pages ───────────────────────────────────────────────────────
      const effectiveDateFrom = (!cfg.dateFrom || cfg.dateFrom < HARD_MIN_DATE)
        ? HARD_MIN_DATE : cfg.dateFrom

      addLog(`📡 Confluence connection: ${cfg.baseUrl}`)
      addLog(`   Space: ${cfg.spaceKey} | Period: ${effectiveDateFrom} ~ ${cfg.dateTo || 'present'}`)
      if (cfg.dateFrom && cfg.dateFrom < HARD_MIN_DATE)
        addLog(`   ⚠ Start date is before ${HARD_MIN_DATE} → automatically adjusted to ${HARD_MIN_DATE}`)

      const pages: ConfluencePage[] = await confluenceAPI.fetchPages({
        baseUrl: cfg.baseUrl,
        email: cfg.email,
        apiToken: cfg.apiToken,
        spaceKey: cfg.spaceKey,
        dateFrom: effectiveDateFrom,
        dateTo: cfg.dateTo || undefined,
        authType: cfg.authType,
        bypassSSL: cfg.bypassSSL,
      })

      if (pages.length === 0) {
        addLog('ℹ No pages to import (check date range or space key)')
        setStatus('done')
        return
      }
      addLog(`✅ ${pages.length} page${pages.length !== 1 ? 's' : ''} received`)
      setPageCount(pages.length)
      if (cancelledRef.current) { addLog('⏹ Stopped'); setStatus('error'); return }

      // ── 2. Convert HTML → Markdown ───────────────────────────────────────────
      setStatus('converting')
      addLog('🔄 Converting to markdown…')
      const titleStemMap = new Map<string, string>(pages.map(p => [p.title, toStem(p.title, p.id)]))
      const pagesWithUrl = pages.map(p => ({ ...p, _baseUrl: cfg.baseUrl }))
      const converted: VaultPage[] = []
      let stubCount = 0
      for (const page of pagesWithUrl) {
        const vp = pageToVaultMarkdown(page, titleStemMap)
        converted.push(vp)
        const sizeKb = Math.round(new TextEncoder().encode(vp.content).length / 102.4) / 10
        const isStub = getBodyLength(vp.content) < 600
        if (isStub) stubCount++
        addLog(`   ${isStub ? '⚠' : '✓'} ${vp.filename}  (${sizeKb}K${isStub ? ' — stub' : ''})`)
      }
      addLog(`✅ Conversion complete: ${converted.length} file${converted.length !== 1 ? 's' : ''} (${stubCount} stub${stubCount !== 1 ? 's' : ''} included)`)
      if (cancelledRef.current) { addLog('⏹ Stopped'); setStatus('error'); return }

      // Record converted file metadata for display
      setConvertedFiles(converted.map(p => {
        const fmType  = p.content.match(/^type:\s*(.+)$/m)?.[1]?.trim() ?? ''
        const fmDate  = p.content.match(/^date:\s*(.+)$/m)?.[1]?.trim() ?? ''
        const fmTitle = p.content.match(/^title:\s*(.+)$/m)?.[1]?.trim() ?? p.stem
        const sizeKb  = Math.round(new TextEncoder().encode(p.content).length / 102.4) / 10
        return { filename: p.filename, title: fmTitle, type: fmType, date: fmDate, sizeKb }
      }))

      // ── 3. Download image attachments ────────────────────────────────────────
      setStatus('images')
      let totalImages = 0
      const attachmentFilePaths: string[] = []
      if (!skipImages) {
        addLog(`🖼 Downloading image attachments (${pages.length} page${pages.length !== 1 ? 's' : ''})…`)
        for (const page of pages) {
          try {
            const r = await confluenceAPI.downloadAttachments(
              { baseUrl: cfg.baseUrl, authType: cfg.authType, email: cfg.email, apiToken: cfg.apiToken, bypassSSL: cfg.bypassSSL },
              vaultPath!,
              targetFolder,
              page.id,
            )
            totalImages += r.downloaded
            attachmentFilePaths.push(...(r.files ?? []))
          } catch { /* Ignore image failures and continue */ }
        }
        addLog(`✅ ${totalImages} image${totalImages !== 1 ? 's' : ''} downloaded`)
      } else {
        addLog('⏭ Image download skipped')
      }
      if (cancelledRef.current) { addLog('⏹ Stopped'); setStatus('error'); return }

      // ── 4. Save MD files ─────────────────────────────────────────────────────
      setStatus('saving')
      addLog(`💾 Saving to vault: ${vaultPath}/${targetFolder}/  (archive→ archive_${stamp})`)
      const saveResult = await confluenceAPI.savePages(
        vaultPath!,
        targetFolder,
        converted.map(p => ({ filename: p.filename, content: p.content })),
      )
      addLog(`✅ ${saveResult.saved} file${saveResult.saved !== 1 ? 's' : ''} saved → ${saveResult.activeDir}`)
      activeDirRef.current = saveResult.activeDir
      // Track all written files (MD + images) for rollback
      setSavedFilePaths([...(saveResult.files ?? []), ...attachmentFilePaths])
      setSavedDirs([saveResult.targetDir])
      if (cancelledRef.current) { addLog('⏹ Stopped (save completed, rollback available)'); setStatus('done'); return }

      // ── 5. Python refinement scripts ─────────────────────────────────────────
      setStatus('scripts')
      addLog('🐍 Running Python refinement scripts…')
      // Scripts: audit_and_fix.py <active_dir> --vault <vault_root>
      const scriptArgs = [saveResult.activeDir, '--vault', vaultPath!]
      for (const script of PYTHON_SCRIPTS) {
        try {
          addLog(`   Running: ${script}`)
          const r = await confluenceAPI.runScript(script, scriptArgs)
          if (r.exitCode === 0) {
            const lines = r.stdout.trim().split('\n').slice(0, 5)
            lines.forEach(l => l && addLog(`     ${l}`))
          } else {
            addLog(`   ⚠ ${script} error (exit ${r.exitCode}): ${r.stderr.slice(0, 200)}`)
          }
        } catch (e) {
          addLog(`   ⚠ ${script} failed: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
      addLog('✅ Scripts completed')

      // ── 6. Claude Haiku per-file quality review ──────────────────────────────
      setStatus('reviewing')
      const apiKey = getApiKey('anthropic')
      if (apiKey) {
        addLog(`🤖 Claude Haiku quality review (${converted.length} file${converted.length !== 1 ? 's' : ''})…`)
        const manualCtx = await loadManualContext()
        if (manualCtx) addLog('   Refinement manual v3.0 loaded')

        setReviewProgress({ done: 0, total: converted.length })
        const issues: FileIssue[] = new Array(converted.length)
        let done = 0
        const BATCH = 2  // 2 in parallel — to avoid 50k TPM rate limit
        for (let i = 0; i < converted.length; i += BATCH) {
          if (cancelledRef.current) break
          const batch = converted.slice(i, i + BATCH)
          const results = await Promise.all(
            batch.map(p => reviewFileWithClaude(p, manualCtx, apiKey))
          )
          results.forEach((r, j) => { issues[i + j] = r })
          done = Math.min(i + BATCH, converted.length)
          setReviewProgress({ done, total: converted.length })
          // 1.5s delay between batches — rate limit prevention
          if (done < converted.length) await new Promise(r => setTimeout(r, 1500))
        }
        const validIssues = issues.filter(Boolean)
        setReviews(validIssues)

        const problemCount = validIssues.filter(r => !r.issues.startsWith('✅')).length
        const archiveCount = validIssues.filter(r => r.archive).length
        addLog(`✅ Review complete — issues: ${problemCount}, archive recommended: ${archiveCount} / total ${validIssues.length}`)

        // ── 7. Keyword extraction ──────────────────────────────────────────
        addLog('🏷 Extracting core keywords…')
        const kws = await extractKeywords(converted, apiKey)
        setExtractedKeywords(kws)
        addLog(`✅ ${kws.length} keyword${kws.length !== 1 ? 's' : ''} extracted`)
        if (kws.length > 0) setResultTab('keywords')
      } else {
        addLog('⏭ No Anthropic API key → skipping quality review / keyword extraction')
      }

      addLog('🎉 Import complete! Reload the vault to apply changes.')
      setStatus('done')

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      addLog(`❌ Error: ${msg}`)
      setStatus('error')
    }
  }

  const handleAutoFix = async () => {
    const apiKey = getApiKey('anthropic')
    if (!apiKey || !activeDirRef.current) return

    const problemReviews = reviews.filter(r => !r.issues.startsWith('✅') && !r.archive)
    if (problemReviews.length === 0) return

    setAutoFixStatus('running')
    setFixProgress({ done: 0, total: problemReviews.length })
    setFixedFiles([])

    const vaultAPI = (window as any).vaultAPI as {
      readFile: (path: string) => Promise<string | null>
      saveFile: (path: string, content: string) => Promise<void>
    }

    const results: { filename: string; ok: boolean }[] = []
    for (let i = 0; i < problemReviews.length; i++) {
      const r = problemReviews[i]
      const filePath = activeDirRef.current + '/' + r.filename
      try {
        const content = await vaultAPI.readFile(filePath)
        if (!content) { results.push({ filename: r.filename, ok: false }); continue }
        const fixed = await fixFileWithClaude(content, r.issues, apiKey)
        if (fixed) {
          await vaultAPI.saveFile(filePath, fixed)
          results.push({ filename: r.filename, ok: true })
        } else {
          results.push({ filename: r.filename, ok: false })
        }
      } catch {
        results.push({ filename: r.filename, ok: false })
      }
      setFixProgress({ done: i + 1, total: problemReviews.length })
      if (i < problemReviews.length - 1) await new Promise(res => setTimeout(res, 1500))
    }
    setFixedFiles(results)
    setAutoFixStatus('done')
  }

  const handleSaveKeywords = async () => {
    if (!vaultPath || extractedKeywords.length === 0) return
    setKeywordSaveStatus('saving')
    const vaultAPI = (window as any).vaultAPI as { saveFile: (p: string, c: string) => Promise<void> }
    const date = new Date().toISOString().slice(0, 10)
    const lines = [
      '---',
      'title: Domain Keyword Dictionary',
      `date: ${date}`,
      'type: reference',
      'status: active',
      'tags: [keywords, domain]',
      '---',
      '',
      '# Core Domain Keywords',
      '',
      '> Auto-extracted from Confluence import — can be manually added/edited',
      '',
      ...extractedKeywords.map(k => `- ${k}`),
    ]
    try {
      await vaultAPI.saveFile(vaultPath + '/keywords.md', lines.join('\n'))
      setKeywordSaveStatus('done')
    } catch {
      setKeywordSaveStatus('idle')
    }
  }

  const handleMoveToArchive = async () => {
    const archiveReviews = reviews.filter(r => r.archive)
    if (archiveReviews.length === 0 || !activeDirRef.current || !archiveDirRef.current) return

    setArchiveMoveStatus('running')
    const vaultAPI = (window as any).vaultAPI as {
      moveFile: (absolutePath: string, destFolderPath: string) => Promise<{ success: boolean; newPath: string }>
    }
    let moved = 0
    for (const r of archiveReviews) {
      try {
        const src = activeDirRef.current + '/' + r.filename
        await vaultAPI.moveFile(src, archiveDirRef.current)
        moved++
      } catch { /* Skip move failures */ }
    }
    setMovedToArchive(moved)
    setArchiveMoveStatus('done')
  }

  const handleRollback = async () => {
    if (savedFilePaths.length === 0) return
    setRollbackStatus('running')
    addLog(`♻ Starting rollback — deleting ${savedFilePaths.length} file${savedFilePaths.length !== 1 ? 's' : ''}…`)
    try {
      const r = await confluenceAPI.rollback(savedFilePaths, savedDirs)
      addLog(`✅ Rollback complete — ${r.deleted} file${r.deleted !== 1 ? 's' : ''} deleted`)
      if (r.errors.length > 0) {
        addLog(`⚠ Some failures (permission issues or file locks):`)
        r.errors.forEach(e => addLog(`   • ${e}`))
        setRollbackStatus('error')
      } else {
        setRollbackStatus('done')
      }
      setSavedFilePaths([])
      setConvertedFiles([])
      setReviews([])
      setStatus('idle')
    } catch (e) {
      addLog(`❌ Rollback error: ${e instanceof Error ? e.message : String(e)}`)
      setRollbackStatus('error')
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-5">

      {/* Description */}
      <section>
        <p className="text-xs" style={{ color: 'var(--color-text-muted)', lineHeight: 1.7 }}>
          Fetches pages from the Confluence REST API, converts and saves them according to refinement manual v3.0.
          Claude Haiku reviews each file.
        </p>
      </section>

      <div style={{ borderTop: '1px solid var(--color-border)' }} />

      {/* Connection */}
      <section>
        <h3 className="text-xs font-semibold mb-3" style={{ color: 'var(--color-text-secondary)' }}>
          Confluence Connection
        </h3>

        {/* URL auto-parse */}
        <div className="flex flex-col gap-1 mb-4 p-2.5 rounded" style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-medium shrink-0" style={{ color: 'var(--color-text-muted)' }}>🔗 Confluence Page URL</span>
            <span className="text-[9px]" style={{ color: 'var(--color-text-muted)' }}>Paste to auto-configure server and space</span>
          </div>
          <div className="flex gap-1.5">
            <input
              type="text"
              value={urlInput}
              onChange={e => { setUrlInput(e.target.value); setUrlError('') }}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  const parsed = parseConfluenceUrl(urlInput)
                  if (parsed) {
                    setConfluenceConfig({ baseUrl: parsed.baseUrl, spaceKey: parsed.spaceKey, authType: parsed.authType })
                    setUrlError('')
                    setUrlInput('')
                  } else {
                    setUrlError('Could not find space key in URL')
                  }
                }
              }}
              placeholder="https://wiki.company.com/display/SPACEKEY/PageTitle"
              className="flex-1 text-[11px] rounded px-2 py-1.5 font-mono"
              style={{ background: 'var(--color-bg-base)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border)', outline: 'none' }}
              spellCheck={false}
            />
            <button
              type="button"
              onClick={() => {
                const parsed = parseConfluenceUrl(urlInput)
                if (parsed) {
                  setConfluenceConfig({ baseUrl: parsed.baseUrl, spaceKey: parsed.spaceKey, authType: parsed.authType })
                  setUrlError('')
                  setUrlInput('')
                } else {
                  setUrlError('Could not find space key in URL')
                }
              }}
              disabled={!urlInput.trim()}
              className="text-[11px] px-2.5 py-1.5 rounded disabled:opacity-40"
              style={{ background: 'var(--color-accent)', color: '#fff', border: 'none', whiteSpace: 'nowrap' }}
            >
              Auto-configure
            </button>
          </div>
          {urlError && <p className="text-[10px]" style={{ color: '#f87171' }}>{urlError}</p>}
        </div>

        {/* Auth type selector */}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[11px] font-medium shrink-0" style={{ color: 'var(--color-text-secondary)', minWidth: 100 }}>Auth Type</span>
          <div className="flex gap-1 flex-1">
            {([
              { id: 'cloud',        label: 'Cloud (API Token)',  desc: 'Atlassian Cloud — email + API token' },
              { id: 'server_pat',   label: 'Server PAT',        desc: 'Data Center/Server — Personal Access Token' },
              { id: 'server_basic', label: 'Server Basic',      desc: 'Data Center/Server — username + password' },
            ] as const).map(opt => (
              <button
                key={opt.id}
                onClick={() => setConfluenceConfig({ authType: opt.id })}
                title={opt.desc}
                className="text-[10px] px-2 py-1 rounded transition-colors"
                style={{
                  background: cfg.authType === opt.id ? 'var(--color-accent)' : 'var(--color-bg-hover)',
                  color: cfg.authType === opt.id ? '#fff' : 'var(--color-text-muted)',
                  border: '1px solid var(--color-border)',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          <FieldRow label="Base URL"  value={cfg.baseUrl}  onChange={v => setConfluenceConfig({ baseUrl: v })}
            placeholder={cfg.authType === 'cloud' ? 'https://yourcompany.atlassian.net' : 'https://confluence.company.com'} />
          <FieldRow label="Space Key" value={cfg.spaceKey} onChange={v => setConfluenceConfig({ spaceKey: v })} placeholder="DEV" />
          {cfg.authType !== 'server_pat' && (
            <FieldRow
              label={cfg.authType === 'server_basic' ? 'Username' : 'Email'}
              value={cfg.email}
              onChange={v => setConfluenceConfig({ email: v })}
              placeholder={cfg.authType === 'server_basic' ? 'username' : 'you@company.com'}
            />
          )}
          <FieldRow
            label={cfg.authType === 'server_pat' ? 'PAT Token' : cfg.authType === 'server_basic' ? 'Password' : 'API Token'}
            value={cfg.apiToken}
            onChange={v => setConfluenceConfig({ apiToken: v })}
            type="password"
            placeholder={cfg.authType === 'server_pat' ? 'Personal Access Token' : cfg.authType === 'server_basic' ? 'Password' : 'Atlassian API Token'}
          />
        </div>

        {/* Auth type hints */}
        <div className="mt-2 text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
          {cfg.authType === 'cloud' && 'Generate from Profile → Account Settings → Security → API Token Management'}
          {cfg.authType === 'server_pat' && 'Generate from Confluence → Profile → Settings → Personal Access Tokens. Email not required.'}
          {cfg.authType === 'server_basic' && 'Enter your on-premise Confluence username and password directly. PAT method is recommended.'}
        </div>

        {/* SSL bypass toggle */}
        <div className="flex items-center gap-2 mt-3 pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
          <input
            id="bypass-ssl"
            type="checkbox"
            checked={cfg.bypassSSL}
            onChange={e => setConfluenceConfig({ bypassSSL: e.target.checked })}
            className="w-3 h-3"
          />
          <label htmlFor="bypass-ssl" className="text-[11px] cursor-pointer" style={{ color: 'var(--color-text-secondary)' }}>
            Bypass SSL certificate verification <span style={{ color: 'var(--color-text-muted)' }}>(for internal CA / self-signed certificates)</span>
          </label>
        </div>
        {cfg.bypassSSL && (
          <p className="text-[10px] mt-1" style={{ color: '#f59e0b' }}>
            ⚠ Disabling SSL verification may expose you to man-in-the-middle attacks. Use only on internal networks.
          </p>
        )}
      </section>

      <div style={{ borderTop: '1px solid var(--color-border)' }} />

      {/* Date range */}
      <section>
        <h3 className="text-xs font-semibold mb-3" style={{ color: 'var(--color-text-secondary)' }}>
          Date Range <span className="text-[10px] font-normal" style={{ color: 'var(--color-text-muted)' }}>(hard minimum: {HARD_MIN_DATE})</span>
        </h3>
        <div className="flex flex-col gap-2.5">
          <FieldRow
            label="Start date"
            type="date"
            value={cfg.dateFrom}
            onChange={v => setConfluenceConfig({ dateFrom: v })}
            minDate={HARD_MIN_DATE}
          />
          <FieldRow
            label="End date"
            type="date"
            value={cfg.dateTo}
            onChange={v => setConfluenceConfig({ dateTo: v })}
          />
        </div>
        {dateWarn && (
          <p className="text-[10px] mt-1.5" style={{ color: '#f59e0b' }}>
            ⚠ Start date is before {HARD_MIN_DATE}. It will be automatically adjusted to {HARD_MIN_DATE} during import.
          </p>
        )}
        <p className="text-[10px] mt-1" style={{ color: 'var(--color-text-muted)' }}>
          Leave end date empty to import everything up to today.
        </p>
      </section>

      <div style={{ borderTop: '1px solid var(--color-border)' }} />

      {/* Save settings */}
      <section>
        <h3 className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text-secondary)' }}>
          Save Settings
        </h3>
        {/* Auto folder info */}
        <div className="rounded p-2.5 text-[11px]" style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)' }}>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <span style={{ color: 'var(--color-text-muted)' }}>Regular docs →</span>
              <code className="font-mono" style={{ color: 'var(--color-accent)' }}>active_YYYYMMDD/</code>
            </div>
            <div className="flex items-center gap-1.5">
              <span style={{ color: 'var(--color-text-muted)' }}>Archive →</span>
              <code className="font-mono" style={{ color: '#60a5fa' }}>archive_YYYYMMDD/</code>
            </div>
            <div className="flex items-center gap-1.5">
              <span style={{ color: 'var(--color-text-muted)' }}>Images →</span>
              <code className="font-mono" style={{ color: 'var(--color-text-muted)' }}>attachments/</code>
              <span style={{ color: 'var(--color-text-muted)' }}>(vault root)</span>
            </div>
          </div>
          {vaultPath && (
            <p className="mt-1.5 text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
              Vault: {vaultPath}
            </p>
          )}
        </div>

        {/* Skip images toggle */}
        <div className="flex items-center gap-2 mt-3">
          <input
            id="skip-images"
            type="checkbox"
            checked={skipImages}
            onChange={e => setSkipImages(e.target.checked)}
            className="w-3 h-3"
          />
          <label htmlFor="skip-images" className="text-[11px] cursor-pointer" style={{ color: 'var(--color-text-secondary)' }}>
            Skip image attachment download
          </label>
        </div>
      </section>

      <div style={{ borderTop: '1px solid var(--color-border)' }} />

      {/* AI review note */}
      <section>
        <div className="flex items-start gap-2 rounded p-2.5" style={{ background: hasAnthropicKey ? 'var(--color-bg-surface)' : '#f8717122', border: '1px solid var(--color-border)' }}>
          <span className="text-base leading-none mt-0.5">{hasAnthropicKey ? '🤖' : '⚠'}</span>
          <div>
            <p className="text-[11px] font-medium" style={{ color: 'var(--color-text-secondary)' }}>
              {hasAnthropicKey ? 'Claude Haiku quality review active' : 'Anthropic API key not set'}
            </p>
            <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
              {hasAnthropicKey
                ? `Each file will be reviewed using the ${HAIKU_MODEL} model, based on refinement manual v3.0.`
                : 'Register an Anthropic API key in AI Settings to enable quality review.'}
            </p>
          </div>
        </div>
      </section>

      <div style={{ borderTop: '1px solid var(--color-border)' }} />

      {/* Import button + log */}
      <section>
        {!vaultPath && (
          <p className="text-xs mb-3" style={{ color: '#f87171' }}>
            ⚠ You must open a vault before running an import.
          </p>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={handleImport}
            disabled={!canImport || isRunning}
            className="text-xs px-4 py-2 rounded font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: status === 'done' ? '#22c55e22' : status === 'error' ? '#f8717122' : 'var(--color-accent)',
              color: status === 'done' ? '#22c55e' : status === 'error' ? '#f87171' : '#fff',
              border: ['done', 'error'].includes(status) ? '1px solid currentColor' : 'none',
            }}
          >
            {isRunning
              ? (STATUS_LABEL[status] ?? 'Processing…')
              : status === 'done'
                ? `✅ Done (${pageCount} page${pageCount !== 1 ? 's' : ''})`
                : status === 'error'
                  ? '❌ Retry'
                  : '⬇ Import from Confluence'}
          </button>

          {/* Cancel button — shown while running */}
          {isRunning && (
            <button
              onClick={handleCancel}
              disabled={cancelledRef.current}
              className="text-xs px-3 py-2 rounded transition-colors disabled:opacity-40"
              style={{ background: '#f8717122', color: '#f87171', border: '1px solid #f8717144' }}
            >
              ⏹ Stop
            </button>
          )}

          {status === 'reviewing' && reviewProgress.total > 0 && (
            <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
              {reviewProgress.done}/{reviewProgress.total} reviewing…
            </span>
          )}

          {/* Rollback button — only shown after successful save */}
          {savedFilePaths.length > 0 && rollbackStatus !== 'done' && (
            <button
              onClick={handleRollback}
              disabled={rollbackStatus === 'running' || isRunning}
              className="text-xs px-3 py-2 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: '#f8717122',
                color: '#f87171',
                border: '1px solid #f8717144',
              }}
              title={`Delete all ${savedFilePaths.length} saved file${savedFilePaths.length !== 1 ? 's' : ''}`}
            >
              {rollbackStatus === 'running' ? 'Rolling back…' : `↩ Rollback (delete ${savedFilePaths.length} file${savedFilePaths.length !== 1 ? 's' : ''})`}
            </button>
          )}
          {rollbackStatus === 'done' && (
            <span className="text-[11px]" style={{ color: '#22c55e' }}>↩ Rollback complete</span>
          )}
        </div>

        {/* Log panel */}
        {log.length > 0 && (
          <div
            className="mt-3 rounded p-3 text-[11px] font-mono flex flex-col gap-0.5 overflow-y-auto"
            style={{
              background: 'var(--color-bg-surface)',
              border: '1px solid var(--color-border)',
              maxHeight: 150,
              color: 'var(--color-text-secondary)',
            }}
          >
            {log.map((line, i) => (
              <div key={i} style={{ color: line.startsWith('❌') ? '#f87171' : line.startsWith('⚠') ? '#f59e0b' : undefined }}>
                {line}
              </div>
            ))}
          </div>
        )}

        {/* Results panel — converted files + Claude review + keywords */}
        {(convertedFiles.length > 0 || reviews.length > 0 || extractedKeywords.length > 0) && (
          <div className="mt-4">
            {/* Tab bar */}
            <div className="flex gap-0 mb-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
              {([
                { id: 'files',    label: `Conversion Log (${convertedFiles.length})` },
                { id: 'review',   label: reviews.length > 0
                  ? (() => {
                      const problems = reviews.filter(r => !r.issues.startsWith('✅') && !r.archive).length
                      const archives = reviews.filter(r => r.archive).length
                      const parts = []
                      if (problems > 0) parts.push(`${problems} issue${problems !== 1 ? 's' : ''}`)
                      if (archives > 0) parts.push(`🗄 ${archives}`)
                      return `Review Results (${parts.join(', ') || 'no issues'})`
                    })()
                  : 'Review Results (pending)' },
                { id: 'keywords', label: extractedKeywords.length > 0
                  ? `🏷 Keywords (${extractedKeywords.length})` : '🏷 Keywords' },
              ] as const).map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setResultTab(tab.id)}
                  className="px-3 py-1.5 text-[11px] transition-colors"
                  style={{
                    color: resultTab === tab.id ? 'var(--color-accent)' : 'var(--color-text-muted)',
                    borderBottom: resultTab === tab.id ? '2px solid var(--color-accent)' : '2px solid transparent',
                    marginBottom: -1,
                    fontWeight: resultTab === tab.id ? 600 : 400,
                    background: 'none',
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Files tab */}
            {resultTab === 'files' && convertedFiles.length > 0 && (
              <div
                className="overflow-y-auto rounded-b"
                style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', borderTop: 'none', maxHeight: 200 }}
              >
                {/* Header row */}
                <div
                  className="grid px-3 py-1.5 text-[10px] font-semibold sticky top-0"
                  style={{
                    gridTemplateColumns: '1fr 60px 90px 46px',
                    color: 'var(--color-text-muted)',
                    background: 'var(--color-bg-surface)',
                    borderBottom: '1px solid var(--color-border)',
                  }}
                >
                  <span>Filename</span>
                  <span>Type</span>
                  <span>Date</span>
                  <span>Size</span>
                </div>
                {convertedFiles.map((f, i) => (
                  <div
                    key={i}
                    className="grid px-3 py-1.5 text-[11px]"
                    style={{
                      gridTemplateColumns: '1fr 60px 90px 46px',
                      borderBottom: i < convertedFiles.length - 1 ? '1px solid var(--color-border)' : undefined,
                      color: 'var(--color-text-secondary)',
                      background: f.sizeKb < 1 ? '#f8717108' : undefined,
                    }}
                  >
                    <span className="truncate font-mono" style={{ fontSize: 10 }} title={f.filename}>
                      {f.title || f.filename}
                    </span>
                    <span style={{ color: 'var(--color-text-muted)', fontSize: 10 }}>{f.type || '—'}</span>
                    <span style={{ color: 'var(--color-text-muted)', fontSize: 10 }}>{f.date || '—'}</span>
                    <span style={{ color: f.sizeKb < 1 ? '#f87171' : 'var(--color-text-muted)', fontSize: 10 }}>
                      {f.sizeKb}K
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Review tab */}
            {resultTab === 'review' && (
              <div style={{ border: '1px solid var(--color-border)', borderTop: 'none', borderRadius: '0 0 4px 4px' }}>
                {/* Action toolbar — auto-fix + archive move */}
                {(() => {
                  const fixable = reviews.filter(r => !r.issues.startsWith('✅') && !r.archive)
                  const archivable = reviews.filter(r => r.archive)
                  if (fixable.length === 0 && archivable.length === 0) return null
                  const fixedOk = fixedFiles.filter(f => f.ok).length
                  const anyRunning = autoFixStatus === 'running' || archiveMoveStatus === 'running' || isRunning
                  return (
                    <div
                      className="flex items-center gap-2 px-3 py-2 flex-wrap"
                      style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-base)' }}
                    >
                      {fixable.length > 0 && hasAnthropicKey && activeDirRef.current && (
                        <button
                          onClick={handleAutoFix}
                          disabled={anyRunning}
                          className="text-[11px] px-3 py-1 rounded font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                          style={{ background: 'var(--color-accent)', color: '#fff', border: 'none', whiteSpace: 'nowrap' }}
                        >
                          {autoFixStatus === 'running'
                            ? `🔧 Fixing… (${fixProgress.done}/${fixProgress.total})`
                            : autoFixStatus === 'done'
                              ? `✅ Fix complete (${fixedOk}/${fixedFiles.length})`
                              : `🔧 Auto-fix (${fixable.length})`}
                        </button>
                      )}
                      {archivable.length > 0 && activeDirRef.current && (
                        <button
                          onClick={handleMoveToArchive}
                          disabled={anyRunning || archiveMoveStatus === 'done'}
                          className="text-[11px] px-3 py-1 rounded font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                          style={{ background: '#3b82f622', color: '#60a5fa', border: '1px solid #3b82f644', whiteSpace: 'nowrap' }}
                        >
                          {archiveMoveStatus === 'running'
                            ? '📦 Moving…'
                            : archiveMoveStatus === 'done'
                              ? `✅ Archive move complete (${movedToArchive})`
                              : `📦 Move to archive_${getDateStamp()}/ (${archivable.length})`}
                        </button>
                      )}
                    </div>
                  )
                })()}

                {/* Fix results inline indicator */}
                {fixedFiles.length > 0 && (
                  <div className="flex flex-wrap gap-1 px-3 py-1.5" style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-base)' }}>
                    {fixedFiles.map((f, i) => (
                      <span
                        key={i}
                        className="text-[9px] px-1.5 py-0.5 rounded font-mono"
                        style={{ background: f.ok ? '#22c55e22' : '#f8717122', color: f.ok ? '#22c55e' : '#f87171' }}
                        title={f.filename}
                      >
                        {f.ok ? '✓' : '✗'} {f.filename.replace(/\.md$/, '')}
                      </span>
                    ))}
                  </div>
                )}

                <div className="overflow-y-auto" style={{ maxHeight: 200, background: 'var(--color-bg-surface)' }}>
                  {reviews.length === 0 ? (
                    <div className="px-3 py-4 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                      {status === 'reviewing' ? `Reviewing… (${reviewProgress.done}/${reviewProgress.total})` : 'No review results'}
                    </div>
                  ) : (
                    reviews.map((r, i) => {
                      const fixResult = fixedFiles.find(f => f.filename === r.filename)
                      return (
                        <div
                          key={i}
                          className="px-3 py-2 text-[11px]"
                          style={{
                            borderBottom: i < reviews.length - 1 ? '1px solid var(--color-border)' : undefined,
                            background: r.archive ? '#3b82f608' : r.issues.startsWith('✅') ? undefined : '#f8717108',
                          }}
                        >
                          <div className="flex items-center gap-1.5 font-mono mb-1" style={{ color: 'var(--color-text-muted)', fontSize: 10 }}>
                            <span>{r.filename}</span>
                            {fixResult && (
                              <span style={{ color: fixResult.ok ? '#22c55e' : '#f87171', fontSize: 9 }}>
                                {fixResult.ok ? '(fixed)' : '(fix failed)'}
                              </span>
                            )}
                          </div>
                          <div style={{
                            color: r.archive ? '#60a5fa' : r.issues.startsWith('✅') ? '#22c55e' : '#f87171',
                            lineHeight: 1.5, whiteSpace: 'pre-wrap',
                          }}>
                            {r.issues}
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            )}

            {/* Keywords tab */}
            {resultTab === 'keywords' && (
              <div style={{ border: '1px solid var(--color-border)', borderTop: 'none', borderRadius: '0 0 4px 4px' }}>
                {/* Toolbar */}
                <div className="flex items-center gap-3 px-3 py-2" style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-base)' }}>
                  {extractedKeywords.length > 0 && vaultPath && (
                    <button
                      onClick={handleSaveKeywords}
                      disabled={keywordSaveStatus === 'saving' || keywordSaveStatus === 'done'}
                      className="text-[11px] px-3 py-1 rounded font-medium disabled:opacity-40"
                      style={{ background: 'var(--color-accent)', color: '#fff', border: 'none', whiteSpace: 'nowrap' }}
                    >
                      {keywordSaveStatus === 'saving' ? 'Saving…'
                        : keywordSaveStatus === 'done' ? '✅ keywords.md saved'
                        : '💾 Save vault/keywords.md'}
                    </button>
                  )}
                  <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                    You can manually edit or add tags
                  </span>
                </div>

                {/* Keyword chips */}
                <div className="overflow-y-auto px-3 py-3" style={{ maxHeight: 200, background: 'var(--color-bg-surface)' }}>
                  {extractedKeywords.length === 0 ? (
                    <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                      {status === 'reviewing' ? 'Extracting keywords…' : 'No keywords (auto-extracted after review completes)'}
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {extractedKeywords.map((kw, i) => (
                        <span
                          key={i}
                          className="text-[11px] px-2 py-0.5 rounded-full font-medium"
                          style={{ background: 'var(--color-accent)22', color: 'var(--color-accent)', border: '1px solid var(--color-accent)44' }}
                        >
                          {kw}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

    </div>
  )
}
