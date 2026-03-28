import { describe, it, expect, beforeEach } from 'vitest'
import { useBackendStore } from '@/stores/backendStore'

// ── Helpers ────────────────────────────────────────────────────────────────────

function resetStore() {
  useBackendStore.setState({
    isReady: false,
    port: 8765,
    chunkCount: 0,
    isIndexing: false,
    indexingProgress: 0,
    error: null,
  })
}

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  resetStore()
})

// ── Initial state ──────────────────────────────────────────────────────────────

describe('useBackendStore — initial state', () => {
  it('starts with isReady false', () => {
    expect(useBackendStore.getState().isReady).toBe(false)
  })

  it('starts with default port 8765', () => {
    expect(useBackendStore.getState().port).toBe(8765)
  })

  it('starts with chunkCount 0', () => {
    expect(useBackendStore.getState().chunkCount).toBe(0)
  })

  it('starts with isIndexing false', () => {
    expect(useBackendStore.getState().isIndexing).toBe(false)
  })

  it('starts with no error', () => {
    expect(useBackendStore.getState().error).toBeNull()
  })
})

// ── setReady ───────────────────────────────────────────────────────────────────

describe('useBackendStore — setReady()', () => {
  it('sets isReady to true', () => {
    useBackendStore.getState().setReady(true)
    expect(useBackendStore.getState().isReady).toBe(true)
  })

  it('updates port when provided', () => {
    useBackendStore.getState().setReady(true, 9000)
    expect(useBackendStore.getState().port).toBe(9000)
  })

  it('preserves existing port when not provided', () => {
    useBackendStore.getState().setReady(true)
    expect(useBackendStore.getState().port).toBe(8765)
  })

  it('can set ready to false', () => {
    useBackendStore.getState().setReady(true)
    useBackendStore.getState().setReady(false)
    expect(useBackendStore.getState().isReady).toBe(false)
  })
})

// ── setChunkCount ──────────────────────────────────────────────────────────────

describe('useBackendStore — setChunkCount()', () => {
  it('sets chunk count', () => {
    useBackendStore.getState().setChunkCount(42)
    expect(useBackendStore.getState().chunkCount).toBe(42)
  })

  it('can set back to 0', () => {
    useBackendStore.getState().setChunkCount(10)
    useBackendStore.getState().setChunkCount(0)
    expect(useBackendStore.getState().chunkCount).toBe(0)
  })
})

// ── setIndexing ────────────────────────────────────────────────────────────────

describe('useBackendStore — setIndexing()', () => {
  it('sets isIndexing to true and resets progress to 0', () => {
    useBackendStore.getState().setIndexingProgress(50)
    useBackendStore.getState().setIndexing(true)
    expect(useBackendStore.getState().isIndexing).toBe(true)
    expect(useBackendStore.getState().indexingProgress).toBe(0)
  })

  it('sets isIndexing to false and sets progress to 100', () => {
    useBackendStore.getState().setIndexing(true)
    useBackendStore.getState().setIndexing(false)
    expect(useBackendStore.getState().isIndexing).toBe(false)
    expect(useBackendStore.getState().indexingProgress).toBe(100)
  })
})

// ── setError ───────────────────────────────────────────────────────────────────

describe('useBackendStore — setError()', () => {
  it('stores error message', () => {
    useBackendStore.getState().setError('Connection refused')
    expect(useBackendStore.getState().error).toBe('Connection refused')
  })

  it('clears error with null', () => {
    useBackendStore.getState().setError('error')
    useBackendStore.getState().setError(null)
    expect(useBackendStore.getState().error).toBeNull()
  })
})

// ── reset ──────────────────────────────────────────────────────────────────────

describe('useBackendStore — reset()', () => {
  it('resets all state to defaults', () => {
    useBackendStore.setState({
      isReady: true,
      port: 9000,
      chunkCount: 100,
      isIndexing: true,
      indexingProgress: 50,
      error: '에러',
    })

    useBackendStore.getState().reset()
    const state = useBackendStore.getState()

    expect(state.isReady).toBe(false)
    expect(state.port).toBe(8765)
    expect(state.chunkCount).toBe(0)
    expect(state.isIndexing).toBe(false)
    expect(state.indexingProgress).toBe(0)
    expect(state.error).toBeNull()
  })
})
