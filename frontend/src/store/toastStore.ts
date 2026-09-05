import { create } from 'zustand'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface Toast {
  id: string
  type: ToastType
  title: string
  message?: string
  duration?: number
}

interface ToastStore {
  toasts: Toast[]
  add: (toast: Omit<Toast, 'id'>) => void
  remove: (id: string) => void
  success: (title: string, message?: string) => void
  error: (title: string, message?: string) => void
  warning: (title: string, message?: string) => void
  info: (title: string, message?: string) => void
}

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],

  add: (toast) => {
    // Skip if an identical toast (same type/title/message) is already
    // showing — a repeatedly-polled failure (a flapping connection, a
    // background health check) would otherwise wall the screen in stacked
    // copies of the exact same message instead of just staying visible once.
    // Genuinely different errors (a different title or message) still each
    // get their own toast.
    const isDuplicate = get().toasts.some(
      (t) => t.type === toast.type && t.title === toast.title && t.message === toast.message
    )
    if (isDuplicate) return

    const id = Date.now().toString() + Math.random().toString(36).slice(2)
    const duration = toast.duration ?? (toast.type === 'error' ? 8000 : 4000)
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }))
    setTimeout(() => get().remove(id), duration)
  },

  remove: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  success: (title, message) => get().add({ type: 'success', title, message }),
  error: (title, message) => get().add({ type: 'error', title, message }),
  warning: (title, message) => get().add({ type: 'warning', title, message }),
  info: (title, message) => get().add({ type: 'info', title, message }),
}))
