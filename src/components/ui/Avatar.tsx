'use client'

import React from 'react'
import Image from 'next/image'
import { cn } from '@/lib/utils'
import { initials, avatarColor } from '@/lib/utils'

// ── Avatar ────────────────────────────────────────────────────────────────────
// Circular player avatar with coloured background — matches demo Avatar atom

interface AvatarProps {
  name:     string
  size?:    'sm' | 'md' | 'lg'
  color?:   string
  imageUrl?: string
  className?: string
}

const SIZES = {
  sm: { outer: 28, font: 10 },
  md: { outer: 38, font: 13 },
  lg: { outer: 48, font: 16 },
}

export default function Avatar({ name, size = 'md', color, imageUrl, className }: AvatarProps) {
  const { outer, font } = SIZES[size]
  const bg = color ?? avatarColor(name)
  const text = initials(name)

  return (
    <div
      className={cn('flex-shrink-0 rounded-full flex items-center justify-center font-bold text-white overflow-hidden', className)}
      style={{
        width: outer, height: outer,
        background: imageUrl ? undefined : bg,
        fontSize: font,
        border: '2px solid rgba(255,255,255,0.22)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.22)',
        fontFamily: 'var(--font-body)',
        position: 'relative',
      }}
    >
      {imageUrl ? (
        <Image
          src={imageUrl}
          alt={name}
          fill
          sizes={`${outer}px`}
          className="rounded-full object-cover"
        />
      ) : text}
    </div>
  )
}

// ── GoldAvatar ────────────────────────────────────────────────────────────────
// Gold radial-gradient avatar — used for the current user / organiser in header

export function GoldAvatar({ name, size = 44 }: { name: string; size?: number }) {
  return (
    <div
      className="flex-shrink-0 rounded-full flex items-center justify-center font-black text-green-deep"
      style={{
        width: size, height: size,
        background: 'radial-gradient(circle at 38% 35%, #e8c96a, #c9a84c)',
        border: '2.5px solid #fdf0c8',
        fontSize: Math.round(size * 0.32),
        boxShadow: '0 3px 12px rgba(0,0,0,0.35)',
        fontFamily: 'var(--font-body)',
      }}
    >
      {initials(name)}
    </div>
  )
}
