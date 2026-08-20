'use client'

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
          {player.profiles?.avatar_url ? (
            <img src={player.profiles.avatar_url} alt="" style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover', margin: '0 auto 12px' }} />
          ) : (
            <div style={{
              width: 72, height: 72, borderRadius: '50%', margin: '0 auto 12px',
              background: 'radial-gradient(#e8c96a,#c9a84c)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'var(--font-body)', fontWeight: 900, color: '#0f2d1c', fontSize: 24,
            }}>
              {initialsOf(player.profiles?.full_name ?? '?')}
            </div>
          )}
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 800, color: '#14532d' }}>
            {player.profiles?.full_name ?? 'Player'}
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
    </div>
  )
}
