'use client'

import React from 'react'
import { cn } from '@/lib/utils'

// ── Badge ─────────────────────────────────────────────────────────────────────
// Reusable chip/badge — consistent across the entire app.

type BadgeVariant =
  | 'organiser'     // gold border, dark green bg
  | 'player'        // subtle parchment
  | 'status-draft'
  | 'status-open'
  | 'status-groups-ready'
  | 'status-ready'
  | 'status-live'
  | 'status-completed'
  | 'status-archived'
  | 'hcp'           // handicap pill
  | 'tee-time'      // clock + time
  | 'group'         // group number chip
  | 'success'
  | 'warning'
  | 'error'

const STYLES: Record<BadgeVariant, string> = {
  'organiser':          'bg-green-deep text-gold-light border border-gold',
  'player':             'bg-cream text-ink-light border border-parchment-dark',
  'status-draft':       'bg-cream-200 text-ink-light border border-parchment-dark',
  'status-open':        'bg-blue-50 text-blue-700 border border-blue-200',
  'status-groups-ready':'bg-violet-50 text-violet-700 border border-violet-200',
  'status-ready':       'bg-amber-50 text-amber-700 border border-amber-200',
  'status-live':        'bg-green-50 text-green-700 border border-green-200',
  'status-completed':   'bg-brand-50 text-brand-700 border border-brand-200',
  'status-archived':    'bg-cream text-ink-faint border border-parchment-dark',
  'hcp':                'bg-ivory text-ink-light border border-parchment-dark',
  'tee-time':           'bg-gold-pale text-gold-dark border border-gold',
  'group':              'bg-green text-gold-light border border-green-mid font-bold',
  'success':            'bg-green-50 text-green-700 border border-green-200',
  'warning':            'bg-amber-50 text-amber-700 border border-amber-200',
  'error':              'bg-red-50 text-red-700 border border-red-200',
}

interface BadgeProps {
  variant?: BadgeVariant
  children?: React.ReactNode
  className?: string
}

export default function Badge({ variant = 'player', children, className }: BadgeProps) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1',
      'text-xs font-semibold px-2.5 py-0.5 rounded-full',
      'leading-none whitespace-nowrap',
      STYLES[variant],
      className,
    )}>
      {children}
    </span>
  )
}

// ── Convenience exports ───────────────────────────────────────────────────────

export function HcpBadge({ value }: { value: number | null | undefined }) {
  if (value == null) return null
  return <Badge variant="hcp">HCP {value % 1 === 0 ? value : value.toFixed(1)}</Badge>
}

export function TeeTimeBadge({ time }: { time: string }) {
  return (<Badge variant="tee-time">🕐 {time}</Badge>)
}

export function GroupBadge({ number }: { number: number }) {
  return (<Badge variant="group">G{number}</Badge>)
}

export function StatusBadge({ status }: { status: string }) {
  const MAP: Record<string, BadgeVariant> = {
    draft:        'status-draft',
    open:         'status-open',
    groups_ready: 'status-groups-ready',
    ready:        'status-ready',
    live:         'status-live',
    completed:    'status-completed',
    archived:     'status-archived',
  }
  const LABELS: Record<string, string> = {
    draft:        'Draft',
    open:         'Open for Invitations',
    groups_ready: 'Groups Ready',
    ready:        'Ready to Start',
    live:         'Live',
    completed:    'Completed',
    archived:     'Archived',
  }
  return (<Badge variant={MAP[status] ?? 'player'}>{LABELS[status] ?? status}</Badge>)
}
