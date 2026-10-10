'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

interface Highlight {
  category: string
  kind: 'maker' | 'breaker'
  scope: 'individual' | 'group'
  icon: string
  title: string
  playerId: string
  playerName: string
  statLine: string
  groupId?: string | null
  groupName?: string | null
  roster?: { playerId: string; playerName: string }[]
}

function GroupRoster({ highlight, index }: { highlight: Highlight; index: number }) {
  const [expanded, setExpanded] = useState(false)
  const groupLabel = highlight.groupName || `Playing Group ${index + 1}`
  const roster = highlight.roster ?? []
  return (
    <div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, color: '#14532d' }}>{groupLabel}</div>
      {roster.length > 0 && (
        <div style={{ marginTop: 2 }}>
          <button
            onClick={() => setExpanded(e => !e)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700, color: '#9ca3af', padding: 0 }}
          >
            Players ({roster.length}) {expanded ? '▴' : '▾'}
          </button>
          {expanded && (
            <div style={{ marginTop: 3, display: 'flex', flexDirection: 'column', gap: 1 }}>
              {roster.map(p => (
                <div key={p.playerId} style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: '#4a4638' }}>{p.playerName}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * 3 Sep field-test package, item 8 — "Round N Makers & Breakers"
 * beneath the round leaderboard, collapsed by default. Reads ONLY the
 * persisted, organiser-published selection (the exact same
 * /published-highlights GET route already used by My HQ's read-only
 * view and by My Golf) — never calls the candidate-generation
 * endpoint, so this can never regenerate or diverge from what the
 * organiser actually confirmed. Renders nothing at all if the round
 * hasn't been published yet (item 1's own privacy rule: unpublished
 * candidates are never shown to players) — no empty section, no
 * "not yet published" placeholder cluttering an in-progress round's
 * leaderboard.
 *
 * My HQ V2 (10 Oct) — Stage 4 fix: this used to collapse "no row yet"
 * and "row published with an empty highlights array" into the same
 * hidden-section outcome (`!publishedAt || highlights.length === 0`).
 * That made "reviewed, deliberately selected nothing" indistinguishable
 * from "not reviewed at all" everywhere this component was read,
 * including by My HQ's own workflow tracker. The fix is read-only and
 * client-side only — `publishedAt` is what means "reviewed"; an empty
 * `highlights` array is a genuine, intentional outcome, not an absent
 * one, and now renders its own short line instead of being hidden.
 */
export default function RoundHighlightsSection({
  tripId, roundId, roundName,
}: { tripId: string; roundId: string; roundName: string }) {
  const [expanded, setExpanded] = useState(false)

  const { data } = useQuery<{ publishedAt: string | null; highlights: Highlight[] }>({
    queryKey: ['published-highlights', tripId, roundId],
    queryFn: async () => {
      const res = await fetch(`/api/trips/${tripId}/rounds/${roundId}/published-highlights`)
      if (!res.ok) throw new Error('Could not load highlights.')
      return res.json()
    },
    staleTime: 60000, // published + locked — no reason to poll this like live scores
  })

  // publishedAt alone means "reviewed" — an empty highlights array is a
  // genuine reviewed-and-selected-none outcome, not an absent one.
  if (!data?.publishedAt) return null

  const hasHighlights = data.highlights.length > 0
  let groupIndex = -1

  return (
    <div style={{ marginTop: 10 }}>
      <button
        onClick={() => hasHighlights && setExpanded(e => !e)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
          background: '#fdf3d9', border: '1px solid #e8c96a', borderRadius: 12, padding: '10px 14px',
          cursor: hasHighlights ? 'pointer' : 'default',
        }}
      >
        <span style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, color: '#7a5c00' }}>
          {hasHighlights ? `🔥 ${roundName} Makers & Breakers (${data.highlights.length})` : `${roundName} Makers & Breakers`}
        </span>
        {hasHighlights && <span style={{ fontSize: 13, color: '#a1791f' }}>{expanded ? '▴' : '▾'}</span>}
      </button>

      {!hasHighlights && (
        <div style={{ marginTop: 6, fontFamily: 'var(--font-body)', fontSize: 12, color: '#7a7260' }}>
          Reviewed — no highlights selected
        </div>
      )}

      {expanded && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.highlights.map(h => {
            if (h.scope === 'group') groupIndex += 1
            return (
              <div key={h.category} style={{ background: '#fff', border: '1px solid #eceae3', borderRadius: 10, padding: '10px 12px' }}>
                <span style={{ fontSize: 10.5, fontWeight: 800, color: h.kind === 'maker' ? '#166534' : '#991b1b', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  {h.kind === 'maker' ? '⭐ Maker' : '💀 Breaker'}
                </span>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 4 }}>
                  <span style={{ fontSize: 17 }}>{h.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, color: '#1a1a16' }}>{h.title}</div>
                    {h.scope === 'group' ? (
                      <GroupRoster highlight={h} index={groupIndex} />
                    ) : (
                      <div style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#4a4638', fontWeight: 600 }}>{h.playerName}</div>
                    )}
                    <div style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: '#7a7260', marginTop: 2 }}>{h.statLine}</div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
