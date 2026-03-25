/**
 * VaultTabs — Multi-vault tab component displayed in the TopBar center area.
 *
 * Shows registered vaults as tabs:
 * - Click to switch vault (switchVault + loadVault)
 * - "+" button to add a new vault (folder picker)
 * - "x" button to remove a vault
 */

import { useCallback } from 'react'
import { Plus, X } from 'lucide-react'
import { useVaultStore } from '@/stores/vaultStore'
import { useVaultLoader } from '@/hooks/useVaultLoader'
import { useGraphStore } from '@/stores/graphStore'

export default function VaultTabs() {
  const { vaults, activeVaultId, switchVault, addVault, removeVault } = useVaultStore()
  const { loadVault } = useVaultLoader()

  const isElectron = Boolean(typeof window !== 'undefined' && window.vaultAPI)
  const vaultEntries = Object.entries(vaults)

  const handleSwitch = useCallback(async (id: string) => {
    if (id === activeVaultId) return
    switchVault(id)
    const entry = vaults[id]
    if (entry?.path) {
      window.vaultAPI?.watchStop()
      await loadVault(entry.path)
      await window.vaultAPI?.watchStart(entry.path)
    }
  }, [activeVaultId, vaults, switchVault, loadVault])

  const handleAdd = useCallback(async () => {
    if (!window.vaultAPI) return
    if (vaultEntries.length >= 8) return
    const selected = await window.vaultAPI.selectFolder()
    if (!selected) return
    const id = addVault(selected)
    if (!id) return
    switchVault(id)
    window.vaultAPI.watchStop()
    await loadVault(selected)
    await window.vaultAPI.watchStart(selected)
  }, [vaultEntries.length, addVault, switchVault, loadVault])

  const handleRemove = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    if (id === activeVaultId) {
      // Switch to another vault before removing
      const otherId = Object.keys(vaults).find(k => k !== id)
      if (otherId) {
        switchVault(otherId)
        const entry = vaults[otherId]
        if (entry?.path) {
          window.vaultAPI?.watchStop()
          loadVault(entry.path)
            .then(() => window.vaultAPI?.watchStart(entry.path))
            .catch((err: unknown) => console.warn('[VaultTabs] Failed to load vault:', err))
        }
      } else {
        window.vaultAPI?.watchStop()
        useVaultStore.getState().clearVault()
        useGraphStore.getState().resetToMock?.()
      }
    }
    removeVault(id)
  }, [activeVaultId, vaults, switchVault, removeVault, loadVault])

  // Hide tab UI when there is only one vault or fewer (saves TopBar space)
  if (vaultEntries.length <= 1 && !isElectron) return null

  return (
    <div
      className="flex items-center gap-0.5 h-full px-2 overflow-x-auto"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {vaultEntries.map(([id, entry]) => {
        const isActive = id === activeVaultId
        const label = entry.label || entry.path.split(/[/\\]/).pop() || id
        return (
          <button
            key={id}
            onClick={() => handleSwitch(id)}
            className="group flex items-center gap-1 px-2.5 py-1 rounded text-xs transition-colors shrink-0"
            style={{
              background: isActive ? 'var(--color-bg-surface)' : 'transparent',
              color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
              border: isActive ? '1px solid var(--color-border)' : '1px solid transparent',
              maxWidth: 120,
              fontWeight: isActive ? 600 : 400,
            }}
            title={entry.path}
          >
            <span
              style={{
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                maxWidth: vaultEntries.length > 2 ? 60 : 90,
              }}
            >
              {label}
            </span>
            {vaultEntries.length > 1 && (
              <span
                onClick={(e) => handleRemove(e, id)}
                className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity cursor-pointer"
                style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}
                title="Remove vault"
              >
                <X size={9} />
              </span>
            )}
          </button>
        )
      })}

      {/* Add new vault */}
      {isElectron && vaultEntries.length < 8 && (
        <button
          onClick={handleAdd}
          className="flex items-center justify-center w-6 h-6 rounded transition-colors hover:bg-[var(--color-bg-hover)] shrink-0"
          style={{ color: 'var(--color-text-muted)' }}
          title="Add vault"
        >
          <Plus size={11} />
        </button>
      )}
    </div>
  )
}
