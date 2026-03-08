import { useState, useEffect } from 'react'
import { Tag, Plus, X, Wand2, Loader2 } from 'lucide-react'
import { useSettingsStore } from '@/stores/settingsStore'
import { useVaultStore } from '@/stores/vaultStore'
import { useVaultLoader } from '@/hooks/useVaultLoader'
import { getAutoPaletteColor } from '@/lib/nodeColors'
import type { BulkTagProgress } from '@/services/tagService'

export default function TagsTab() {
  const { tagPresets, addTagPreset, removeTagPreset, tagColors, setTagColor } = useSettingsStore()
  const { loadedDocuments } = useVaultStore()
  const { vaultPath, loadVault } = useVaultLoader()
  const [input, setInput] = useState('')
  const [isBulkAssigning, setIsBulkAssigning] = useState(false)
  const [bulkProgress, setBulkProgress] = useState<BulkTagProgress | null>(null)
  const [bulkDoneMsg, setBulkDoneMsg] = useState<string | null>(null)

  // Auto-assign colors to existing presets that have no color on mount
  useEffect(() => {
    const missing = tagPresets.filter(t => !tagColors[t])
    if (missing.length > 0) {
      missing.forEach(t => setTagColor(t, getAutoPaletteColor(t)))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleAdd = () => {
    const trimmed = input.trim()
    if (!trimmed) return
    addTagPreset(trimmed)
    if (!tagColors[trimmed]) setTagColor(trimmed, getAutoPaletteColor(trimmed))
    setInput('')
  }

  const handleBulkAssign = async () => {
    if (isBulkAssigning) return
    if (!loadedDocuments?.length) {
      setBulkDoneMsg('Please load a vault first')
      setTimeout(() => setBulkDoneMsg(null), 3000)
      return
    }
    if (tagPresets.length === 0) {
      setBulkDoneMsg('Please add tag presets first')
      setTimeout(() => setBulkDoneMsg(null), 3000)
      return
    }

    setIsBulkAssigning(true)
    setBulkDoneMsg(null)
    setBulkProgress({ current: 0, total: loadedDocuments.length, docName: 'Preparing…', done: false })

    try {
      const { bulkAssignTagsToAllDocs } = await import('@/services/tagService')
      const { saved, skipped } = await bulkAssignTagsToAllDocs(
        loadedDocuments,
        (p) => { if (!p.done) setBulkProgress(p) },
      )
      // Reload vault to apply tags
      if (vaultPath) await loadVault(vaultPath)
      setBulkDoneMsg(`Done: ${saved} document(s) tagged, ${skipped} skipped`)
      setTimeout(() => setBulkDoneMsg(null), 6000)
    } catch {
      setBulkDoneMsg('An error occurred')
      setTimeout(() => setBulkDoneMsg(null), 3000)
    } finally {
      setIsBulkAssigning(false)
      setBulkProgress(null)
    }
  }

  const docCount = loadedDocuments?.length ?? 0

  return (
    <div className="flex flex-col gap-7">

      {/* Tag presets */}
      <section>
        <div className="flex items-center gap-1.5 mb-1.5">
          <Tag size={13} style={{ color: 'var(--color-text-muted)' }} />
          <h3 className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Tag Presets</h3>
          {tagPresets.length > 0 && (
            <button
              onClick={handleBulkAssign}
              disabled={isBulkAssigning}
              title={docCount > 0
                ? `AI will auto-assign tags to all ${docCount} documents in the vault`
                : 'Please load a vault first'}
              className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded text-[10px] transition-colors"
              style={{
                background: 'var(--color-bg-surface)',
                border: '1px solid var(--color-border)',
                color: isBulkAssigning ? 'var(--color-accent)' : 'var(--color-text-muted)',
                cursor: isBulkAssigning ? 'default' : 'pointer',
                opacity: isBulkAssigning ? 0.8 : 1,
              }}
              onMouseEnter={e => { if (!isBulkAssigning) { e.currentTarget.style.color = 'var(--color-text-primary)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)' } }}
              onMouseLeave={e => { if (!isBulkAssigning) { e.currentTarget.style.color = 'var(--color-text-muted)'; e.currentTarget.style.borderColor = 'var(--color-border)' } }}
            >
              {isBulkAssigning
                ? <Loader2 size={10} className="animate-spin" />
                : <Wand2 size={10} />}
              {isBulkAssigning ? 'Assigning…' : 'Auto-Assign'}
            </button>
          )}
        </div>

        {/* Progress */}
        {isBulkAssigning && bulkProgress && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ height: 2, background: 'var(--color-bg-active)', borderRadius: 1, overflow: 'hidden', marginBottom: 5 }}>
              <div style={{
                height: '100%',
                width: `${Math.round((bulkProgress.current / bulkProgress.total) * 100)}%`,
                background: 'var(--color-accent)',
                borderRadius: 1,
                transition: 'width 0.2s ease-out',
              }} />
            </div>
            <p style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>
              {bulkProgress.current}/{bulkProgress.total} — {bulkProgress.docName}
            </p>
          </div>
        )}

        {/* Done / error message */}
        {bulkDoneMsg && (
          <p style={{ fontSize: 11, color: 'var(--color-accent)', marginBottom: 6 }}>
            {bulkDoneMsg}
          </p>
        )}

        <p className="text-[11px] mb-4" style={{ color: 'var(--color-text-muted)' }}>
          AI tag suggestions will only select from this list. Click the color dot on the left to set the graph node color.
        </p>

        {/* Current preset list */}
        {tagPresets.length === 0 ? (
          <div
            className="flex items-center justify-center py-6 rounded-lg mb-4"
            style={{ border: '1px dashed var(--color-border)', color: 'var(--color-text-muted)', fontSize: 12 }}
          >
            No tag presets yet
          </div>
        ) : (
          <div className="flex flex-wrap gap-2 mb-4">
            {tagPresets.map(tag => {
              const customColor = tagColors[tag]
              return (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1.5 rounded"
                  style={{
                    fontSize: 12,
                    color: customColor ?? 'var(--color-accent)',
                    background: 'var(--color-bg-active)',
                    padding: '3px 8px 3px 6px',
                    border: `1px solid ${customColor ? customColor + '55' : 'rgba(255,255,255,0.08)'}`,
                  }}
                >
                  {/* Color picker swatch */}
                  <label
                    title={`Change node color for "${tag}"`}
                    style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'pointer', flexShrink: 0 }}
                  >
                    <span style={{
                      width: 10, height: 10, borderRadius: 2, display: 'inline-block',
                      background: customColor ?? 'var(--color-accent)',
                      border: '1px solid rgba(255,255,255,0.3)',
                      boxShadow: customColor ? `0 0 4px ${customColor}66` : undefined,
                    }} />
                    <input
                      type="color"
                      value={customColor ?? '#60a5fa'}
                      onChange={e => setTagColor(tag, e.target.value)}
                      style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', padding: 0, border: 'none' }}
                    />
                  </label>
                  #{tag}
                  <button
                    onClick={() => removeTagPreset(tag)}
                    title={`Remove "${tag}"`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      background: 'none',
                      border: 'none',
                      color: 'var(--color-text-muted)',
                      cursor: 'pointer',
                      padding: 0,
                      lineHeight: 1,
                    }}
                    onMouseEnter={e => (e.currentTarget.style.color = '#f87171')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
                  >
                    <X size={11} />
                  </button>
                </span>
              )
            })}
          </div>
        )}

        {/* Add input */}
        <div className="flex gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAdd() } }}
            placeholder="Enter new tag name"
            className="flex-1 px-3 py-2 rounded-lg text-xs outline-none"
            style={{
              background: 'var(--color-bg-surface)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-primary)',
            }}
            onFocus={e => (e.currentTarget.style.borderColor = 'var(--color-accent)')}
            onBlur={e => (e.currentTarget.style.borderColor = 'var(--color-border)')}
          />
          <button
            onClick={handleAdd}
            disabled={!input.trim()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs transition-colors"
            style={{
              background: input.trim() ? 'var(--color-accent)' : 'var(--color-bg-surface)',
              color: input.trim() ? '#fff' : 'var(--color-text-muted)',
              border: '1px solid var(--color-border)',
              cursor: input.trim() ? 'pointer' : 'not-allowed',
            }}
          >
            <Plus size={12} />
            Add
          </button>
        </div>
      </section>

    </div>
  )
}
