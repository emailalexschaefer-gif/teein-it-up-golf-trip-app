'use client'

import React, { createContext, useContext, useState, useCallback } from 'react'
import { cn } from '@/lib/utils'

type ToastType = 'success' | 'error' | 'info'
interface ToastItem { id: string; type: ToastType; message: string }
interface ToastCtx { toast: (message: string, type?: ToastType) => void }

const Ctx = createContext<ToastCtx | null>(null)

export function ToastProvider({ children }: React.PropsWithChildren<object>) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const toast = useCallback((message: string, type: ToastType = 'success') => {
    const id = Math.random().toString(36).slice(2)
    setToasts((p: ToastItem[]) => [...p, { id, type, message }])
    setTimeout(() => setToasts((p: ToastItem[]) => p.filter((t: ToastItem) => t.id !== id)), 3500)
  }, [])

  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="fixed top-4 left-0 right-0 z-50 flex flex-col items-center gap-2 pointer-events-none px-4">
        {toasts.map((t: ToastItem) => (
          <div key={t.id} className={cn(
            'w-full max-w-sm px-4 py-3 rounded-2xl shadow-lg text-sm font-medium text-white',
            t.type === 'success' && 'bg-brand-600',
            t.type === 'error'   && 'bg-red-500',
            t.type === 'info'    && 'bg-slate-700',
          )}>
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export function useToast() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx.toast
}
