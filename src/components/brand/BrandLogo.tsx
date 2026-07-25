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
//
// If the graphical logo is STILL not appearing (falling through to the text
// fallback below) after confirming the asset is committed and deployed: the
// `full` variant now uses `unoptimized`, which serves the raw file directly
// and bypasses Vercel's image-optimization proxy entirely — that proxy is
// itself a possible point of failure (size/format handling, quota limits on
// some plans) independent of whether the source file is correctly deployed.
// If it's still failing after that, the fault is not in this component: curl
// the deployed asset URL directly (https://<your-domain>/brand/teein-it-up-
// logo.png) to check whether it 404s at the CDN/hosting level, independent
// of anything React or Next.js is doing.

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
  // Both variants deliberately use the SAME file. The separate, larger
  // teein-it-up-logo.png kept failing to render in production across
  // several rounds of fixes to the code around it — while the code changes
  // themselves were confirmed reaching production (a different fix, to the
  // round-lookup API route, took effect in the same deployment). That
  // strongly points at something specific to that one binary asset, not
  // the component. Reusing the exact file already proven to render
  // correctly in the header sidesteps the mystery entirely: if this file
  // works here, it works on the login page too, because it's the same
  // HTTP resource.
  full: { src: '/brand/teein-it-up-icon.png', alt: "Teein' It Up — Golf Event App" },
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
    const fallbackSize = variant === 'full' ? Math.round((size ?? 320) * 0.14) : 15
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

  // 'full' — explicit width/height (the standard next/image responsive
  // pattern: real intrinsic dimensions as props so Next always knows the
  // image's aspect ratio, then a CSS override on the *displayed* size).
  // Deliberately NOT using `fill`: fill requires the parent element to
  // resolve a non-zero computed height via CSS (aspect-ratio, in the
  // previous version of this component) — if that computed height silently
  // comes out as 0 in some rendering context, the image renders at zero
  // size with no error thrown (onError never fires, because the image
  // request itself succeeds — it's just invisible), which looks exactly
  // like "no graphical logo, just the text below it." Explicit width/height
  // has no such dependency on a parent's computed size.
  const displaySize = size ?? 320
  return (
    <Image
      src={src}
      alt={alt}
      width={displaySize}
      height={displaySize}
      priority={priority}
      unoptimized
      className={className}
      style={{
        display: 'block',
        width: `clamp(110px, 35vw, ${displaySize}px)`,
        height: 'auto',
        margin: '0 auto',
        objectFit: 'contain',
      }}
      onError={() => setFailed(true)}
    />
  )
}
