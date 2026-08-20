'use client'

import { useState } from 'react'

/**
 * Shared player profile modal — extracted from PlayerHomeCard.tsx
 * unchanged (same fields, same layout, same mobile safe-area/scroll
 * handling) so every surface that shows a tappable player row —
 * PlayerHomeCard's own roster/Starting Grid, The Field, and Live
 * Leaderboard — opens the exact same profile experience rather than
 * three subtly different ones. Per the explicit "do not create another
 * profile component" instruction, this is the ONE implementation now;
 * PlayerHomeCard.tsx imports it from here instead of defining its own
 * local copy.
 *
 * P1 (Deployment B) — photo substantially enlarged (72px -> 120px) for
 * the Lobby's social/recognition purpose, and now tappable to open a
 * simple full-screen lightbox. Kept deliberately simple per "do not
 * over-engineer it" — no pinch-zoom or pan, just a large view and a
 * close tap, using the same zIndex: 200 convention already established
 * for full-screen overlays elsewhere in this app (ImageCropper) so it
 * correctly sits above this modal's own zIndex: 50.
 */
export interface PlayerCardData {
  profiles: { full_name: string; avatar_url: string | null; handicap?: number | null; golf_club?: string | null; occupation?: string | null } | null
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0][0]?.toUpperCase() ?? '?'
  return ((parts[0][0] ?? '') + (parts[parts.length - 1][0] ?? '')).toUpperCase()
}

export default function PlayerCardModal({ player, onClose }: { player: PlayerCardData; onClose: () => void }) {
  const [showLightbox, setShowLightbox] = useState(false)
  const avatarUrl = player.profiles?.avatar_url
  const name = player.profiles?.full_name ?? 'Player'

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 50, display: 'flex', alignItems: 'flex-end' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#faf6ed', borderRadius: '20px 20px 0 0', padding: '24px 20px',
          paddingBottom: 'calc(90px + env(safe-area-inset-bottom, 0px))',
          width: '100%', maxWidth: 540, margin: '0 auto', boxShadow: '0 -4px 32px rgba(0,0,0,0.18)',
          maxHeight: '85dvh', overflowY: 'auto',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          {avatarUrl ? (
            <button
              onClick={() => setShowLightbox(true)}
              aria-label={`View ${name}'s photo full-size`}
              style={{ padding: 0, border: 'none', background: 'none', cursor: 'pointer', display: 'block', margin: '0 auto 12px' }}
            >
              <img src={avatarUrl} alt="" style={{ width: 120, height: 120, borderRadius: '50%', objectFit: 'cover', display: 'block' }} />
            </button>
          ) : (
            <div style={{
              width: 120, height: 120, borderRadius: '50%', margin: '0 auto 12px',
              background: 'radial-gradient(#e8c96a,#c9a84c)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'var(--font-body)', fontWeight: 900, color: '#0f2d1c', fontSize: 38,
            }}>
              {initialsOf(name)}
            </div>
          )}
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 800, color: '#14532d' }}>
            {name}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 10, fontFamily: 'var(--font-body)', fontSize: 13, color: '#7a7260' }}>
            {player.profiles?.handicap != null && <div>🏌️ Handicap {player.profiles.handicap}</div>}
            {player.profiles?.golf_club && <div>⛳ {player.profiles.golf_club}</div>}
            {player.profiles?.occupation && <div>💼 {player.profiles.occupation}</div>}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            display: 'block', width: '100%', marginTop: 18, padding: 11, borderRadius: 10,
            background: '#f3f4f6', border: '1px solid #d1d5db', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, cursor: 'pointer',
          }}
        >
          Close
        </button>
      </div>

      {showLightbox && avatarUrl && (
        <div
          onClick={e => { e.stopPropagation(); setShowLightbox(false) }}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', zIndex: 200,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
          }}
        >
          <img
            src={avatarUrl} alt=""
            style={{ maxWidth: '100%', maxHeight: '80vh', borderRadius: 12, objectFit: 'contain' }}
          />
          <button
            onClick={e => { e.stopPropagation(); setShowLightbox(false) }}
            aria-label="Close photo"
            style={{
              position: 'absolute', top: 'calc(20px + env(safe-area-inset-top, 0px))', right: 20,
              width: 38, height: 38, borderRadius: '50%', background: 'rgba(255,255,255,0.15)', border: 'none',
              color: '#fff', fontSize: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
