import { describe, it, expect, beforeEach } from 'vitest'
import { useVaultStore } from '@/stores/vaultStore'
import type { LoadedDocument } from '@/types'

// ── Helpers ────────────────────────────────────────────────────────────────────

function resetStore() {
  useVaultStore.setState({
    vaults: {},
    activeVaultId: '',
    vaultPath: null,
    loadedDocuments: null,
    vaultDocsCache: {},
    vaultMetaCache: {},
    vaultFolders: [],
    imagePathRegistry: null,
    imageDataCache: {},
    isLoading: false,
    vaultReady: false,
    loadingProgress: 0,
    loadingPhase: '',
    error: null,
    pendingFileCount: null,
    bgLoadingInfo: null,
    watchDiff: null,
  })
}

const makeDoc = (id: string): LoadedDocument => ({
  id,
  filename: `${id}.md`,
  folderPath: '',
  speaker: 'art_director',
  date: '2024-01-01',
  tags: [],
  links: [],
  sections: [{ id: `${id}_intro`, heading: 'Title', body: 'Content', wikiLinks: [] }],
  rawContent: 'Content',
})

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  resetStore()
})

// ── Initial state ──────────────────────────────────────────────────────────────

describe('useVaultStore — initial state', () => {
  it('starts with null vaultPath', () => {
    expect(useVaultStore.getState().vaultPath).toBeNull()
  })

  it('starts with null loadedDocuments', () => {
    expect(useVaultStore.getState().loadedDocuments).toBeNull()
  })

  it('starts with isLoading false', () => {
    expect(useVaultStore.getState().isLoading).toBe(false)
  })

  it('starts with no error', () => {
    expect(useVaultStore.getState().error).toBeNull()
  })
})

// ── setVaultPath ───────────────────────────────────────────────────────────────

describe('useVaultStore — setVaultPath()', () => {
  it('sets vault path', () => {
    useVaultStore.getState().setVaultPath('/my/vault')
    expect(useVaultStore.getState().vaultPath).toBe('/my/vault')
  })

  it('can set to null', () => {
    useVaultStore.getState().setVaultPath('/my/vault')
    useVaultStore.getState().setVaultPath(null)
    expect(useVaultStore.getState().vaultPath).toBeNull()
  })
})

// ── setLoadedDocuments ─────────────────────────────────────────────────────────

describe('useVaultStore — setLoadedDocuments()', () => {
  it('stores loaded documents', () => {
    const docs = [makeDoc('d1'), makeDoc('d2')]
    useVaultStore.getState().setLoadedDocuments(docs)
    expect(useVaultStore.getState().loadedDocuments).toHaveLength(2)
  })

  it('can set to null', () => {
    useVaultStore.getState().setLoadedDocuments([makeDoc('d1')])
    useVaultStore.getState().setLoadedDocuments(null)
    expect(useVaultStore.getState().loadedDocuments).toBeNull()
  })
})

// ── setIsLoading ───────────────────────────────────────────────────────────────

describe('useVaultStore — setIsLoading()', () => {
  it('sets loading state to true', () => {
    useVaultStore.getState().setIsLoading(true)
    expect(useVaultStore.getState().isLoading).toBe(true)
  })

  it('sets loading state to false', () => {
    useVaultStore.getState().setIsLoading(true)
    useVaultStore.getState().setIsLoading(false)
    expect(useVaultStore.getState().isLoading).toBe(false)
  })
})

// ── setError ───────────────────────────────────────────────────────────────────

describe('useVaultStore — setError()', () => {
  it('stores error message', () => {
    useVaultStore.getState().setError('File load failed')
    expect(useVaultStore.getState().error).toBe('File load failed')
  })

  it('clears error with null', () => {
    useVaultStore.getState().setError('error')
    useVaultStore.getState().setError(null)
    expect(useVaultStore.getState().error).toBeNull()
  })
})

// ── clearVault ─────────────────────────────────────────────────────────────────

describe('useVaultStore — clearVault()', () => {
  it('resets all state to initial values', () => {
    useVaultStore.setState({
      vaultPath: '/my/vault',
      loadedDocuments: [makeDoc('d1')],
      isLoading: false,
      error: 'previous error',
    })

    useVaultStore.getState().clearVault()
    const state = useVaultStore.getState()

    expect(state.vaultPath).toBeNull()
    expect(state.loadedDocuments).toBeNull()
    expect(state.isLoading).toBe(false)
    expect(state.error).toBeNull()
  })
})

// ── addVault ───────────────────────────────────────────────────────────────────

describe('useVaultStore — addVault()', () => {
  it('creates a vault entry with generated ID', () => {
    const id = useVaultStore.getState().addVault('/path/to/vault')
    expect(id).toBeTruthy()
    expect(id).toContain('vault_')
    const entry = useVaultStore.getState().vaults[id]
    expect(entry).toBeDefined()
    expect(entry.path).toBe('/path/to/vault')
  })

  it('uses the last path segment as default label', () => {
    const id = useVaultStore.getState().addVault('/users/me/my-notes')
    const entry = useVaultStore.getState().vaults[id]
    expect(entry.label).toBe('my-notes')
  })

  it('uses custom label when provided', () => {
    const id = useVaultStore.getState().addVault('/path/to/vault', 'My Vault')
    const entry = useVaultStore.getState().vaults[id]
    expect(entry.label).toBe('My Vault')
  })

  it('returns existing ID if path already registered', () => {
    const id1 = useVaultStore.getState().addVault('/path/to/vault')
    const id2 = useVaultStore.getState().addVault('/path/to/vault')
    expect(id1).toBe(id2)
    expect(Object.keys(useVaultStore.getState().vaults)).toHaveLength(1)
  })

  it('caps at 8 vaults', () => {
    for (let i = 0; i < 8; i++) {
      const id = useVaultStore.getState().addVault(`/vault/${i}`)
      expect(id).toBeTruthy()
    }
    // 9th vault returns empty string
    const overflow = useVaultStore.getState().addVault('/vault/overflow')
    expect(overflow).toBe('')
    expect(Object.keys(useVaultStore.getState().vaults)).toHaveLength(8)
  })
})

// ── removeVault ───────────────────────────────────────────────────────────────

describe('useVaultStore — removeVault()', () => {
  it('removes a vault entry', () => {
    const id = useVaultStore.getState().addVault('/path/to/vault')
    useVaultStore.getState().removeVault(id)
    expect(useVaultStore.getState().vaults[id]).toBeUndefined()
  })

  it('switches to another vault when removing the active vault', () => {
    const id1 = useVaultStore.getState().addVault('/vault/a')
    const id2 = useVaultStore.getState().addVault('/vault/b')
    useVaultStore.getState().switchVault(id1)
    expect(useVaultStore.getState().activeVaultId).toBe(id1)

    useVaultStore.getState().removeVault(id1)
    // Should switch to the remaining vault
    expect(useVaultStore.getState().activeVaultId).toBe(id2)
    expect(useVaultStore.getState().vaultPath).toBe('/vault/b')
  })

  it('clears active vault when removing the last vault', () => {
    const id = useVaultStore.getState().addVault('/vault/only')
    useVaultStore.getState().switchVault(id)
    useVaultStore.getState().removeVault(id)
    expect(useVaultStore.getState().activeVaultId).toBe('')
    expect(useVaultStore.getState().vaultPath).toBeNull()
  })
})

// ── switchVault ───────────────────────────────────────────────────────────────

describe('useVaultStore — switchVault()', () => {
  it('updates activeVaultId and vaultPath', () => {
    const id1 = useVaultStore.getState().addVault('/vault/a')
    const id2 = useVaultStore.getState().addVault('/vault/b')

    useVaultStore.getState().switchVault(id1)
    expect(useVaultStore.getState().activeVaultId).toBe(id1)
    expect(useVaultStore.getState().vaultPath).toBe('/vault/a')

    useVaultStore.getState().switchVault(id2)
    expect(useVaultStore.getState().activeVaultId).toBe(id2)
    expect(useVaultStore.getState().vaultPath).toBe('/vault/b')
  })

  it('does nothing when switching to a non-existent vault', () => {
    const id = useVaultStore.getState().addVault('/vault/real')
    useVaultStore.getState().switchVault(id)
    useVaultStore.getState().switchVault('non_existent_id')
    // Should still be on the previous vault
    expect(useVaultStore.getState().activeVaultId).toBe(id)
    expect(useVaultStore.getState().vaultPath).toBe('/vault/real')
  })
})
