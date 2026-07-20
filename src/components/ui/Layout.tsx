'use client'

import React, { type ReactNode } from 'react'
import { cn } from '@/lib/utils'

// ── Card ─────────────────────────────────────────────────────────────────────
// Exact match to demo Card component: ivory bg, parchment border, green shadow

export function Card({ children, className, noPad }: {
  children: ReactNode; className?: string; noPad?: boolean
}) {
  return (
    <div className={cn(
      'bg-ivory rounded-card overflow-hidden',
      'border border-parchment-dark',
      'shadow-card',
      !noPad && 'p-4',
      className,
    )}>
      {children}
    </div>
  )
}

// ── GoldCard ─────────────────────────────────────────────────────────────────
// Dark green gradient with gold border — used for invite / hero sections

export function GoldCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn('rounded-2xl overflow-hidden border-2 border-gold', className)}
      style={{
        background: 'linear-gradient(160deg, #1e5c38 0%, #1a4731 60%, #0f2d1c 100%)',
        boxShadow: '0 4px 24px rgba(15,45,28,0.4)',
      }}
    >
      {children}
    </div>
  )
}

// ── SLabel ───────────────────────────────────────────────────────────────────
// Section label — 10.5px uppercase tracking — exact match to demo SLabel

export function SLabel({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <div className={cn('s-label', className)}>
      {children}
    </div>
  )
}

// ── Divider ──────────────────────────────────────────────────────────────────

export function Divider({ className }: { className?: string }) {
  return <div className={cn('divider', className)} />
}

export function GoldRule({ className }: { className?: string }) {
  return <div className={cn('gold-rule', className)} />
}

// ── PageTitle ─────────────────────────────────────────────────────────────────

export function PageTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h1 className={cn(
      'font-display font-bold text-ink text-3xl tracking-tight leading-tight',
      className,
    )}>
      {children}
    </h1>
  )
}

// ── SectionHeader ─────────────────────────────────────────────────────────────

export function SectionHeader({ title, subtitle, action }: {
  title: string; subtitle?: string; action?: ReactNode
}) {
  return (
    <div className="flex items-start justify-between mb-3">
      <div>
        <SLabel>{title}</SLabel>
        {subtitle && <p className="text-xs text-ink-light mt-0.5">{subtitle}</p>}
      </div>
      {action ? <div>{action}</div> : null}
    </div>
  )
}

// ── EmptyState ────────────────────────────────────────────────────────────────

export function EmptyState({ icon, title, body, action }: {
  icon?: string; title: string; body?: string; action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      {icon && <span className="text-4xl mb-3">{icon}</span>}
      <h3 className="font-display font-semibold text-ink text-base mb-1">{title}</h3>
      {body && <p className="text-sm text-ink-light max-w-xs mb-4">{body}</p>}
      {action ? <div>{action}</div> : null}
    </div>
  )
}

// ── InlineError ───────────────────────────────────────────────────────────────

export function InlineError({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  return (
    <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
      <span className="text-red-500 flex-shrink-0 mt-0.5">⚠</span>
      <p className="text-sm text-red-700 flex-1">{message}</p>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="text-red-400 hover:text-red-600 flex-shrink-0 text-xs underline"
        >
          Dismiss
        </button>
      )}
    </div>
  )
}
