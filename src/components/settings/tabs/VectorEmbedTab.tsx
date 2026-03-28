import { useState, useEffect } from 'react'
import { Eye, EyeOff, RefreshCw, CheckCircle2, Loader2, AlertCircle, Trash2 } from 'lucide-react'
import { useSettingsStore } from '@/stores/settingsStore'
import { vectorEmbedIndex } from '@/lib/vectorEmbedIndex'
import { invalidateVectorEmbedCache } from '@/lib/vectorEmbedCache'
import { useVaultStore } from '@/stores/vaultStore'
import { buildFingerprint } from '@/lib/tfidfCache'

export default function VectorEmbedTab() {
  const { apiKeys, setApiKey } = useSettingsStore()
  const { loadedDocuments, vaultPath } = useVaultStore()
  const [showKey, setShowKey] = useState(false)
  const [status, setStatus] = useState({
    isBuilt: vectorEmbedIndex.isBuilt,
    isBuilding: vectorEmbedIndex.isBuilding,
    progress: vectorEmbedIndex.progress,
    size: vectorEmbedIndex.size,
    lastError: vectorEmbedIndex.lastError,
  })

  // Status polling — 500ms while building, refreshes once after completion
  useEffect(() => {
    const tick = () => setStatus({
      isBuilt: vectorEmbedIndex.isBuilt,
      isBuilding: vectorEmbedIndex.isBuilding,
      progress: vectorEmbedIndex.progress,
      size: vectorEmbedIndex.size,
      lastError: vectorEmbedIndex.lastError,
    })
    tick()
    const id = setInterval(tick, 500)
    return () => clearInterval(id)
  }, [])

  const geminiKey = apiKeys['gemini'] ?? ''
  const hasKey = Boolean(geminiKey)
  const docCount = loadedDocuments?.length ?? 0

  async function handleBuild() {
    if (!hasKey || status.isBuilding || docCount === 0) return
    const path = vaultPath ?? ''
    const fingerprint = buildFingerprint(loadedDocuments ?? [])
    await invalidateVectorEmbedCache(path)  // Delete cache then rebuild
    vectorEmbedIndex.reset()
    vectorEmbedIndex.buildInBackground(loadedDocuments ?? [], geminiKey, path, fingerprint)
      .catch(() => { /* Errors are handled by the logger */ })
  }

  async function handleReset() {
    if (status.isBuilding) return
    await invalidateVectorEmbedCache(vaultPath ?? '')
    vectorEmbedIndex.reset()
  }

  const hasError = Boolean(status.lastError) && !status.isBuilt && !status.isBuilding
  const statusIcon = status.isBuilding
    ? <Loader2 size={14} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
    : status.isBuilt
      ? <CheckCircle2 size={14} style={{ color: '#4caf50' }} />
      : hasError
        ? <AlertCircle size={14} style={{ color: '#ef4444' }} />
        : <AlertCircle size={14} style={{ color: 'var(--color-text-muted)' }} />

  const statusText = status.isBuilding
    ? `Building... ${status.progress}%`
    : status.isBuilt
      ? `Ready — ${status.size} documents indexed`
      : hasError
        ? `Build failed`
        : hasKey ? 'No index — auto-builds on vault load' : 'Gemini API key required'

  return (
    <div className="flex flex-col gap-5">

      <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
        Vectorizes documents using Google Gemini's <strong>gemini-embedding-001</strong> model.
        Reranks BM25 keyword search results by semantic similarity to improve accuracy for abstract queries.
        <span style={{ color: '#4caf50' }}> Free (within API quota)</span>
      </p>

      {/* ── Status display ── */}
      <section>
        <h3 className="text-[13px] font-semibold mb-2" style={{ color: 'var(--color-text-secondary)' }}>
          Index Status
        </h3>
        <div
          className="rounded-lg px-4 py-3 flex items-center justify-between gap-3"
          style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}
        >
          <div className="flex items-center gap-2">
            {statusIcon}
            <span className="text-[13px]" style={{ color: 'var(--color-text-primary)' }}>
              {statusText}
            </span>
          </div>
          {status.isBuilding && (
            <div
              className="flex-1 max-w-32 h-1.5 rounded-full overflow-hidden"
              style={{ background: 'var(--color-border)' }}
            >
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${status.progress}%`, background: 'var(--color-accent)' }}
              />
            </div>
          )}
        </div>
        {hasError && (
          <p className="text-[11px] mt-1.5 px-1" style={{ color: '#ef4444' }}>
            {status.lastError}
          </p>
        )}
        <p className="text-[11px] mt-1.5" style={{ color: 'var(--color-text-muted)' }}>
          Automatically builds in the background when vault is loaded. If already built, instantly restores from IndexedDB cache.
        </p>
      </section>

      {/* ── Gemini API Key ── */}
      <section>
        <h3 className="text-[13px] font-semibold mb-2" style={{ color: 'var(--color-text-secondary)' }}>
          Gemini API Key
        </h3>
        <div className="relative">
          <input
            type={showKey ? 'text' : 'password'}
            value={geminiKey}
            onChange={e => setApiKey('gemini', e.target.value.trim())}
            placeholder="AIza..."
            className="w-full text-[13px] rounded px-3 py-2 pr-9 font-mono"
            style={{
              background: 'var(--color-bg-surface)',
              color: 'var(--color-text-primary)',
              border: '1px solid var(--color-border)',
              outline: 'none',
            }}
            autoComplete="off"
          />
          <button
            onClick={() => setShowKey(v => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5"
            style={{ color: 'var(--color-text-muted)' }}
            tabIndex={-1}
          >
            {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        <p className="text-[11px] mt-1.5" style={{ color: 'var(--color-text-muted)' }}>
          Issued from Google AI Studio — same as the Gemini key in the AI settings tab.
        </p>
      </section>

      {/* ── Manual Rebuild ── */}
      <section>
        <h3 className="text-[13px] font-semibold mb-2" style={{ color: 'var(--color-text-secondary)' }}>
          Manual Rebuild
        </h3>
        <div className="flex items-center gap-3">
          <button
            onClick={handleBuild}
            disabled={!hasKey || status.isBuilding || docCount === 0}
            className="flex items-center gap-2 px-3 py-2 rounded text-[13px] transition-opacity"
            style={{
              background: 'var(--color-accent)',
              color: '#fff',
              opacity: (!hasKey || status.isBuilding || docCount === 0) ? 0.4 : 1,
              cursor: (!hasKey || status.isBuilding || docCount === 0) ? 'not-allowed' : 'pointer',
            }}
          >
            {status.isBuilding
              ? <Loader2 size={13} className="animate-spin" />
              : <RefreshCw size={13} />}
            {status.isBuilding ? `Building (${status.progress}%)` : 'Build Now'}
          </button>
          <button
            onClick={handleReset}
            disabled={status.isBuilding}
            className="flex items-center gap-2 px-3 py-2 rounded text-[13px] transition-opacity"
            style={{
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-muted)',
              opacity: status.isBuilding ? 0.4 : 1,
              cursor: status.isBuilding ? 'not-allowed' : 'pointer',
            }}
          >
            <Trash2 size={13} />
            Reset
          </button>
          <span className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
            {docCount > 0 ? `${docCount} documents` : 'Available after vault load'}
          </span>
        </div>
        {!hasKey && (
          <p className="text-[11px] mt-2" style={{ color: '#f59e0b' }}>
            ⚠ Please enter a Gemini API key first.
          </p>
        )}
      </section>

      {/* ── How It Works ── */}
      <section>
        <h3 className="text-[13px] font-semibold mb-2" style={{ color: 'var(--color-text-secondary)' }}>
          How It Works
        </h3>
        <div
          className="rounded-lg px-4 py-3 text-[12px] flex flex-col gap-1.5"
          style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-muted)', lineHeight: 1.6 }}
        >
          <div>① <strong style={{ color: 'var(--color-text-primary)' }}>BM25</strong> — Extract top 50 candidates by query keywords (existing method)</div>
          <div>② <strong style={{ color: 'var(--color-text-primary)' }}>Query Embedding</strong> — Convert query to 768-dim vector (1 API call)</div>
          <div>③ <strong style={{ color: 'var(--color-text-primary)' }}>Reranking</strong> — Final ranking: BM25 40% + semantic similarity 60%</div>
          <div className="mt-1" style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>
            Document embeddings are cached in IndexedDB — only regenerated when the vault changes.
          </div>
        </div>
      </section>

    </div>
  )
}
