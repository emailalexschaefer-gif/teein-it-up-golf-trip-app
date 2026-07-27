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

const ASSET: Record<'full' | 'icon', { src: string; alt: string }> = {
  full: { src: '/brand/teein-it-up-logo-transparent.png', alt: "Teein' It Up — Golf Event App" },
  icon: { src: '/brand/teein-it-up-icon.png', alt: "Teein' It Up" },
}

/**
 * Renders the official logo. 'icon' uses next/image (explicit width/height,
 * unoptimized). 'full' uses a plain <img> tag — deliberately not
 * next/image, to rule it out as a variable after the icon variant (same
 * asset folder, same serving mechanism) worked in production while several
 * different next/image configurations for 'full' did not.
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
    const fallbackSize = variant === 'full' ? Math.round((size ?? 640) * 0.11) : 15
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

  // 'full' — plain, unmanaged <img> tag, deliberately NOT next/image.
  // The icon variant (identical folder, identical serving mechanism) is
  // confirmed working in production; this variant, using next/image with
  // several different configurations across several fixes, has not. The
  // file itself has been re-verified as a structurally valid 8-bit RGBA
  // PNG. With the asset and the serving mechanism both checking out, the
  // remaining variable was next/image's own handling of this component —
  // so this renders the image the simplest possible way, with the fewest
  // unknowns left, to isolate whether the fault was ever really here.
  const displayWidth = size ?? 640
  return (
    // eslint-disable-next-line @next/next/no-img-element -- deliberate: see comment above, this is diagnostic/corrective, not a shortcut
    <img
      src={src}
      alt={alt}
      className={className}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : 'auto'}
      style={{
        display: 'block',
        width: `clamp(170px, 52vw, ${displayWidth}px)`,
        height: 'auto',
        margin: '0 auto',
      }}
      onError={() => setFailed(true)}
    />
  )
}
