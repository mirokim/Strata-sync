/**
 * VaultSelector.tsx — Multi-vault manager
 *
 * Settings panel section for multi-vault management:
 * - Lists all registered vaults with doc counts
 * - Switch active vault, reload, remove
 * - Add new vault (max 8)
 * - fs.watch subscription for active vault
 */

import { useEffect, useCallback, useRef } from 'react'
import { FolderOpen, RefreshCw, X, Loader2, AlertCircle, Plus } from 'lucide-react'
import { useVaultStore } from '@/stores/vaultStore'
import { useGraphStore } from '@/stores/graphStore'
import { useBackendStore } from '@/stores/backendStore'
import { useVaultLoader } from '@/hooks/useVaultLoader'
import { tfidfIndex } from '@/lib/graphAnalysis'
import { updateDocInWorker } from '@/lib/bm25WorkerClient'
import { buildAdjacencyMap } from '@/lib/graphRAG'
import { parseMarkdownFile } from '@/lib/markdownParser'
import { buildFingerprint, saveTfIdfCache } from '@/lib/tfidfCache'
import { buildGraph } from '@/lib/graphBuilder'

export default function VaultSelector() {
  const {
    vaults, activeVaultId, vaultPath, loadedDocuments,
    isLoading, error, vaultDocsCache,
    addVault, removeVault, switchVault, clearVault, setWatchDiff,
  } = useVaultStore()
  const { isIndexing, chunkCount } = useBackendStore()
  const { loadVault, loadVaultCached } = useVaultLoader()

  const suppressWatchRef  = useRef(false)
  const suppressTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)

  const suppressWatch = useCallback(() => {
    if (suppressTimerRef.current) clearTimeout(suppressTimerRef.current)
    suppressWatchRef.current = true
    suppressTimerRef.current = setTimeout(() => { suppressWatchRef.current = false }, 3000)
  }, [])

  useEffect(() => {
    return () => {
      if (suppressTimerRef.current) clearTimeout(suppressTimerRef.current)
    }
  }, [])

  // Subscribe to fs.watch events for the active vault
  useEffect(() => {
    if (!window.vaultAPI || !vaultPath) return
    return window.vaultAPI.onChanged(async ({ vaultPath: changedVaultPath, changedFile }) => {
      const currentVaultPath = useVaultStore.getState().vaultPath
      if (!currentVaultPath) return
      if (useVaultStore.getState().isLoading) return
      if (suppressWatchRef.current) return
      if (!useGraphStore.getState().graphLayoutReady) return

      // 변경 파일이 특정됐을 때만 증분 업데이트 시도
      if (changedFile && tfidfIndex.isBuilt && window.vaultAPI?.readFile) {
        try {
          const sep = currentVaultPath.includes('\\') ? '\\' : '/'
          const absolutePath = `${currentVaultPath}${sep}${changedFile}`
          const content = await window.vaultAPI.readFile(absolutePath)
          if (content != null) {
            const relativePath = changedFile.replace(/\\/g, '/')
            const file = { relativePath, absolutePath, content, mtime: Date.now() }
            const updatedDoc = parseMarkdownFile(file)
            const { loadedDocuments, setLoadedDocuments, setWatchDiff } = useVaultStore.getState()

            // Diff 계산 — 이전 rawContent와 비교
            const prevDoc = loadedDocuments?.find(d => d.id === updatedDoc.id)
            if (prevDoc?.rawContent != null) {
              const prevLines = prevDoc.rawContent.split('\n')
              const newLines = content.split('\n')
              const prevSet = new Set(prevLines)
              const newSet = new Set(newLines)
              const added = newLines.filter(l => l.trim() && !prevSet.has(l)).length
              const removed = prevLines.filter(l => l.trim() && !newSet.has(l)).length
              const previewLine = newLines.find(l => l.trim() && !prevSet.has(l)) ?? ''
              setWatchDiff({
                filePath: relativePath,
                added,
                removed,
                preview: previewLine.slice(0, 80),
              })
              // 8초 후 자동 닫기
              setTimeout(() => {
                if (useVaultStore.getState().watchDiff?.filePath === relativePath) {
                  setWatchDiff(null)
                }
              }, 8000)
            }

            if (loadedDocuments) {
              // 문서 목록 증분 업데이트
              const newDocs = loadedDocuments.map(d => d.id === updatedDoc.id ? updatedDoc : d)
              const isNew = !loadedDocuments.some(d => d.id === updatedDoc.id)
              if (isNew) newDocs.push(updatedDoc)
              setLoadedDocuments(newDocs)

              // 그래프 증분 업데이트
              const { nodes: newNodes, links: newLinks } = buildGraph(newDocs)
              useGraphStore.getState().setGraph(newNodes, newLinks)

              // BM25 증분 업데이트 (워커)
              const fingerprint = String(Date.now())
              const adj = buildAdjacencyMap(newLinks)
              const { serialized, implicitLinks } = await updateDocInWorker(
                tfidfIndex.serialize(fingerprint), updatedDoc, adj, fingerprint
              )
              tfidfIndex.restore(serialized)
              tfidfIndex.setImplicitLinks(implicitLinks, adj)
              saveTfIdfCache(currentVaultPath, serialized).catch(() => {})
            }
            return  // 증분 업데이트 완료 — 전체 재로드 불필요
          }
        } catch {
          // 증분 실패 시 전체 재로드로 폴백
        }
      }

      loadVault(currentVaultPath)
    })
  }, [vaultPath, loadVault])

  const isElectron   = Boolean(window.vaultAPI)
  const vaultEntries = Object.entries(vaults)

  // ── Add new vault ──────────────────────────────────────────────────────────

  const handleAdd = useCallback(async () => {
    if (!window.vaultAPI) return
    if (vaultEntries.length >= 8) return
    const selected = await window.vaultAPI.selectFolder()
    if (!selected) return
    const id = addVault(selected)
    if (!id) return
    switchVault(id)
    window.vaultAPI.watchStop()
    suppressWatch()
    await loadVault(selected)
    suppressWatch()
    await window.vaultAPI.watchStart(selected)
  }, [vaultEntries.length, addVault, switchVault, loadVault, suppressWatch])

  // ── Switch to a vault ──────────────────────────────────────────────────────

  const handleSwitch = useCallback(async (id: string) => {
    if (id === activeVaultId) return
    const entry = vaults[id]
    if (!entry?.path) return
    switchVault(id)
    window.vaultAPI?.watchStop()
    suppressWatch()
    await loadVaultCached(entry.path)
    suppressWatch()
    await window.vaultAPI?.watchStart(entry.path)
  }, [activeVaultId, vaults, switchVault, loadVaultCached, suppressWatch])

  // ── Reload active vault ────────────────────────────────────────────────────

  const handleReload = useCallback(async () => {
    if (!vaultPath) return
    suppressWatch()
    await loadVault(vaultPath)
  }, [vaultPath, loadVault, suppressWatch])

  // ── Remove a vault ─────────────────────────────────────────────────────────

  const handleRemove = useCallback(async (id: string) => {
    if (id === activeVaultId) {
      const otherId = Object.keys(vaults).find(k => k !== id)
      if (otherId) {
        switchVault(otherId)
        const entry = vaults[otherId]
        if (entry?.path) {
          window.vaultAPI?.watchStop()
          suppressWatch()
          await loadVaultCached(entry.path)
          await window.vaultAPI?.watchStart(entry.path)
        }
      } else {
        window.vaultAPI?.watchStop()
        clearVault()
        useGraphStore.getState().resetToMock?.()
        if (window.backendAPI) window.backendAPI.clearIndex().catch(() => {})
      }
    }
    removeVault(id)
  }, [activeVaultId, vaults, switchVault, removeVault, clearVault, loadVaultCached, suppressWatch])

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div data-testid="vault-selector">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <p
          className="text-[11px] font-semibold tracking-widest"
          style={{ color: 'var(--color-text-muted)' }}
        >
          VAULT ({vaultEntries.length}/8)
        </p>

        {isElectron && vaultEntries.length < 8 && (
          <button
            onClick={handleAdd}
            disabled={isLoading}
            className="flex items-center gap-1 text-[12px] px-2.5 py-1 rounded transition-colors hover:bg-[var(--color-bg-hover)]"
            style={{
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-secondary)',
              opacity: isLoading ? 0.4 : 1,
            }}
            title="새 볼트 추가"
          >
            <Plus size={11} />
            볼트 추가
          </button>
        )}
      </div>

      {!isElectron && (
        <p className="text-xs mb-3 px-2 py-1.5 rounded" style={{
          color: '#f59e0b',
          background: 'rgba(245,158,11,0.08)',
          border: '1px solid rgba(245,158,11,0.2)',
        }}>
          Electron 앱에서만 볼트를 선택할 수 있습니다.
        </p>
      )}

      {/* Vault list */}
      {vaultEntries.length === 0 ? (
        <div
          className="text-[13px] px-3 py-4 rounded text-center"
          style={{
            color: 'var(--color-text-muted)',
            border: '1px dashed var(--color-border)',
          }}
        >
          등록된 볼트가 없습니다.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {vaultEntries.map(([id, entry]) => {
            const isActive  = id === activeVaultId
            const cachedDocs = vaultDocsCache[id]
            const docCount  = isActive
              ? (loadedDocuments?.length ?? cachedDocs?.length ?? 0)
              : (cachedDocs?.length ?? 0)
            const label = entry.label || entry.path.split(/[/\\]/).pop() || id

            return (
              <div
                key={id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '9px 12px', borderRadius: 6,
                  background: isActive ? 'var(--color-bg-surface)' : 'transparent',
                  border: `1px solid ${isActive ? 'var(--color-accent)' : 'var(--color-border)'}`,
                  cursor: isActive ? 'default' : 'pointer',
                  transition: 'border-color 0.15s',
                }}
                onClick={() => !isActive && handleSwitch(id)}
              >
                {/* Active indicator */}
                <div style={{
                  width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                  background: isActive ? 'var(--color-accent)' : 'var(--color-border)',
                }} />

                {/* Label + path */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 12, fontWeight: isActive ? 600 : 400,
                    color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {label}
                  </div>
                  <div style={{
                    fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    fontFamily: 'monospace',
                  }}>
                    {entry.path}
                  </div>
                </div>

                {/* Doc count */}
                <div style={{
                  fontSize: 11, color: 'var(--color-text-muted)',
                  whiteSpace: 'nowrap', flexShrink: 0,
                }}>
                  {docCount > 0 ? `${docCount}개` : '–'}
                  {isActive && isIndexing && ' · 인덱싱 중…'}
                  {isActive && !isLoading && chunkCount > 0 && ` · ${chunkCount}청크`}
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  {isActive && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleReload() }}
                      disabled={isLoading}
                      className="flex items-center justify-center w-6 h-6 rounded transition-colors hover:bg-[var(--color-bg-hover)]"
                      style={{
                        border: '1px solid var(--color-border)',
                        color: 'var(--color-text-muted)',
                        opacity: isLoading ? 0.4 : 1,
                      }}
                      title="새로고침"
                    >
                      {isLoading
                        ? <Loader2 size={10} className="animate-spin" />
                        : <RefreshCw size={10} />
                      }
                    </button>
                  )}
                  {!isActive && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleSwitch(id) }}
                      disabled={isLoading}
                      className="text-[11px] px-2 py-0.5 rounded transition-colors hover:bg-[var(--color-bg-hover)]"
                      style={{
                        border: '1px solid var(--color-border)',
                        color: 'var(--color-text-muted)',
                        opacity: isLoading ? 0.4 : 1,
                      }}
                      title="이 볼트로 전환"
                    >
                      전환
                    </button>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); handleRemove(id) }}
                    disabled={isLoading}
                    className="flex items-center justify-center w-6 h-6 rounded transition-colors hover:bg-[var(--color-bg-hover)]"
                    style={{
                      border: '1px solid var(--color-border)',
                      color: 'var(--color-text-muted)',
                      opacity: isLoading ? 0.4 : 1,
                    }}
                    title="볼트 제거"
                  >
                    <X size={10} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Active vault error */}
      {error && (
        <p
          className="text-xs flex items-center gap-1 mt-2"
          style={{ color: '#ef4444' }}
          data-testid="vault-error"
        >
          <AlertCircle size={10} />
          {error}
        </p>
      )}

      {/* Non-Electron: add vault placeholder */}
      {isElectron && vaultEntries.length === 0 && (
        <button
          onClick={handleAdd}
          disabled={isLoading}
          className="flex items-center gap-1.5 text-[13px] px-3 py-2 rounded mt-3 transition-colors hover:bg-[var(--color-bg-hover)]"
          style={{
            border: '1px dashed var(--color-border)',
            color: 'var(--color-text-muted)',
            width: '100%', justifyContent: 'center',
          }}
          data-testid="vault-select-btn"
        >
          <FolderOpen size={12} />
          볼트 폴더 선택
        </button>
      )}
    </div>
  )
}
