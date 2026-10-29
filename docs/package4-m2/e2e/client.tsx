import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import AmbroseOrganiserContainer from '@/components/ambrose/AmbroseOrganiserContainer'
import AmbroseScorerContainer from '@/components/ambrose/AmbroseScorerContainer'
import AmbroseLeaderboardContainer from '@/components/ambrose/AmbroseLeaderboardContainer'
import AmbroseHQSection from '@/components/ambrose/AmbroseHQSection'
import AmbrosePlayerSection from '@/components/ambrose/AmbrosePlayerSection'

const TRIP = '10000000-0000-0000-0000-000000000001'
const NAMES = ['Alex Ford','Daz Hill','Sam Reid','Jo Park','Lee Chan','Kim Ng','Pat Doyle','Max Tran','Ivy Cole','Ben Ashe','Zoe Lim','Tom Bell','Amy Fox','Ray Moss','Eve Hart','Ned Pike']
const pid = (n: number) => `b0000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`
const players = Object.fromEntries(NAMES.map((n, i) => [pid(i + 1), { id: pid(i + 1), name: n, handicap: [8, 14, 20, 26][i % 4] }]))
const groups = [1, 2, 3, 4].map(g => ({ groupId: `60000000-0000-0000-0000-00000000000${g}`, groupName: `Group ${g}`, playerIds: [1, 2, 3, 4].map(k => pid((g - 1) * 4 + k)) }))

// The same section My HQ mounts (the real component); My HQ itself cannot be mounted here (no Next.js / React Query in this sandbox).
function HQ({ roundId }: { roundId: string }) {
  const [status, setStatus] = useState<string | null>(null)
  useEffect(() => { const f = async () => { const r = await fetch(`/api/team-state?round_id=${roundId}`); if (r.ok) setStatus((await r.json()).state.round.status) }; void f(); const t = setInterval(f, 2500); return () => clearInterval(t) }, [roundId])
  if (!status) return null
  return <AmbroseHQSection tripId={TRIP} roundId={roundId} roundName={roundId.endsWith('09') ? 'Nine-hole round' : 'Round 1'} roundStatus={status} onClosed={() => { (window as unknown as { __closed: boolean }).__closed = true }} />
}

function App() {
  const [h, setH] = useState(location.hash.slice(1))
  useEffect(() => { const f = () => setH(location.hash.slice(1)); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f) }, [])
  const [kind, round] = h.split(':')
  const roundId = `20000000-0000-0000-0000-0000000000${round === '9' ? '09' : round === '2' ? '02' : '18'}`
  return <div style={{ maxWidth: 420, margin: '0 auto', padding: 16, background: '#faf9f4', fontFamily: 'sans-serif' }}>
    {kind === 'organiser' && <AmbroseOrganiserContainer roundId={roundId} tripId={TRIP} groups={groups} players={players} />}
    {kind === 'hq' && <HQ roundId={roundId} />}
    {kind === 'player' && <AmbrosePlayerSection roundId={roundId} roundLabel={round === '9' ? 'Nine-hole round' : 'Round 1'} />}
    {kind === 'scorer' && <AmbroseScorerContainer roundId={roundId} />}
    {kind === 'board' && <AmbroseLeaderboardContainer roundId={roundId} roundLabel={round === '9' ? 'Nine-hole round' : 'Round 1'} />}
  </div>
}
createRoot(document.getElementById('r')!).render(<App />)
