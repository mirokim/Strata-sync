/**
 * VaultSelector.tsx
 *
 * Settings panel section for vault file management:
 * - Select vault folder via Electron dialog
 * - Auto-reload on change (fs.watch)
 * - Reload and Clear buttons
 * - Shows document count
 *
 * NOTE: Auto-load on app startup is handled by App.tsx (useVaultLoader hook).
 * This component only handles the Settings UI and manual actions.
 */

import { useEffect, useCallback, useRef } from 'react'
import { FolderOpen, RefreshCw, X, Loader2, AlertCircle } from 'lucide-react'
import { useVaultStore } from '@/stores/vaultStore'
import { useGraphStore } from '@/stores/graphStore'
import { useVaultLoader } from '@/hooks/useVaultLoader'

// ── VaultSelector component ───────────────────────────────────────────────────

export default function VaultSelector() {
  const {
    vaultPath, loadedDocuments, isLoading, error,
    setVaultPath, clearVault,
  } = useVaultStore()
  const { loadVault } = useVaultLoader()

  // ── Suppress watcher events around explicit load/watchStart calls ─────────
  // Windows fs.watch can fire spurious events immediately after watchStart.
  // We suppress vault:changed for 3 s after any explicit load or watchStart.
  // Note: .rembrant/ writes (personas.md) are already filtered in main.cjs,
  // so suppressWatch only needs to cover the initial watcher startup window.
  const suppressWatchRef = useRef(false)
  const suppressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const suppressWatch = useCallback(() => {
    if (suppressTimerRef.current) clearTimeout(suppressTimerRef.current)
    suppressWatchRef.current = true
    suppressTimerRef.current = setTimeout(() => { suppressWatchRef.current = false }, 3000)
  }, [])

  // ── Subscribe to vault:changed events ────────────────────────────────────
  useEffect(() => {
    if (!window.vaultAPI || !vaultPath) return
    return window.vaultAPI.onChanged(() => {
      // Always read from store — closure vaultPath is stale after clearVault()
      const currentVaultPath = useVaultStore.getState().vaultPath
      if (!currentVaultPath) return                                  // vault cleared
      if (useVaultStore.getState().isLoading) return                 // already loading
      if (suppressWatchRef.current) return                           // cooldown active
      if (!useGraphStore.getState().graphLayoutReady) return         // graph not ready yet
      loadVault(currentVaultPath)
    })
  }, [vaultPath, loadVault])

  // ── Handlers ─────────────────────────────────────────────────────────────

  const isElectron = Boolean(window.vaultAPI)

  const handleSelectFolder = useCallback(async () => {
    if (!window.vaultAPI) return
    const selected = await window.vaultAPI.selectFolder()
    if (!selected) return
    setVaultPath(selected)
    suppressWatch()
    await loadVault(selected)

    // If the vault is empty (no .md files), create a default "Project.md"
    const { loadedDocuments: freshDocs } = useVaultStore.getState()
    if ((!freshDocs || freshDocs.length === 0) && window.vaultAPI.saveFile) {
      const today = new Date().toISOString().slice(0, 10)
      const defaultContent = [
        '---',
        'speaker: chief_director',
        `date: ${today}`,
        'tags: [project]',
        '---',
        '',
        '# Project',
        '',
        'This is the default document for your new vault. Feel free to edit the contents.',
        '',
      ].join('\n')
      // Node.js accepts forward slashes on Windows as well
      const projectPath = selected.replace(/[/\\]$/, '') + '/Project.md'
      await window.vaultAPI.saveFile(projectPath, defaultContent)
      // Reload vault to pick up the newly created file
      suppressWatch()
      await loadVault(selected)
    }

    // Reset suppression window right before watchStart to cover the initial watcher events.
    // For large vaults the earlier suppressWatch() call may have already expired.
    suppressWatch()
    await window.vaultAPI.watchStart(selected)
  }, [setVaultPath, loadVault, suppressWatch])

  const handleReload = useCallback(async () => {
    if (!vaultPath) return
    suppressWatch()
    await loadVault(vaultPath)
  }, [vaultPath, loadVault, suppressWatch])

  const handleClear = useCallback(async () => {
    window.vaultAPI?.watchStop()
    clearVault()
    const { resetToMock } = useGraphStore.getState()
    resetToMock()
  }, [clearVault])

  const docCount = loadedDocuments?.length ?? 0

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div data-testid="vault-selector">
      {/* Section header */}
      <p
        className="text-xs font-semibold tracking-widest mb-3"
        style={{ color: 'var(--color-text-muted)' }}
      >
        VAULT
      </p>

      {/* Non-Electron notice */}
      {!isElectron && (
        <p className="text-xs mb-3 px-2 py-1.5 rounded" style={{
          color: '#f59e0b',
          background: 'rgba(245,158,11,0.08)',
          border: '1px solid rgba(245,158,11,0.2)',
        }}>
          Vault selection is only available in the Electron app.
          In browser (localhost) environments, mock data is displayed.
        </p>
      )}

      {/* Current vault path display */}
      {vaultPath ? (
        <div
          className="text-xs px-2 py-1.5 rounded mb-2 font-mono break-all"
          style={{
            background: 'var(--color-bg-surface)',
            color: 'var(--color-text-secondary)',
            border: '1px solid var(--color-border)',
          }}
          data-testid="vault-path"
        >
          {vaultPath}
        </div>
      ) : (
        <p className="text-xs mb-2" style={{ color: 'var(--color-text-muted)' }}>
          No vault selected — mock data will be displayed.
        </p>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 mb-2">
        <button
          onClick={handleSelectFolder}
          disabled={isLoading || !isElectron}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded transition-colors hover:bg-[var(--color-bg-hover)]"
          style={{
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-primary)',
            opacity: (isLoading || !isElectron) ? 0.4 : 1,
            cursor: !isElectron ? 'not-allowed' : undefined,
          }}
          title={!isElectron ? 'Only available in the Electron app' : undefined}
          data-testid="vault-select-btn"
        >
          <FolderOpen size={12} />
          Select Vault
        </button>

        {vaultPath && (
          <>
            <button
              onClick={handleReload}
              disabled={isLoading}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded transition-colors hover:bg-[var(--color-bg-hover)]"
              style={{
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-secondary)',
                opacity: isLoading ? 0.5 : 1,
              }}
              data-testid="vault-reload-btn"
            >
              {isLoading ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <RefreshCw size={12} />
              )}
              Reload
            </button>

            <button
              onClick={handleClear}
              disabled={isLoading}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded transition-colors hover:bg-[var(--color-bg-hover)]"
              style={{
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-muted)',
                opacity: isLoading ? 0.5 : 1,
              }}
              data-testid="vault-clear-btn"
            >
              <X size={12} />
              Clear
            </button>
          </>
        )}
      </div>

      {/* Status: doc count */}
      {vaultPath && !isLoading && !error && (
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {docCount > 0 ? (
            <>
              <span data-testid="vault-doc-count">{docCount}</span> document{docCount !== 1 ? 's' : ''} loaded
            </>
          ) : (
            'No .md files found'
          )}
        </p>
      )}

      {isLoading && (
        <p className="text-xs flex items-center gap-1" style={{ color: 'var(--color-text-muted)' }}>
          <Loader2 size={10} className="animate-spin" />
          Loading files…
        </p>
      )}

      {error && (
        <p
          className="text-xs flex items-center gap-1"
          style={{ color: '#ef4444' }}
          data-testid="vault-error"
        >
          <AlertCircle size={10} />
          {error}
        </p>
      )}
    </div>
  )
}
