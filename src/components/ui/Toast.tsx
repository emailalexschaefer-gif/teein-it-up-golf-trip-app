'use client'

// ─────────────────────────────────────────────────────────────────────────────
// TOAST — lightweight notification system
// No external dependency. Single toast queue via React state.
// ─────────────────────────────────────────────────────────────────────────────

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

type ToastType = 'success' | 'error' | 'info'

interface Toast {
  id: string
  type: ToastType
  message: string
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const toast = useCallback((message: string, type: ToastType = 'success') => {
    const id = Math.random().toString(36).slice(2)
    setToasts((prev) => [...prev, { id, type, message }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 3500)
  }, [])

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {/* Toast container */}
      <div className="fixed top-4 left-0 right-0 z-50 flex flex-col items-center gap-2 pointer-events-none px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              'w-full max-w-sm px-4 py-3 rounded-2xl shadow-lg text-sm font-medium text-white',
              'animate-in slide-in-from-top-2 duration-200',
              t.type === 'success' && 'bg-brand-600',
              t.type === 'error'   && 'bg-red-500',
              t.type === 'info'    && 'bg-text',
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx.toast
}
