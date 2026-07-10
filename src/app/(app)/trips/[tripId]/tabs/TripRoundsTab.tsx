'use client'

import type { TripData, RoundRow } from '../TripDetailClient'

type Tab = 'overview' | 'players' | 'groups' | 'rounds'
interface Props { trip: TripData; onTabChange: (t: Tab) => void }

export default function TripRoundsTab({ trip, onTabChange }: Props) {
  const sorted = [...trip.rounds].sort((a, b) => a.play_date.localeCompare(b.play_date))

  return (
    <div className="space-y-4">
      <p className="s-label">Schedule</p>

      {sorted.length === 0 ? (
        <div className="card p-8 text-center">
          <p style={{ fontSize: 32, marginBottom: 8 }}>📅</p>
          <p style={{ fontFamily: 'var(--font-body)', fontWeight: 600, color: '#1a1a16', marginBottom: 4 }}>No rounds configured</p>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#7a7260' }}>Rounds are added during trip creation. Edit the trip to add or change rounds.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map((round, i) => <RoundCard key={round.id} round={round} index={i} />)}
        </div>
      )}

      {/* ── Back/Next nav ────────────────────────────────────────────── */}
      <div className="flex gap-3 pt-2">
        <button onClick={() => onTabChange('groups')} style={{
          flex: 1, padding: '12px 16px', borderRadius: 12,
          background: '#f8f4eb', border: '1.5px solid #d9c9a3',
          fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: '#7a7260',
          cursor: 'pointer',
        }}>← Groups</button>
        {trip.status === 'groups_ready' && (
          <div style={{ flex: 2, padding: '12px 16px', borderRadius: 12, background: 'linear-gradient(135deg, #c9a84c, #e8c96a)', textAlign: 'center' }}>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, color: '#0f2d1c' }}>Ready to start</p>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: 'rgba(15,45,28,0.65)', marginTop: 1 }}>Mark Ready from Overview</p>
          </div>
        )}
      </div>
    </div>
  )
}

function RoundCard({ round, index }: { round: RoundRow; index: number; key?: string }) {
  const isLive = round.status === 'active'
  return (
    <div className="card overflow-hidden" style={{ borderColor: isLive ? '#86efac' : '#d9c9a3' }}>
      {isLive && (
        <div style={{ background: '#1a4731', padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#e8c96a', display: 'inline-block' }} />
          <span style={{ fontFamily: 'var(--font-body)', color: '#e8c96a', fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>Round in progress</span>
        </div>
      )}
      <div className="flex items-start gap-4 p-4">
        <div style={{
          width: 44, height: 44, borderRadius: 12, flexShrink: 0,
          background: 'linear-gradient(135deg, #0f2d1c, #1a4731)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ fontFamily: 'var(--font-display)', color: '#e8c96a', fontSize: 18, fontWeight: 700, lineHeight: 1 }}>{index + 1}</span>
          <span style={{ fontFamily: 'var(--font-body)', color: 'rgba(232,201,106,0.5)', fontSize: 8, letterSpacing: 0.5, textTransform: 'uppercase' }}>Round</span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="flex items-center justify-between gap-2 mb-1">
            <p style={{ fontFamily: 'var(--font-body)', fontWeight: 700, color: '#1a1a16', fontSize: 14 }}>{round.name}</p>
            <span style={{
              fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 600,
              padding: '2px 8px', borderRadius: 20,
              background: isLive ? '#dcfce7' : '#f8f4eb',
              color: isLive ? '#166534' : '#7a7260',
              border: `1px solid ${isLive ? '#86efac' : '#d9c9a3'}`,
              flexShrink: 0,
            }}>
              {round.status === 'active' ? 'Live' : round.status === 'completed' ? 'Done' : 'Upcoming'}
            </span>
          </div>
          {round.course_name && (
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600, color: '#3d3929', marginBottom: 4 }}>{round.course_name}</p>
          )}
          <div className="flex items-center gap-3 flex-wrap" style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#7a7260' }}>
            <span>📅 {new Date(round.play_date + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
            {round.tee_time && <span>⏱ {round.tee_time}</span>}
            <span>⛳ {round.holes} holes</span>
            <span style={{ textTransform: 'capitalize' }}>{round.scoring_format.replace('_', ' ')}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
