import { describe, it, expect, beforeEach } from 'vitest'
import { useToastStore, showToast } from '@/stores/toastStore'

// ── Helpers ────────────────────────────────────────────────────────────────────

function resetStore() {
  useToastStore.setState({ toasts: [] })
}

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  resetStore()
})

// ── addToast ──────────────────────────────────────────────────────────────────

describe('useToastStore — addToast()', () => {
  it('adds a toast to the list', () => {
    useToastStore.getState().addToast({ message: 'Hello', type: 'info', durationMs: 3000 })
    expect(useToastStore.getState().toasts).toHaveLength(1)
    expect(useToastStore.getState().toasts[0].message).toBe('Hello')
  })

  it('returns a unique toast ID', () => {
    const id1 = useToastStore.getState().addToast({ message: 'A', type: 'info', durationMs: 3000 })
    const id2 = useToastStore.getState().addToast({ message: 'B', type: 'info', durationMs: 3000 })
    expect(id1).toBeTruthy()
    expect(id2).toBeTruthy()
    expect(id1).not.toBe(id2)
  })

  it('preserves toast type and durationMs', () => {
    useToastStore.getState().addToast({ message: 'Error!', type: 'error', durationMs: 5000 })
    const toast = useToastStore.getState().toasts[0]
    expect(toast.type).toBe('error')
    expect(toast.durationMs).toBe(5000)
  })

  it('caps at 5 toasts (drops oldest beyond limit)', () => {
    for (let i = 0; i < 7; i++) {
      useToastStore.getState().addToast({ message: `Toast ${i}`, type: 'info', durationMs: 1000 })
    }
    const { toasts } = useToastStore.getState()
    expect(toasts.length).toBeLessThanOrEqual(5)
    // The most recent toast should always be present
    expect(toasts[toasts.length - 1].message).toBe('Toast 6')
  })
})

// ── removeToast ───────────────────────────────────────────────────────────────

describe('useToastStore — removeToast()', () => {
  it('removes a toast by id', () => {
    const id = useToastStore.getState().addToast({ message: 'Removable', type: 'warn', durationMs: 2000 })
    expect(useToastStore.getState().toasts).toHaveLength(1)
    useToastStore.getState().removeToast(id)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('does not affect other toasts', () => {
    const id1 = useToastStore.getState().addToast({ message: 'Keep', type: 'info', durationMs: 1000 })
    const id2 = useToastStore.getState().addToast({ message: 'Remove', type: 'info', durationMs: 1000 })
    useToastStore.getState().removeToast(id2)
    const { toasts } = useToastStore.getState()
    expect(toasts).toHaveLength(1)
    expect(toasts[0].id).toBe(id1)
    expect(toasts[0].message).toBe('Keep')
  })

  it('is a no-op for non-existent id', () => {
    useToastStore.getState().addToast({ message: 'A', type: 'info', durationMs: 1000 })
    useToastStore.getState().removeToast('non-existent-id')
    expect(useToastStore.getState().toasts).toHaveLength(1)
  })
})

// ── showToast convenience ─────────────────────────────────────────────────────

describe('showToast()', () => {
  it('adds a toast via convenience function', () => {
    showToast('Convenience toast')
    expect(useToastStore.getState().toasts).toHaveLength(1)
    expect(useToastStore.getState().toasts[0].message).toBe('Convenience toast')
  })

  it('defaults to type "info"', () => {
    showToast('Default type')
    expect(useToastStore.getState().toasts[0].type).toBe('info')
  })

  it('defaults to 3000ms duration', () => {
    showToast('Default duration')
    expect(useToastStore.getState().toasts[0].durationMs).toBe(3000)
  })

  it('accepts custom type and duration', () => {
    showToast('Custom', 'error', 5000)
    const toast = useToastStore.getState().toasts[0]
    expect(toast.type).toBe('error')
    expect(toast.durationMs).toBe(5000)
  })
})
