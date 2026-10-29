import type { BoardRanked, BoardUnranked } from '@/lib/ambrose/teamState'
import { card, h2, body, GREEN } from './styles'

// Team leaderboard (presentation only). Gross ranking only until the handicap rules are verified; ties share a position.
interface Props { ranked: BoardRanked[]; unranked: BoardUnranked[]; netNote: string | null; roundLabel: string }

export default function AmbroseLeaderboard({ ranked, unranked, netNote, roundLabel }: Props) {
  return (
    <section aria-label="Team leaderboard" style={card}>
      <h2 style={h2}>{roundLabel}</h2>
      <p style={body}>Ambrose · team gross score, lowest wins.</p>
      {ranked.length === 0 && <p style={{ ...body, marginTop: 10 }}>No team has finished all holes yet.</p>}
      <ol style={{ listStyle: 'none', margin: '8px 0 0', padding: 0 }}>
        {ranked.map(r => (
          <li key={r.entryId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: '1px solid #f1efe8' }}>
            <span style={{ width: 40, fontWeight: 800, color: GREEN, fontSize: 16 }}>{r.tied ? `T${r.rank}` : r.rank}</span>
            <span style={{ flex: 1 }}><span style={{ display: 'block', fontWeight: 700, fontSize: 15 }}>{r.name}</span>{r.members.length > 0 && <span style={{ display: 'block', fontSize: 12, color: '#6b6b60' }}>{r.members.join(', ')}</span>}</span>
            <span style={{ fontWeight: 800, fontSize: 18 }}>{r.gross}</span>
          </li>
        ))}
      </ol>
      {unranked.length > 0 && (
        <>
          <h3 style={{ ...h2, fontSize: 14, marginTop: 16 }}>Not yet ranked</h3>
          {unranked.map(u => (
            <div key={u.entryId} style={{ borderTop: '1px solid #f1efe8', padding: '8px 0' }}>
              <p style={{ ...body, color: '#1c1c17', fontWeight: 700 }}>{u.name} <span style={{ fontWeight: 500, color: '#6b6b60' }}>· thru {u.thru}</span></p>
              {u.members.length > 0 && <p style={{ ...body, fontSize: 12 }}>{u.members.join(', ')}</p>}
              <p style={body}>{u.reason}</p>
            </div>
          ))}
        </>
      )}
      {netNote && <p role="note" style={{ ...body, fontSize: 12, color: '#8a8a7c', margin: '12px 0 0' }}>{netNote}</p>}
    </section>
  )
}
