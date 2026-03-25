/**
 * Toast notification store.
 * Use showToast() anywhere (inside or outside React) to display a brief message.
 */
import { create } from 'zustand'

export type ToastType = 'success' | 'error' | 'info' | 'warn'

export interface ToastItem {
  id: string
  type: ToastType
  message: string
  durationMs: number
}

interface ToastState {
  toasts: ToastItem[]
  addToast: (toast: Omit<ToastItem, 'id'>) => string
  removeToast: (id: string) => void
}

let _seq = 0

export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],

  addToast: (toast) => {
    const id = `toast-${Date.now()}-${_seq++}`
    set(s => ({ toasts: [...s.toasts.slice(-4), { id, ...toast }] })) // cap at 5
    return id
  },

  removeToast: (id) =>
    set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),
}))

/** Convenience helper — callable outside React components */
export function showToast(
  message: string,
  type: ToastType = 'info',
  durationMs = 3000,
): void {
  useToastStore.getState().addToast({ message, type, durationMs })
}
