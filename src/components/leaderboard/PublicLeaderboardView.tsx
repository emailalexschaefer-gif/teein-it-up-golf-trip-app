'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  positionText, medalOf, initialsOf, podiumRows, crownedRows, playerCountText, podiumCaption, statusSubtitle, NOT_RANKED_LABEL,
  type PublicBoard, type PublicBoardRow, type Medal,
} from '@/lib/leaderboardShare/publicBoard'
import { CROWN_POINTS, CROWN_BAND, CROWN_GOLD, CROWN_GOLD_DARK } from '@/lib/leaderboardShare/crown'

// The public, read-only live leaderboard. Mobile first. Polls the public data
// endpoint every 30 seconds while the page is visible (and once when it becomes
// visible again). No login, no controls, nothing but standings.

const POLL_MS = 30000
const TAGLINE = 'Run your next golf event like a pro.'

const MEDAL: Record<Medal, { bg: string; ring: string; chip: string; chipFg: string }> = {
  gold: { bg: 'linear-gradient(160deg,#fff3c4 0%,#f3d77a 100%)', ring: '#d4a62a', chip: '#d4a62a', chipFg: '#fff' },
  silver: { bg: 'linear-gradient(160deg,#f4f6f7 0%,#d3d8dc 100%)', ring: '#9aa3aa', chip: '#9aa3aa', chipFg: '#fff' },
  bronze: { bg: 'linear-gradient(160deg,#fbe6d2 0%,#e5b184 100%)', ring: '#b8733a', chip: '#b8733a', chipFg: '#fff' },
}

const CSS = `
@keyframes tiu-pulse { 0% { box-shadow: 0 0 0 0 rgba(74,222,128,.6) } 70% { box-shadow: 0 0 0 9px rgba(74,222,128,0) } 100% { box-shadow: 0 0 0 0 rgba(74,222,128,0) } }
.tiu-live-dot { animation: tiu-pulse 1.8s ease-out infinite }
@media (prefers-reduced-motion: reduce) { .tiu-live-dot { animation: none } }
@media (max-width: 460px) { .tiu-multi .tiu-av { display: none } }
.tiu-name { overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden }
`

function Crown({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="Champion" style={{ display: 'block' }}>
      <polygon points={CROWN_POINTS.map(p => p.join(',')).join(' ')} fill={CROWN_GOLD} stroke={CROWN_GOLD_DARK} strokeWidth="3" strokeLinejoin="round" />
      <rect x={CROWN_BAND.x} y={CROWN_BAND.y} width={CROWN_BAND.w} height={CROWN_BAND.h} rx="3" fill={CROWN_GOLD} stroke={CROWN_GOLD_DARK} strokeWidth="3" />
    </svg>
  )
}

function Avatar({ name, medal, size, crowned }: { name: string; medal: Medal | null; size: number; crowned?: boolean }) {
  return (
    <span style={{ position: 'relative', display: 'inline-flex', flex: 'none' }}>
      {crowned && <span style={{ position: 'absolute', left: '50%', top: -size * 0.58, transform: 'translateX(-50%)' }}><Crown size={size * 0.62} /></span>}
      <span aria-hidden="true" style={{
        width: size, height: size, borderRadius: 999, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: medal ? '#fff' : '#e1ece4', color: '#14532d', fontWeight: 800, fontSize: size * 0.38,
        border: `${medal ? 3 : 0}px solid ${medal ? MEDAL[medal].ring : 'transparent'}`, boxSizing: 'border-box',
      }}>{initialsOf(name)}</span>
    </span>
  )
}

function PodiumCard({ row, crowned, provisional }: { row: PublicBoardRow; crowned: boolean; provisional: boolean }) {
  const medal = medalOf(row.position) ?? 'bronze'
  const m = MEDAL[medal]
  return (
    <div style={{ background: m.bg, border: `1px solid ${m.ring}55`, borderRadius: 16, padding: '38px 8px 12px', textAlign: 'center', minWidth: 0, boxShadow: '0 2px 8px rgba(0,0,0,.08)' }}>
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 6, marginBottom: 8, position: 'relative' }}>
        <span aria-label={`Position ${positionText(row)}`} style={{ position: 'absolute', left: -2, top: -30, minWidth: 26, height: 26, borderRadius: 999, background: m.chip, color: m.chipFg, fontWeight: 800, fontSize: 13, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px' }}>{positionText(row)}</span>
        <Avatar name={row.name} medal={medal} size={52} crowned={crowned} />
      </div>
      <div className="tiu-name" style={{ fontWeight: 800, fontSize: 14, lineHeight: 1.2, minHeight: 34, color: '#1a1a16' }}>{row.name}</div>
      <div style={{ fontWeight: 900, fontSize: 21, marginTop: 4, color: '#1a1a16' }}>{row.total}<span style={{ fontSize: 11, fontWeight: 800, marginLeft: 3 }}>PTS</span></div>
      {provisional && <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: '#6b5d2a', marginTop: 2 }}>Provisional</div>}
    </div>
  )
}

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
    try { setUpdatedText(new Date(board.generatedAt).toLocaleString([], { hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short', year: 'numeric' })) } catch { setUpdatedText('') }
  }, [board])

  const page: React.CSSProperties = { minHeight: '100dvh', background: '#f4f1e8', fontFamily: 'var(--font-body), system-ui, sans-serif', color: '#1a1a16' }

  if (gone || !board) {
    return (
      <main style={{ ...page, background: '#0f2d1c', color: '#faf6ed', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/logo-new-720.png" alt="Teein' It Up" width={140} height={140} style={{ marginBottom: 16 }} />
        <h1 style={{ fontFamily: 'var(--font-display), serif', fontSize: 26, margin: '0 0 8px' }}>This leaderboard is no longer available</h1>
        <p style={{ opacity: 0.85, margin: 0 }}>The link may have been turned off by the organiser.</p>
      </main>
    )
  }

  const live = board.status === 'live'
  const final = board.status === 'final'
  const finished = final || board.status === 'ended_early'
  const showThru = live
  const podium = podiumRows(board)
  const crowned = new Set(crownedRows(board).map(r => r.name + '|' + r.position))
  const caption = podiumCaption(board)
  const pill = live
    ? { bg: 'rgba(22,163,74,.18)', fg: '#bbf7d0', border: 'rgba(74,222,128,.5)' }
    : finished ? { bg: '#e8c96a', fg: '#1a1a16', border: '#e8c96a' }
      : board.status === 'round_complete' ? { bg: 'rgba(232,201,106,.18)', fg: '#f3dd9a', border: 'rgba(232,201,106,.6)' }
        : { bg: 'rgba(255,255,255,.12)', fg: '#e5e7eb', border: 'rgba(255,255,255,.3)' }
  const sub = statusSubtitle(board)

  return (
    <main style={page}>
      <style>{CSS}</style>
      <header style={{ background: 'linear-gradient(180deg,#0b2416 0%,#14532d 100%)', color: '#faf6ed', padding: '20px 16px 22px', textAlign: 'center' }}>
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-new-720.png" alt="Teein' It Up golf event app" width={132} height={132} style={{ display: 'block', margin: '0 auto 4px', width: 132, height: 132 }} />
          <p style={{ margin: '0 0 14px', fontFamily: 'var(--font-display), Georgia, serif', fontStyle: 'italic', fontSize: 15, color: '#e8c96a' }}>{TAGLINE}</p>
          <h1 style={{ fontFamily: 'var(--font-display), Georgia, serif', fontSize: 'clamp(26px, 7vw, 40px)', lineHeight: 1.12, margin: '0 0 12px', overflowWrap: 'anywhere' }}>{board.eventName}</h1>
          <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 4, background: pill.bg, border: `1px solid ${pill.border}`, color: pill.fg, borderRadius: 14, padding: '8px 18px' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 900, fontSize: 15, letterSpacing: 1 }}>
              {live && <span className="tiu-live-dot" aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 999, background: '#4ade80', display: 'inline-block' }} />}
              {final && <span aria-hidden="true" style={{ display: 'inline-flex' }}><Crown size={18} /></span>}
              {board.statusLabel}
            </span>
            <span style={{ fontSize: 12.5, opacity: 0.92 }}>{sub}</span>
          </div>
          <p style={{ margin: '12px 0 0', fontSize: 13.5, opacity: 0.88 }}>{[board.roundLabel, playerCountText(board)].filter(Boolean).join('  ·  ')}</p>
        </div>
      </header>

      <div style={{ maxWidth: 760, margin: '0 auto', padding: '16px 12px 40px' }}>
        {board.rows.length === 0 ? (
          <p style={{ textAlign: 'center', color: '#6b6b60', padding: '32px 8px' }}>{board.note}</p>
        ) : (
          <>
            {podium.length > 0 && (
              <section aria-label={caption} style={{ marginBottom: 14 }}>
                <p style={{ margin: '0 4px 12px', fontSize: 12, fontWeight: 800, letterSpacing: 0.8, textTransform: 'uppercase', color: '#6b6b60' }}>{caption}</p>
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${podium.length}, minmax(0, 1fr))`, gap: 8, paddingTop: final ? 10 : 0 }}>
                  {podium.map((r, i) => <PodiumCard key={`${i}-${r.name}`} row={r} crowned={crowned.has(r.name + '|' + r.position)} provisional={!finished} />)}
                </div>
              </section>
            )}

            <div className={board.roundColumns.length > 0 ? 'tiu-multi' : ''} style={{ background: '#fff', border: '1px solid #e6e2d4', borderRadius: 16, overflow: 'hidden' }}>
              <div role="row" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 12px', background: '#f1ede0', fontSize: 11, fontWeight: 800, color: '#7a7260', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                <span style={{ width: 30 }}>Pos</span>
                <span style={{ flex: 1 }}>Player</span>
                {showThru && <span style={{ width: 44, textAlign: 'center' }}>Thru</span>}
                {board.roundColumns.map(c => <span key={c.label} style={{ width: 32, textAlign: 'right' }}>{c.label}</span>)}
                <span style={{ width: 44, textAlign: 'right' }}>Pts</span>
              </div>
              {board.rows.map((r, i) => {
                const medal = medalOf(r.position)
                const isCrowned = crowned.has(r.name + '|' + r.position)
                return (
                  <div key={`${i}-${r.name}`} role="row" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 12px', borderTop: i === 0 ? 'none' : '1px solid #f1efe8', background: medal === 'gold' && r.total > 0 ? '#fffbea' : '#fff' }}>
                    <span style={{ width: 30, fontWeight: 900, fontSize: 14, color: medal && r.total > 0 ? MEDAL[medal].ring : '#4b4b44' }}>{positionText(r)}</span>
                    <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 9 }}>
                      <span className="tiu-av" style={{ display: 'inline-flex' }}><Avatar name={r.name} medal={r.total > 0 ? medal : null} size={32} /></span>
                      <span style={{ minWidth: 0, fontWeight: 700, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                      {isCrowned && <span style={{ flex: 'none', display: 'inline-flex' }}><Crown size={20} /></span>}
                    </span>
                    {showThru && (
                      <span style={{ width: 44, textAlign: 'center' }}>
                        {r.thru && <span style={{ display: 'inline-block', fontSize: 11.5, fontWeight: 800, padding: '2px 8px', borderRadius: 999, background: r.thru === 'F' ? '#dcfce7' : '#f1efe8', color: r.thru === 'F' ? '#166534' : '#6b6b60' }}>{r.thru === 'F' ? 'F' : r.thru.replace('Thru ', '')}</span>}
                      </span>
                    )}
                    {r.rounds.map((p, k) => <span key={k} style={{ width: 32, textAlign: 'right', fontSize: 13, color: '#6b6b60' }}>{p ?? '–'}</span>)}
                    <span style={{ width: 44, textAlign: 'right', fontWeight: 900, fontSize: 17 }}>{r.total}</span>
                  </div>
                )
              })}
            </div>
          </>
        )}

        {(board.earlyNotes ?? []).map(n => <p key={n} style={{ fontSize: 12.5, color: '#7a5a00', margin: '12px 4px 0', lineHeight: 1.45, fontWeight: 600 }}>{n}</p>)}
        {board.notRanked && board.notRanked.length > 0 && (
          <div style={{ margin: '12px 4px 0', fontSize: 12.5, color: '#4b4b44', lineHeight: 1.5 }}>
            <strong>{NOT_RANKED_LABEL}</strong>
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{board.notRanked.map(n => <li key={n.name}>{n.name} &mdash; {n.total} pts</li>)}</ul>
          </div>
        )}
        {board.note && board.rows.length > 0 && <p style={{ fontSize: 12.5, color: '#6b6b60', margin: '12px 4px 0', lineHeight: 1.45 }}>{board.note}</p>}
        <p role="status" style={{ fontSize: 12, color: stale ? '#b45309' : '#7a7a70', margin: '8px 4px 0' }}>
          {stale ? 'Having trouble refreshing — showing the last scores we have.' : updatedText ? `Last updated ${updatedText}${live ? ' · refreshes automatically' : ''}` : ''}
        </p>

        <section style={{ marginTop: 28, padding: '22px 16px', background: 'linear-gradient(180deg,#0b2416 0%,#14532d 100%)', color: '#faf6ed', borderRadius: 16, textAlign: 'center' }}>
          <p style={{ margin: '0 0 2px', fontSize: 11.5, letterSpacing: 2.2, fontWeight: 800, color: '#e8c96a' }}>POWERED BY TEEIN&apos; IT UP</p>
          <p style={{ margin: '0 0 4px', fontSize: 12, letterSpacing: 1.6, opacity: 0.8 }}>SCORE · SHARE · CONNECT</p>
          <p style={{ margin: '10px 0 14px', fontSize: 13.5, opacity: 0.9, lineHeight: 1.45 }}>{TAGLINE} Scoring, leaderboards and memories in one place.</p>
          <Link href="/" style={{ display: 'inline-block', background: '#e8c96a', color: '#1a1a16', fontWeight: 800, fontSize: 14, padding: '11px 20px', borderRadius: 10, textDecoration: 'none' }}>Discover Teein&apos; It Up</Link>
        </section>
      </div>
    </main>
  )
}
