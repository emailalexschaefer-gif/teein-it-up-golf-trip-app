'use client'

import { useEffect } from 'react'

/**
 * Shared full-screen Moment media viewer — the one lightbox every surface
 * that shows a Moment thumbnail (My Round → My Moments, My HQ → The
 * Story, Chat) opens into, per the explicit "do not build separate
 * viewers" instruction. Reuses the moment's already-fetched signed
 * imageUrl — never re-uploads or re-fetches media itself.
 *
 * Video: the moments schema (migration 028) only has `image_path`, and
 * the `event-moments` storage bucket only accepts image/jpeg, image/png,
 * image/webp — there is no video capture, storage, or schema support
 * today. This viewer is shaped so it wouldn't need a rewrite if that
 * changes later (an optional `mediaType` prop, currently always
 * 'image'), but no video-specific UI is built now — there is nothing to
 * view. See delivery notes for this as a reported, not silently
 * fixed, architectural gap.
 *
 * Closing: a history entry is pushed when the viewer opens and popped on
 * close, so the Android/device Back gesture closes the viewer instead of
 * navigating away from the page underneath it — the caller's `onClose`
 * runs either way (X tap, backdrop tap, Escape, or Back), so "return to
 * exactly where the person was" falls out naturally: nothing about the
 * page underneath ever unmounts or navigates.
 */
export interface MomentViewerData {
  imageUrl: string | null
  caption: string | null
  playerName?: string | null
  holeNumber?: number | null
  createdAt?: string | null
  mediaType?: 'image' // reserved for future video support — see comment above
}

export default function MomentViewer({ moment, onClose }: { moment: MomentViewerData; onClose: () => void }) {
  useEffect(() => {
    // Push a history entry so Back closes the viewer rather than leaving
    // the page. Popping it back off (on unmount, or when the person
    // presses Back and the browser itself pops it) both funnel through
    // the same onClose — never a duplicate close, never a stray forward
    // history entry left behind.
    window.history.pushState({ momentViewer: true }, '')
    const handlePopState = () => onClose()
    window.addEventListener('popstate', handlePopState)

    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKey)

    return () => {
      window.removeEventListener('popstate', handlePopState)
      window.removeEventListener('keydown', handleKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open/close lifecycle only, deliberately not re-running on data changes
  }, [])

  function handleClose() {
    // If our pushed history entry is still the current one (the person
    // didn't already navigate away/Back past it some other way), pop it
    // so a subsequent real Back press doesn't land on a dead entry.
    // history.state is a plain object we control here, so this check is
    // safe rather than assuming position.
    if (window.history.state?.momentViewer) window.history.back()
    else onClose()
  }

  if (!moment.imageUrl) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Moment"
      onClick={handleClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 500,
        background: 'rgba(10,20,14,0.96)',
        display: 'flex', flexDirection: 'column',
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '10px 14px', flexShrink: 0 }}>
        <button
          onClick={(e) => { e.stopPropagation(); handleClose() }}
          aria-label="Close"
          style={{
            width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
            background: 'rgba(255,255,255,0.12)', border: 'none',
            color: '#fff', fontSize: 20, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          ✕
        </button>
      </div>

      <div
        onClick={(e) => e.stopPropagation()}
        style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 8px' }}
      >
        {/* object-fit: contain — preserves aspect ratio for both portrait
            and landscape media, never cropping (unlike the thumbnail
            grids elsewhere, which intentionally use object-fit: cover). */}
        {/* eslint-disable-next-line @next/next/no-img-element -- a signed Supabase Storage URL, not a static asset next/image can optimize */}
        <img
          src={moment.imageUrl}
          alt={moment.caption ?? 'Moment'}
          style={{ maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto', objectFit: 'contain', borderRadius: 6 }}
        />
      </div>

      {(moment.caption || moment.playerName || moment.holeNumber) && (
        <div onClick={(e) => e.stopPropagation()} style={{ padding: '14px 20px', flexShrink: 0, textAlign: 'center' }}>
          {moment.caption && (
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: '#fff', lineHeight: 1.4, marginBottom: 6 }}>
              {moment.caption}
            </p>
          )}
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: 'rgba(255,255,255,0.6)' }}>
            {moment.playerName}{moment.holeNumber ? ` · Hole ${moment.holeNumber}` : ''}
          </p>
        </div>
      )}
    </div>
  )
}
