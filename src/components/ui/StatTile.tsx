'use client'

import React from 'react'
import { cn } from '@/lib/utils'

// ── StatTile ──────────────────────────────────────────────────────────────────
// Reusable summary tile — players, groups, rounds, scores, side comps.
// Matches the stat strip in the demo.

interface Props {
  icon:    string
  value:   string | number
  label:   string
  sub?:    string
  accent?: 'green' | 'gold' | 'red' | 'amber'
  className?: string
}

const ACCENT_VALUE: Record<string, string> = {
  green: 'text-green-bright',
  gold:  'text-gold',
  red:   'text-red-600',
  amber: 'text-amber-600',
}

export default function StatTile({ icon, value, label, sub, accent, className }: Props) {
  return (
    <div className={cn(
      'flex-1 flex flex-col items-center justify-center py-3 px-2 text-center',
      className,
    )}>
      <span className="text-xl mb-0.5">{icon}</span>
      <p className={cn(
        'font-display font-bold text-2xl leading-none',
        accent ? ACCENT_VALUE[accent] : 'text-ink',
      )}>
        {value}
      </p>
      {sub && <p className="text-xs text-ink-light mt-0.5 leading-tight">{sub}</p>}
      <p className="text-xs text-ink-faint mt-0.5 uppercase tracking-wide">{label}</p>
    </div>
  )
}

// ── StatStrip ─────────────────────────────────────────────────────────────────
// Horizontal row of StatTiles separated by thin dividers — used in Overview

export function StatStrip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn(
      'bg-ivory rounded-card border border-parchment-dark shadow-card',
      'flex divide-x divide-parchment-dark',
      className,
    )}>
      {children}
    </div>
  )
}
