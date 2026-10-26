'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { InlineScorecard, type LeaderboardEntry, type LeaderboardResponse } from './LiveLeaderboard'
import { canShowRoundResults, findMyRow, incompleteLabel } from '@/lib/scoring/roundResultsView'
import { formatGolfHandicap } from '@/lib/scoring/handicapDisplay'

/**
 * My Golf — revisit a completed round. Strictly read-only: it only GETs the
 * existing round leaderboard route and renders the existing InlineScorecard.
 * Score corrections stay in My HQ Score Management. Shows THIS round's
 * standings (data.board), never cumulative event points.
 */
type Panel = 'none' | 'leaderboard' | 'mine'

function ScorecardBlock({ row, totalHoles }: { row: LeaderboardEntry; totalHoles: number }) {
  const note = incompleteLabel(row, totalHoles)
  return (
    <div style={{ borderTop: '1px solid #f3f4f1' }}>
      <div style={{ padding: '10px 14px 0', background: '#faf9f6', fontFamily: 'var(--font-body)', fontSize: 12, color: '#6b7280', display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
        <span>Playing handicap this round: <strong style={{ color: '#14532d' }}>{row.handicap}</strong></span>
        <span>Points: <strong style={{ color: '#14532d' }}>{row.totalPts}</strong></span>
        {note && <span style={{ color: '#a1791f', fontWeight: 700 }}>{note}</span>}
      </div>
      <InlineScorecard row={row} totalHoles={totalHoles} />
    </div>
  )
}

export default function CompletedRoundResults({ tripId, roundId, roundName, roundStatus }: {
  tripId: string; roundId: string; roundName: string; roundStatus: string
}) {
  const [panel, setPanel] = useState<Panel>('none')
  const [openId, setOpenId] = useState<string | null>(null)
  const enabled = canShowRoundResults(roundStatus) && panel !== 'none'
  const { data, isLoading, isError } = useQuery<LeaderboardResponse>({
    queryKey: ['round-results', tripId, roundId],
    queryFn: async () => {
      const res = await fetch(`/api/trips/${tripId}/rounds/${roundId}/leaderboard`)
      if (!res.ok) throw new Error('Could not load results.')
      return res.json()
    },
    enabled, staleTime: 60000,
  })
  if (!canShowRoundResults(roundStatus)) return null

  const btn = (active: boolean) => ({
    flex: '1 1 140px', minHeight: 44, padding: '10px 12px', borderRadius: 12, cursor: 'pointer',
    fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13,
    border: '1.5px solid #14532d', background: active ? '#14532d' : '#fff', color: active ? '#fff' : '#14532d',
  } as const)
  const toggle = (p: Panel) => { setPanel(cur => (cur === p ? 'none' : p)); setOpenId(null) }
  const hasBoard = !!data && Array.isArray(data.board) && !data.isPractice
  const mine: LeaderboardEntry | null = hasBoard ? findMyRow<LeaderboardEntry>(data!.board) : null

  return (
    <div style={{ background: '#fff', border: '1px solid #eceae3', borderRadius: 14, padding: 14, marginBottom: 16, boxShadow: '0 2px 12px rgba(0,0,0,0.05)' }}>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 15, color: '#14532d' }}>{roundName} Results</div>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#7a7260', margin: '2px 0 10px' }}>Leaderboard and player scorecards</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button type="button" aria-expanded={panel === 'leaderboard'} onClick={() => toggle('leaderboard')} style={btn(panel === 'leaderboard')}>View {roundName} Leaderboard</button>
        <button type="button" aria-expanded={panel === 'mine'} onClick={() => toggle('mine')} style={btn(panel === 'mine')}>View My Scorecard</button>
      </div>
      {panel === 'none' && (
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: '#9ca3af', margin: '8px 0 0' }}>Select a player on the leaderboard to view their hole-by-hole scorecard.</p>
      )}
      {panel !== 'none' && isLoading && <p style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#9ca3af', margin: '10px 0 0' }}>Loading…</p>}
      {panel !== 'none' && isError && <p role="alert" style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#9b1c1c', margin: '10px 0 0' }}>Couldn&apos;t load this round&apos;s results right now. Please try again.</p>}
      {panel !== 'none' && data && !hasBoard && (
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#9ca3af', margin: '10px 0 0' }}>No results are available for this round.</p>
      )}

      {panel === 'leaderboard' && hasBoard && (
        data!.board.length === 0
          ? <p style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#9ca3af', margin: '10px 0 0' }}>No scores were recorded for this round.</p>
          : (
            <div style={{ marginTop: 10, border: '1px solid #eceae3', borderRadius: 12, overflow: 'hidden' }}>
              {data!.board.map((row, i) => {
                const open = openId === row.playerId
                const note = incompleteLabel(row, data!.totalHoles)
                return (
                  <div key={row.playerId} style={{ borderTop: i === 0 ? 'none' : '1px solid #f3f4f1' }}>
                    <button type="button" aria-expanded={open} onClick={() => setOpenId(open ? null : row.playerId)}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 48, padding: '8px 12px', textAlign: 'left', background: row.isCurrentUser ? '#fdf9ec' : '#fff', border: 'none', cursor: 'pointer' }}>
                      <span style={{ width: 24, fontFamily: 'var(--font-display)', fontWeight: 800, color: '#14532d', flexShrink: 0 }}>{row.position}</span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13.5, color: '#1a1a16', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {row.name}{row.isCurrentUser ? ' (you)' : ''}
                        </span>
                        <span style={{ display: 'block', fontFamily: 'var(--font-body)', fontSize: 11, color: note ? '#a1791f' : '#9ca3af' }}>
                          {note ?? `HCP ${formatGolfHandicap(row.handicap)}`}
                        </span>
                      </span>
                      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 16, color: '#14532d', flexShrink: 0 }}>{row.totalPts}<span style={{ fontSize: 10, fontWeight: 700, color: '#a1791f' }}> pts</span></span>
                      <span aria-hidden style={{ color: '#9ca3af', flexShrink: 0 }}>{open ? '▴' : '▾'}</span>
                    </button>
                    {open && <ScorecardBlock row={row} totalHoles={data!.totalHoles} />}
                  </div>
                )
              })}
            </div>
          )
      )}

      {panel === 'mine' && hasBoard && (
        mine
          ? <div style={{ marginTop: 10, border: '1px solid #eceae3', borderRadius: 12, overflow: 'hidden' }}><ScorecardBlock row={mine} totalHoles={data!.totalHoles} /></div>
          : <p style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#9ca3af', margin: '10px 0 0' }}>You don&apos;t have a scorecard in this round.</p>
      )}
    </div>
  )
}
