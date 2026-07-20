'use client'

import React from 'react'
import { cn } from '@/lib/utils'

// ── ProgressBar ───────────────────────────────────────────────────────────────
// Segmented gold progress bar — exact match to demo ProgressBar atom.
// Used in wizard (steps 1-3) and trip lifecycle (setup→live).

interface Props {
  step:     number   // 1-indexed current step (segments 0..step-1 are filled)
  total?:   number   // total segments (default 5)
  className?: string
}

export default function ProgressBar({ step, total = 5, className }: Props) {
  return (
    <div className={cn('flex gap-1', className)}>
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={cn(
            'flex-1 h-[3px] rounded-sm transition-all duration-400',
            i < step
              ? 'progress-seg done'
              : i === step
              ? 'progress-seg current'
              : 'progress-seg',
          )}
        />
      ))}
    </div>
  )
}
