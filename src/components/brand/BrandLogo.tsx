'use client'

// The ONE shared logo component — used on the landing/login page, join page,
// dashboard header, trip pages, and scoring pages. Do not create another one.
//
// Asset paths are stable and case-consistent under /public/brand/. Linux/
// Vercel are case-sensitive — paths must match exactly or the asset 404s in
// production even though it works locally on a case-insensitive filesystem.
//
// 30 Aug field-test bundle — Sign-In logo fix. 'full' now points at
// logo-new.png, the actual supplied production crest (the real
// green/gold shield artwork — golf ball, cap, clubs, "Teein' It Up",
// "GOLF EVENT APP" all baked into the one image), not the previous
// teein-it-up-logo-transparent.png. That file is still present on disk
// in this repo and passed every code-level check this component's own
// history already documents — which is exactly why this fix does not
// trust another code-level check alone this time. The screenshot this
// round showed BrandLogo's own onError text fallback rendering (the
// giant wrapped "Teein' It / Up" text is that exact fallback, not a
// missing-component bug) — meaning the image request itself failed in
// production despite looking correct here. Per this component's own
// recurring-issue history ("a file present on disk but not committed
// will 404 on Vercel"), the most likely explanation is that asset was
// never actually committed/deployed, not a rendering bug in this file.
// Given a fresh upload plus a new filename removes any doubt about
// stale caching or a half-committed previous asset, this uses that new
// file directly rather than re-trusting the old one. teein-it-up-icon.png
// (a different asset, used only by the 'icon' variant in compact
// headers) is unaffected — this only changes the 'full' variant's
// source.
//
// IMPORTANT — this alone does not close the loop. The file must still
// be verified present in the actual deployed Vercel build, not just in
// this repo/ZIP — see the delivery report for exactly what could and
// could not be confirmed from this sandbox.
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
  full: { src: '/brand/logo-new.png', alt: "Teein' It Up — Golf Event App" },
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
    const fallbackSize = variant === 'full' ? Math.round((size ?? 320) * 0.22) : 15
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
  // file itself has been re-verified as a structurally valid PNG. With
  // the asset and the serving mechanism both checking out, the
  // remaining variable was next/image's own handling of this component —
  // so this renders the image the simplest possible way, with the fewest
  // unknowns left, to isolate whether the fault was ever really here.
  //
  // 30 Aug field-test bundle — sizing now matches the explicit
  // suggested treatment (70vw, capped 220-320px) instead of the
  // previous clamp(170px, 52vw, 640px), which both undersized it below
  // the requested minimum and allowed it to grow far larger than
  // wanted on bigger phones/tablets. The `size` prop, when explicitly
  // passed by a caller, still overrides the upper bound — this default
  // only applies when no caller-specific size is given (the auth
  // screen's own usage).
  const displayWidth = size ?? 320
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
        width: `clamp(220px, 70vw, ${displayWidth}px)`,
        height: 'auto',
        margin: '0 auto',
      }}
      onError={() => setFailed(true)}
    />
  )
}
