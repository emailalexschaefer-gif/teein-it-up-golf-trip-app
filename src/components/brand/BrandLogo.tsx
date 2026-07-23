'use client'

// The ONE shared logo component — used on the landing/login page, join page,
// dashboard header, trip pages, and scoring pages. Do not create another one.
//
// Asset path is stable and case-consistent: /public/brand/teein-it-up-logo.png
// and /public/brand/teein-it-up-icon.png. Linux/Vercel are case-sensitive —
// this path must match exactly, including case, or the asset 404s in
// production even though it works locally on a case-insensitive filesystem.
//
// IMPORTANT (recurring deployment issue — see DEPLOYMENT_NOTES.md):
// these PNGs must be explicitly `git add`-ed. A file present on disk but not
// committed will 404 on Vercel while working perfectly in local dev, which
// is exactly what happened before. Run `git status public/brand/` before
// every push that touches branding.

import Image from 'next/image'
import { useState } from 'react'

interface BrandLogoProps {
  /** 'full' = the full crest logo (auth/landing pages). 'icon' = compact square mark (headers). */
  variant?: 'full' | 'icon'
  /** Icon variant: explicit pixel size (square). Full variant: max width in px — height follows aspect ratio and scales down on narrow viewports via CSS. */
  size?: number
  priority?: boolean
  className?: string
}

const ASSET: Record<'full' | 'icon', { src: string; alt: string }> = {
  full: { src: '/brand/teein-it-up-logo.png', alt: "Teein' It Up — Golf Event App" },
  icon: { src: '/brand/teein-it-up-icon.png', alt: "Teein' It Up" },
}

/**
 * Renders the official logo. The 'icon' variant uses explicit width/height
 * (fixed header size). The 'full' variant uses a responsively-sized wrapper
 * with `fill`, so it scales down on narrow phones instead of clipping or
 * overflowing — it never depends on an implicitly-sized parent, which is
 * what silently produced a collapsed/invisible logo before.
 *
 * Falls back to plain text ONLY if the asset genuinely fails to load
 * client-side (onError) — never a golfer emoji, never a broken-image icon.
 * This should be rare; the real fix is the asset actually being deployed,
 * not the fallback.
 */
export default function BrandLogo({ variant = 'full', size, priority = false, className }: BrandLogoProps) {
  const [failed, setFailed] = useState(false)
  const { src, alt } = ASSET[variant]

  if (failed) {
    const fallbackSize = variant === 'full' ? Math.round((size ?? 280) * 0.16) : 15
    return (
      <span
        className={className}
        style={{
          fontFamily: 'var(--font-display)', fontWeight: 800,
          color: '#e8c96a', fontSize: fallbackSize,
          display: 'inline-block',
        }}
      >
        Teein&apos; It Up
      </span>
    )
  }

  if (variant === 'icon') {
    const dimension = size ?? 48
    return (
      <Image
        src={src}
        alt={alt}
        width={dimension}
        height={dimension}
        priority={priority}
        className={className}
        style={{ objectFit: 'contain', width: dimension, height: dimension }}
        onError={() => setFailed(true)}
      />
    )
  }

  // 'full' — responsive: scales with viewport, capped at `size` (default 280px),
  // never smaller than 160px, so it stays prominent without clipping on any screen.
  const maxWidth = size ?? 280
  return (
    <div
      className={className}
      style={{
        position: 'relative',
        width: `clamp(160px, 55vw, ${maxWidth}px)`,
        aspectRatio: '1 / 1',
        margin: '0 auto',
      }}
    >
      <Image
        src={src}
        alt={alt}
        fill
        priority={priority}
        sizes={`${maxWidth}px`}
        style={{ objectFit: 'contain' }}
        onError={() => setFailed(true)}
      />
    </div>
  )
}
