import { describe, it, expect, beforeEach } from 'vitest'
import { useVaultStore } from '@/stores/vaultStore'
import type { LoadedDocument } from '@/types'

// ── Helpers ────────────────────────────────────────────────────────────────────

function resetStore() {
  useVaultStore.setState({
    vaultPath: null,
    loadedDocuments: null,
    isLoading: false,
    error: null,
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
