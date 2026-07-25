'use client'

// The ONE shared logo component — used on the landing/login page, join page,
// dashboard header, trip pages, and scoring pages. Do not create another one.
//
// Asset paths are stable and case-consistent under /public/brand/. Linux/
// Vercel are case-sensitive — paths must match exactly or the asset 404s in
// production even though it works locally on a case-insensitive filesystem.
//
// 'full' uses teein-it-up-logo-transparent.png — a genuinely transparent
// PNG (real alpha channel, produced via border-connected flood-fill so only
// the background was removed, not white pixels inside the artwork like the
// golf ball or lettering). The previous asset for this variant had an
// opaque white background baked in, which is why it looked like "a large
// white rectangular background" when displayed at landing-page size — not
// a caching or component bug, just an asset with no transparency.
//
// 'icon' still uses teein-it-up-icon.png (small, cropped, used in headers
// at 48px where the white background is not visually prominent).
//
// IMPORTANT (recurring deployment issue — see DEPLOYMENT_NOTES.md):
// these PNGs must be explicitly `git add`-ed. A file present on disk but not
// committed will 404 on Vercel while working perfectly in local dev.
// Run `git status public/brand/` before every push that touches branding.

import Image from 'next/image'
import { useState } from 'react'

interface BrandLogoProps {
  /** 'full' = the full crest logo (auth/landing pages). 'icon' = compact square mark (headers). */
  variant?: 'full' | 'icon'
  /** Icon variant: explicit pixel size (square). Full variant: max width in px — height follows the asset's real (near-square, not exactly 1:1) aspect ratio and scales down on narrow viewports via CSS. */
  size?: number
  priority?: boolean
  className?: string
}

// Real intrinsic dimensions of the full-crest asset — not a forced square.
const FULL_LOGO_WIDTH = 500
const FULL_LOGO_HEIGHT = 494

const ASSET: Record<'full' | 'icon', { src: string; alt: string }> = {
  full: { src: '/brand/teein-it-up-logo-transparent.png', alt: "Teein' It Up — Golf Event App" },
  icon: { src: '/brand/teein-it-up-icon.png', alt: "Teein' It Up" },
}

/**
 * Renders the official logo. Both variants use explicit width/height props
 * (Next's real intrinsic-dimensions requirement) with a CSS override on the
 * displayed size — not `fill`, which depends on a parent resolving a
 * non-zero computed height and can silently render at zero size instead of
 * erroring if that fails.
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
    const fallbackSize = variant === 'full' ? Math.round((size ?? FULL_LOGO_WIDTH) * 0.14) : 15
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
        unoptimized
        className={className}
        style={{ objectFit: 'contain', width: dimension, height: dimension, display: 'block' }}
        onError={() => setFailed(true)}
      />
    )
  }

  // 'full' — explicit width/height using the asset's REAL aspect ratio
  // (500×494, not a forced square), with a CSS override on the displayed
  // size. This is a brand-new file path never requested before, which also
  // rules out any stale 404 cached under the old filename.
  const displayWidth = size ?? FULL_LOGO_WIDTH
  const displayHeight = Math.round(displayWidth * (FULL_LOGO_HEIGHT / FULL_LOGO_WIDTH))
  return (
    <Image
      src={src}
      alt={alt}
      width={FULL_LOGO_WIDTH}
      height={FULL_LOGO_HEIGHT}
      priority={priority}
      unoptimized
      className={className}
      style={{
        display: 'block',
        width: `clamp(110px, 35vw, ${displayWidth}px)`,
        height: 'auto',
        aspectRatio: `${FULL_LOGO_WIDTH} / ${FULL_LOGO_HEIGHT}`,
        margin: '0 auto',
        objectFit: 'contain',
      }}
      onError={() => setFailed(true)}
    />
  )
}
