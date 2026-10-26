'use client'

import { useEffect, useState } from 'react'
import { arrivalReminders, arrivalSeenKey, sideGameAnchorId, type ArrivalComp } from '@/lib/sideGames/arrivalPrompt'

/**
 * Package 3 -- a concise, non-blocking reminder shown when a player arrives at a hole that has an active Side Game.
 * It never covers or disables score entry (it is an inline card, not a modal), shows each competition instance once
 * per browser session (dismissal is remembered, so a refresh does not bring it back), and "Go to nomination"
 * scrolls to that competition's existing entry panel. Storage is best-effort: if it is unavailable the prompt simply
 * shows again, which is harmless.
 */
function seen(roundId: string, compId: string): boolean {
  try { return sessionStorage.getItem(arrivalSeenKey(roundId, compId)) === '1' } catch { return false }
}
function markSeen(roundId: string, compId: string) {
  try { sessionStorage.setItem(arrivalSeenKey(roundId, compId), '1') } catch { /* best effort */ }
}

export default function SideGameArrivalPrompt({ roundId, holeNumber, comps }: { roundId: string; holeNumber: number; comps: ArrivalComp[] }) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  // Re-evaluated on every hole change: reminders reflect the hole currently on screen.
  useEffect(() => { setDismissed(new Set()) }, [holeNumber, roundId])

  const reminders = arrivalReminders(comps, holeNumber).filter(r => !dismissed.has(r.id) && !seen(roundId, r.id))
  if (reminders.length === 0) return null

  function dismissAll() {
    for (const r of reminders) markSeen(roundId, r.id)
    setDismissed(prev => new Set([...prev, ...reminders.map(r => r.id)]))
  }

  return (
    <div data-testid="side-game-arrival" role="status" style={{ margin: '0 16px 10px', background: '#14532d', borderRadius: 12, padding: '12px 14px', boxShadow: '0 3px 12px rgba(0,0,0,0.18)' }}>
      {reminders.map(r => (
        <div key={r.id} style={{ marginBottom: 8 }}>
          <div style={{ fontFamily: 'var(--font-display)', color: '#e8c96a', fontWeight: 800, fontSize: 14.5 }}>{r.headline}</div>
          <div style={{ fontFamily: 'var(--font-body)', color: '#ffffff', fontSize: 13.5, lineHeight: 1.4, marginTop: 2 }}>{r.text}</div>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <button
          type="button"
          onClick={() => { document.getElementById(sideGameAnchorId(reminders[0].id))?.scrollIntoView({ behavior: 'smooth', block: 'center' }); dismissAll() }}
          style={{ flex: 1, minHeight: 44, borderRadius: 10, border: 'none', background: '#e8c96a', color: '#0f2d1c', fontFamily: 'var(--font-body)', fontWeight: 800, fontSize: 13.5, cursor: 'pointer' }}
        >Go to nomination</button>
        <button
          type="button" onClick={dismissAll}
          style={{ flex: 1, minHeight: 44, borderRadius: 10, border: '1.5px solid rgba(255,255,255,0.45)', background: 'transparent', color: '#fff', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}
        >Got it</button>
      </div>
    </div>
  )
}
