'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { positionText, type PublicBoard, type BoardStatus } from '@/lib/leaderboardShare/publicBoard'

// The public, read-only live leaderboard. Mobile first. Polls the public data
// endpoint every 30 seconds while the page is visible (and once when it becomes
// visible again). No login, no controls, nothing but standings.

const POLL_MS = 30000

const STATUS_STYLE: Record<BoardStatus, { bg: string; fg: string }> = {
  live: { bg: '#dcfce7', fg: '#166534' },
  round_complete: { bg: '#fdf3d9', fg: '#8a6a14' },
  final: { bg: '#e8c96a', fg: '#1a1a16' },
  not_started: { bg: '#e5e7eb', fg: '#374151' },
}

const shell: React.CSSProperties = { minHeight: '100dvh', background: '#faf9f6', fontFamily: 'var(--font-body), system-ui, sans-serif', color: '#1a1a16' }

export default function PublicLeaderboardView({ token, initial }: { token: string; initial: PublicBoard | null }) {
  const [board, setBoard] = useState<PublicBoard | null>(initial)
  const [gone, setGone] = useState(initial === null)
  const [stale, setStale] = useState(false)
  const [updatedText, setUpdatedText] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/l/${token}`, { cache: 'no-store' })
      if (res.status === 404) { setGone(true); return }
      if (!res.ok) { setStale(true); return }
      setBoard(await res.json())
      setGone(false); setStale(false)
    } catch { setStale(true) }
  }, [token])

  useEffect(() => {
    if (gone) return
    let cancelled = false
    const schedule = () => {
      if (cancelled) return
      timer.current = setTimeout(async () => {
        if (document.visibilityState === 'visible') await refresh()
        schedule()
      }, POLL_MS)
    }
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', onVisible)
    schedule()
    return () => { cancelled = true; if (timer.current) clearTimeout(timer.current); document.removeEventListener('visibilitychange', onVisible) }
  }, [gone, refresh])

  useEffect(() => {
    if (!board) return
    try { setUpdatedText(new Date(board.generatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })) } catch { setUpdatedText('') }
  }, [board])

  if (gone || !board) {
    return (
      <main style={{ ...shell, background: '#0f2d1c', color: '#faf6ed', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
        <h1 style={{ fontFamily: 'var(--font-display), serif', fontSize: 26, margin: '0 0 8px' }}>This leaderboard is no longer available</h1>
        <p style={{ opacity: 0.85, margin: 0 }}>The link may have been turned off by the organiser.</p>
      </main>
    )
  }

  const st = STATUS_STYLE[board.status]
  const multi = board.roundColumns.length > 0
  const showThru = board.status === 'live'

  return (
    <main style={shell}>
      <header style={{ background: '#0f2d1c', color: '#faf6ed', padding: '20px 16px 18px', textAlign: 'center' }}>
        <p style={{ margin: '0 0 6px', fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase', color: '#e8c96a', fontWeight: 700 }}>Teein&apos; It Up</p>
        <h1 style={{ fontFamily: 'var(--font-display), serif', fontSize: 24, lineHeight: 1.2, margin: '0 0 10px' }}>{board.eventName}</h1>
        <span style={{ display: 'inline-block', background: st.bg, color: st.fg, fontWeight: 800, fontSize: 12, letterSpacing: 0.6, padding: '4px 12px', borderRadius: 999 }}>
          {board.status === 'live' && <span aria-hidden="true" style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: '#16a34a', marginRight: 6 }} />}
          {board.statusLabel}
        </span>
        {board.roundLabel && <p style={{ margin: '8px 0 0', fontSize: 13, opacity: 0.85 }}>{board.roundLabel}</p>}
      </header>

      <div style={{ maxWidth: 640, margin: '0 auto', padding: '14px 12px 40px' }}>
        {board.rows.length === 0 ? (
          <p style={{ textAlign: 'center', color: '#6b6b60', padding: '32px 8px' }}>{board.note}</p>
        ) : (
          <div style={{ background: '#fff', border: '1px solid #eceae3', borderRadius: 14, overflow: 'hidden' }}>
            <div role="row" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', background: '#f6f3ea', fontSize: 11, fontWeight: 700, color: '#7a7260', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              <span style={{ width: 34 }}>Pos</span>
              <span style={{ flex: 1 }}>Player</span>
              {board.roundColumns.map(c => <span key={c.label} style={{ width: 34, textAlign: 'right' }}>{c.label}</span>)}
              <span style={{ width: 44, textAlign: 'right' }}>Pts</span>
            </div>
            {board.rows.map((r, i) => (
              <div key={`${i}-${r.name}`} role="row" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 12px', borderTop: i === 0 ? 'none' : '1px solid #f1efe8', background: r.position === 1 ? '#fffbeb' : '#fff' }}>
                <span style={{ width: 34, fontWeight: 800, color: r.position === 1 ? '#a1791f' : '#4b4b44' }}>{positionText(r)}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 700, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                  {showThru && r.thru && <span style={{ display: 'block', fontSize: 11.5, color: '#7a7260' }}>{r.thru}</span>}
                </span>
                {r.rounds.map((p, k) => <span key={k} style={{ width: 34, textAlign: 'right', fontSize: 13, color: '#6b6b60' }}>{p ?? '–'}</span>)}
                <span style={{ width: 44, textAlign: 'right', fontWeight: 800, fontSize: 17 }}>{r.total}</span>
              </div>
            ))}
          </div>
        )}

        {board.note && board.rows.length > 0 && <p style={{ fontSize: 12.5, color: '#6b6b60', margin: '12px 4px 0', lineHeight: 1.45 }}>{board.note}</p>}
        <p role="status" style={{ fontSize: 12, color: stale ? '#b45309' : '#9ca3af', margin: '8px 4px 0' }}>
          {stale ? 'Having trouble refreshing — showing the last scores we have.' : updatedText ? `Updated ${updatedText}${board.status === 'live' ? ' · refreshes automatically' : ''}` : ''}
        </p>

        <section style={{ marginTop: 28, padding: '18px 16px', background: '#0f2d1c', color: '#faf6ed', borderRadius: 14, textAlign: 'center' }}>
          <p style={{ margin: '0 0 4px', fontFamily: 'var(--font-display), serif', fontSize: 17 }}>Scored live with Teein&apos; It Up</p>
          <p style={{ margin: '0 0 12px', fontSize: 13, opacity: 0.85, lineHeight: 1.45 }}>The easy way to run golf days and trips with friends — scoring, leaderboards and memories in one place.</p>
          <a href="/" style={{ display: 'inline-block', background: '#e8c96a', color: '#1a1a16', fontWeight: 800, fontSize: 14, padding: '10px 18px', borderRadius: 10, textDecoration: 'none' }}>Discover the app</a>
        </section>
      </div>
    </main>
  )
}
