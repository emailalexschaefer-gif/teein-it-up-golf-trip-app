'use client'

/**
 * Event Schedule — the macro level of My Round's two-tier hierarchy.
 * Read-only by construction: no Begin Round, no Edit, no organiser
 * action of any kind exists anywhere in this file, unlike the
 * organiser's own RoundCard in TripRoundsTab.tsx which this deliberately
 * does not reuse directly (that component's actions aren't optional
 * extras to hide, they're built into its structure) — the visual
 * language (round-number badge, date/holes/format line, status pill
 * styling) is replicated instead, per "reuse... where safe."
 */
export interface ScheduleRound {
  id: string; name: string; status: string; play_date: string
  course_name: string | null; tee_time: string | null; tee_name: string | null
  holes: number | null; scoring_format: string | null
}

function statusLabel(round: ScheduleRound, isDefaultSelection: boolean): { text: string; bg: string; color: string; border: string } {
  if (round.status === 'active') return { text: 'LIVE', bg: '#dcfce7', color: '#166534', border: '#86efac' }
  if (round.status === 'completed') return { text: 'COMPLETE', bg: '#f0fdf4', color: '#166534', border: '#bbf7d0' }
  // Upcoming: "NEXT" only for the one round the automatic selection
  // rule would land on by default (item 8's exact behaviour table) —
  // every other upcoming round just reads "Upcoming", so a 3+ round
  // event doesn't show multiple "NEXT" labels at once.
  return isDefaultSelection
    ? { text: 'NEXT', bg: '#fdf3d9', color: '#a1791f', border: '#e8c96a' }
    : { text: 'Upcoming', bg: '#f8f4eb', color: '#7a7260', border: '#d9c9a3' }
}

export default function RoundSchedule({
  rounds, selectedRoundId, defaultRoundId, onSelect, interactive = true,
}: {
  rounds: ScheduleRound[]; selectedRoundId: string; defaultRoundId: string | null
  onSelect?: (roundId: string) => void
  // My HQ (a Server Component) renders this as a read-only status
  // display — Next.js doesn't allow passing function props from Server
  // to Client Components, so rather than route a fake handler through
  // that boundary, interactive=false makes the cards genuinely
  // non-interactive (no cursor: pointer, no onClick at all) whenever no
  // onSelect is actually usable. My Round (a Client Component) always
  // passes real state-setting behaviour and gets the fully interactive
  // version, unchanged.
  interactive?: boolean
}) {
  if (rounds.length === 0) return null

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: '#a1791f', marginBottom: 8 }}>
        Event Schedule
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rounds.map((round, i) => {
          const isSelected = round.id === selectedRoundId
          const label = statusLabel(round, round.id === defaultRoundId)
          const Card = interactive && onSelect ? 'button' : 'div'
          return (
            <Card
              key={round.id}
              {...(interactive && onSelect ? { onClick: () => onSelect(round.id) } : {})}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
                padding: '10px 12px', borderRadius: 12, cursor: interactive && onSelect ? 'pointer' : 'default',
                background: isSelected ? '#ffffff' : '#faf9f6',
                border: isSelected ? '2px solid #c9a84c' : '1px solid #eceae3',
                boxShadow: isSelected ? '0 2px 10px rgba(201,168,76,0.18)' : 'none',
              }}
            >
              <div style={{
                width: 34, height: 34, borderRadius: 9, flexShrink: 0,
                background: isSelected ? 'linear-gradient(135deg,#166534,#1a4731)' : 'linear-gradient(135deg,#0f2d1c,#1a4731)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'var(--font-display)', color: '#e8c96a', fontSize: 14, fontWeight: 700,
              }}>
                {i + 1}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                  <span style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, color: '#1a1a16' }}>{round.name}</span>
                  <span style={{
                    fontFamily: 'var(--font-body)', fontSize: 9.5, fontWeight: 800, letterSpacing: 0.4,
                    padding: '2px 8px', borderRadius: 20, flexShrink: 0,
                    background: label.bg, color: label.color, border: `1px solid ${label.border}`,
                  }}>
                    {label.text}
                  </span>
                </div>
                {round.course_name && (
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#7a7260', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {round.course_name}{round.tee_name ? ` · ${round.tee_name} Tees` : ''}
                  </div>
                )}
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, color: '#9ca3af', marginTop: 2 }}>
                  📅 {new Date(`${round.play_date}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}
                  {round.holes ? ` · ⛳ ${round.holes} holes` : ''}
                  {round.scoring_format ? ` · ${round.scoring_format.charAt(0).toUpperCase()}${round.scoring_format.slice(1)}` : ''}
                </div>
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
