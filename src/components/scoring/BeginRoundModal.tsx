'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getDefaultHoles, resolvePlayingHandicap } from '@/lib/scoring/defaultHoles'
import type { HoleTemplate } from '@/lib/scoring/defaultHoles'

interface Player {
  profile_id: string
  full_name:  string
  playing_handicap: number | null
  profile_handicap: number | null
}

interface Group {
  id:       string
  name:     string
  tee_time: string | null
  players:  Player[]
}

interface Props {
  tripId:    string
  roundId:   string
  roundName: string
  courseName: string | null
  holeCount: 9 | 18
  teeTime:   string | null
  playDate:  string
  groups:    Group[]
  onClose:   () => void
}

type Stage = 'review' | 'holes' | 'confirm' | 'starting'

export default function BeginRoundModal({
  tripId, roundId, roundName, courseName, holeCount,
  teeTime, playDate, groups, onClose,
}: Props) {
  const router = useRouter()
  const [stage, setStage]   = useState<Stage>('review')
  const [holes, setHoles]   = useState<HoleTemplate[]>(() => getDefaultHoles(holeCount))
  const [error, setError]   = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  // Validation
  const allPlayersHaveHandicap = groups.every(g =>
    g.players.every(p => resolvePlayingHandicap(p.playing_handicap, p.profile_handicap) !== null)
  )
  const allGroupsHavePlayers = groups.every(g => g.players.length > 0)
  const hasGroups = groups.length > 0
  const totalPlayers = groups.reduce((sum, g) => sum + g.players.length, 0)

  const canBegin = hasGroups && allGroupsHavePlayers && allPlayersHaveHandicap

  async function handleBegin() {
    setStarting(true); setError(null)
    try {
      const res = await fetch(`/api/trips/${tripId}/rounds/${roundId}/start`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ holes }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? "We couldn't begin the round. Please try again.")
        setStarting(false)
        setStage('confirm')
        return
      }
      // Navigate to the active round shell
      router.push(`/trips/${tripId}/rounds/${roundId}`)
      router.refresh()
    } catch {
      setError("We couldn't begin the round. Please try again.")
      setStarting(false)
      setStage('confirm')
    }
  }

  function updateHole(idx: number, field: 'par' | 'stroke_index', val: number) {
    setHoles((prev: HoleTemplate[]) => prev.map((h: HoleTemplate, i: number) => i === idx ? { ...h, [field]: val } : h))
  }

  const formattedDate = new Date(playDate + 'T00:00:00')
    .toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(15,45,28,0.85)', backdropFilter: 'blur(3px)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      padding: '0 0 0 0',
    }}>
      <div style={{
        width: '100%', maxWidth: 480,
        background: '#f8f4eb',
        borderRadius: '20px 20px 0 0',
        maxHeight: '94vh', overflowY: 'auto',
        boxShadow: '0 -8px 40px rgba(0,0,0,0.4)',
      }}>
        {/* Header */}
        <div style={{
          background: 'linear-gradient(135deg, #0f2d1c, #1a4731)',
          borderBottom: '2px solid #c9a84c',
          padding: '20px 20px 16px',
          borderRadius: '20px 20px 0 0',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <p style={{ fontFamily: 'var(--font-body)', color: 'rgba(245,230,184,0.6)', fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 3 }}>
                {stage === 'holes' ? 'Hole Setup' : 'Begin Round'}
              </p>
              <h2 style={{ fontFamily: 'var(--font-display)', color: '#ffffff', fontSize: 22, fontWeight: 800, margin: 0 }}>
                {roundName}
              </h2>
            </div>
            <button type="button" onClick={onClose} style={{
              background: 'rgba(255,255,255,0.1)', border: 'none',
              borderRadius: 8, padding: '6px 12px', cursor: 'pointer',
              fontFamily: 'var(--font-body)', color: 'rgba(245,230,184,0.7)', fontSize: 13,
            }}>✕</button>
          </div>
          {/* Stage progress dots */}
          <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
            {(['review', 'holes', 'confirm'] as Stage[]).map(s => (
              <div key={s} style={{
                flex: 1, height: 3, borderRadius: 2,
                background: stage === s || (stage === 'starting' && s === 'confirm') || (s === 'review' && (stage === 'holes' || stage === 'confirm' || stage === 'starting')) || (s === 'holes' && (stage === 'confirm' || stage === 'starting'))
                  ? '#c9a84c' : 'rgba(201,168,76,0.25)',
                transition: 'background 0.2s',
              }} />
            ))}
          </div>
        </div>

        <div style={{ padding: '20px' }}>

          {/* ── Stage 1: Review ─────────────────────────────────────────── */}
          {stage === 'review' && (
            <>
              {/* Round info */}
              {(() => {
                const groupTimes = groups.map(g => g.tee_time).filter(Boolean).sort() as string[]
                const teeTimeDisplay = groupTimes.length === 0 ? 'TBC'
                  : groupTimes.length === 1 ? groupTimes[0]
                  : `${groupTimes[0]}–${groupTimes[groupTimes.length - 1]}`
                const detailRows = [
                  ['📅 Date', formattedDate],
                  ['⏱ First tee', teeTimeDisplay],
                  ['⛳ Holes', String(holeCount)],
                  ['🏆 Format', 'Stableford'],
                  ...(courseName ? [['📍 Course', courseName]] : []),
                ]
                return (
                  <div className="card p-4 mb-4" style={{ marginBottom: 14 }}>
                    <p className="s-label mb-2">Round Details</p>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      {detailRows.map(([label, val]) => (
                        <div key={label}>
                          <p style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: '#7a7260', fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 2 }}>{label}</p>
                          <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: '#1a1a16' }}>{val}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })()}

              {/* Groups & players */}
              <p className="s-label mb-2" style={{ marginBottom: 8 }}>Playing Groups</p>

              {!hasGroups && (
                <Warning>No playing groups have been set up. Return to the Groups tab to create groups and assign players.</Warning>
              )}

              {groups.map(g => {
                const missingHcp = g.players.filter(p => resolvePlayingHandicap(p.playing_handicap, p.profile_handicap) === null)
                return (
                  <div key={g.id} style={{
                    background: '#ffffff', border: '1.5px solid #d9c9a3',
                    borderRadius: 12, padding: '12px 14px', marginBottom: 10,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, color: '#1a4731' }}>{g.name}</span>
                      {g.tee_time && (
                        <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#c9a84c', fontWeight: 700, background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.3)', borderRadius: 6, padding: '2px 8px' }}>
                          ⏱ {g.tee_time}
                        </span>
                      )}
                    </div>
                    {g.players.length === 0 ? (
                      <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#b45309' }}>⚠ No players assigned to this group.</p>
                    ) : (
                      g.players.map(p => {
                        const hcp = resolvePlayingHandicap(p.playing_handicap, p.profile_handicap)
                        return (
                          <div key={p.profile_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0', marginBottom: 4 }}>
                            <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#1a1a16', fontWeight: 500 }}>{p.full_name}</span>
                            {hcp !== null ? (
                              <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#7a7260', background: '#f2e8d0', borderRadius: 6, padding: '2px 8px' }}>HCP {hcp}</span>
                            ) : (
                              <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#b91c1c', fontWeight: 600 }}>⚠ No handicap</span>
                            )}
                          </div>
                        )
                      })
                    )}
                    {missingHcp.length > 0 && (
                      <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#b45309', marginTop: 6 }}>
                        Confirm a playing handicap for {missingHcp.map(p => p.full_name).join(', ')} in the Players tab.
                      </p>
                    )}
                  </div>
                )
              })}

              <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => setStage('holes')} style={btnStyle('secondary')}>
                  Review Holes →
                </button>
                <button type="button" onClick={onClose} style={btnStyle('ghost')}>Cancel</button>
              </div>
            </>
          )}

          {/* ── Stage 2: Holes ──────────────────────────────────────────── */}
          {stage === 'holes' && (
            <>
              <div style={{ background: '#fdf8ee', border: '1px solid #e8d98a', borderRadius: 10, padding: '10px 14px', marginBottom: 14 }}>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#7a5c00' }}>
                  <strong>Default hole template loaded.</strong> Review and adjust each hole's par and stroke index to match your course before continuing.
                </p>
              </div>

              {/* Hole table */}
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-body)', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#1a4731' }}>
                      {['Hole', 'Par', 'SI'].map(h => (
                        <th key={h} style={{ color: '#e8c96a', fontWeight: 700, padding: '8px 6px', textAlign: 'center', fontSize: 11, letterSpacing: 0.5 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {holes.map((hole: HoleTemplate, idx: number) => (
                      <tr key={hole.hole_number} style={{ background: idx % 2 === 0 ? '#f8f4eb' : '#ffffff' }}>
                        <td style={{ padding: '6px', textAlign: 'center', fontWeight: 700, color: '#1a4731' }}>{hole.hole_number}</td>
                        <td style={{ padding: '4px 2px', textAlign: 'center' }}>
                          <select
                            value={hole.par}
                            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updateHole(idx, 'par', parseInt(e.target.value))}
                            style={{ border: '1px solid #d9c9a3', borderRadius: 6, padding: '4px 6px', background: '#fff', fontFamily: 'var(--font-body)', fontSize: 13, width: 56, textAlign: 'center' }}
                          >
                            {[3, 4, 5, 6].map(p => <option key={p} value={p}>{p}</option>)}
                          </select>
                        </td>
                        <td style={{ padding: '4px 2px', textAlign: 'center' }}>
                          <select
                            value={hole.stroke_index}
                            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updateHole(idx, 'stroke_index', parseInt(e.target.value))}
                            style={{ border: '1px solid #d9c9a3', borderRadius: 6, padding: '4px 6px', background: '#fff', fontFamily: 'var(--font-body)', fontSize: 13, width: 56, textAlign: 'center' }}
                          >
                            {Array.from({ length: holeCount }, (_, i) => i + 1).map(si => (
                              <option key={si} value={si}>{si}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => setStage('confirm')} disabled={!canBegin} style={btnStyle(canBegin ? 'primary' : 'disabled')}>
                  Review & Confirm →
                </button>
                <button type="button" onClick={() => setStage('review')} style={btnStyle('ghost')}>← Back</button>
              </div>

              {!canBegin && (
                <Warning>
                  {!hasGroups ? 'No playing groups exist.' :
                    !allGroupsHavePlayers ? 'One or more groups have no players.' :
                    !allPlayersHaveHandicap ? 'One or more players are missing a handicap.' : ''}
                </Warning>
              )}
            </>
          )}

          {/* ── Stage 3: Confirm ────────────────────────────────────────── */}
          {(stage === 'confirm' || stage === 'starting') && (
            <>
              <div style={{ background: '#f0fdf4', border: '1.5px solid #86efac', borderRadius: 12, padding: '14px 16px', marginBottom: 14 }}>
                <p style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: '#166534', marginBottom: 4 }}>Ready to begin</p>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#166534' }}>
                  {holeCount} holes · {totalPlayers} players · Stableford
                </p>
              </div>

              {/* Summary */}
              {groups.map(g => (
                <div key={g.id} style={{ marginBottom: 10 }}>
                  <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700, color: '#7a7260', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 4 }}>
                    {g.name}{g.tee_time ? ` · ⏱ ${g.tee_time}` : ''}
                  </p>
                  {g.players.map(p => {
                    const hcp = resolvePlayingHandicap(p.playing_handicap, p.profile_handicap)
                    return (
                      <div key={p.profile_id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #f2e8d0' }}>
                        <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#1a1a16' }}>{p.full_name}</span>
                        <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#7a7260', fontWeight: 600 }}>HCP {hcp}</span>
                      </div>
                    )
                  })}
                </div>
              ))}

              {error && <Warning>{error}</Warning>}

              <div style={{ marginTop: 16, display: 'flex', gap: 8, flexDirection: 'column' }}>
                <button
                  type="button"
                  onClick={starting ? undefined : handleBegin}
                  disabled={starting}
                  style={{ ...btnStyle(starting ? 'disabled' : 'gold'), cursor: starting ? 'not-allowed' : 'pointer' }}
                >
                  {starting ? 'Beginning round…' : 'Confirm & Begin Round'}
                </button>
                <button type="button" onClick={() => setStage('holes')} style={btnStyle('ghost')} disabled={starting}>← Edit holes</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Warning({ children }: { children?: React.ReactNode }) {
  return (
    <div style={{
      background: '#fef9ec', border: '1px solid #f5c842',
      borderRadius: 10, padding: '10px 14px', marginTop: 10,
      fontFamily: 'var(--font-body)', fontSize: 12, color: '#7a5c00',
    }}>
      ⚠ {children}
    </div>
  )
}

function btnStyle(variant: 'primary' | 'secondary' | 'ghost' | 'gold' | 'disabled'): React.CSSProperties {
  const base: React.CSSProperties = {
    flex: 1, padding: '13px 18px', borderRadius: 12, border: 'none',
    fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700,
    cursor: variant === 'disabled' ? 'not-allowed' : 'pointer',
    transition: 'all 0.15s', textAlign: 'center',
  }
  if (variant === 'primary')   return { ...base, background: 'linear-gradient(135deg, #2d7a52, #1a4731)', color: '#ffffff', boxShadow: '0 3px 12px rgba(26,71,49,0.35)' }
  if (variant === 'gold')      return { ...base, background: 'linear-gradient(135deg, #c9a84c, #e8c96a, #c9a84c)', color: '#0f2d1c', boxShadow: '0 4px 16px rgba(201,168,76,0.45)' }
  if (variant === 'secondary') return { ...base, background: '#f2e8d0', color: '#1a4731', border: '1.5px solid #d9c9a3' }
  if (variant === 'disabled')  return { ...base, background: '#d9c9a3', color: '#7a7260', opacity: 0.7 }
  return { ...base, background: 'transparent', color: '#7a7260', fontWeight: 500 }
}
