'use client'

import { useEffect, useState } from 'react'
import { computeTarget, computePhase } from '@/lib/trips/countdown'

/**
 * Event Lobby countdown. Purely a derived presentation feature — no
 * persisted countdown value, no new schema. Reads only trip.rounds
 * (already available, no fetch) plus round_group_tee_times (fetched
 * once via the existing group-tee-times endpoint, same one Begin
 * Round already uses). Pure logic lives in src/lib/trips/countdown.ts,
 * tested there — this component is presentation only.
 *
 * Timezone: see the detailed note in countdown.ts. Short version:
 * neither play_date nor tee_time carries timezone information in this
 * schema, so this follows the app's existing convention (formatTeeTime)
 * of treating them as wall-clock values, interpreted in whatever local
 * timezone the browser evaluates them in.
 */
interface RoundForCountdown { id: string; play_date: string; tee_time: string | null; status: string }

export default function EventCountdown({ tripId, round }: { tripId: string; round: RoundForCountdown }) {
  const [earliestGroupTeeTime, setEarliestGroupTeeTime] = useState<string | null>(null)
  const [teeTimesLoaded, setTeeTimesLoaded] = useState(false)
  const [now, setNow] = useState(() => new Date())

  // Fetched once per round — the "A) earliest group tee time" tier of
  // the hierarchy. Never re-fetched on a timer; if the organiser
  // changes it later, the next natural page load/refetch of trip data
  // picks it up — "do not persist a separate countdown value" means
  // there's nothing here to actively keep in sync beyond that.
  useEffect(() => {
    let cancelled = false
    fetch(`/api/trips/${tripId}/rounds/${round.id}/group-tee-times`)
      .then(res => res.ok ? res.json() : null)
      .then(body => {
        if (cancelled || !body) return
        const times = (body.teeTimes ?? []) as { group_id: string; tee_time: string | null }[]
        const valid = times.map(t => t.tee_time).filter((t): t is string => !!t).sort()
        setEarliestGroupTeeTime(valid[0] ?? null)
      })
      .catch(() => { /* falls back to round.tee_time — the next tier down, not an error state */ })
      .finally(() => { if (!cancelled) setTeeTimesLoaded(true) })
    return () => { cancelled = true }
  }, [tripId, round.id])

  // Live tick — entirely client-side, no server traffic per tick at
  // all. 60s resolution until genuinely inside the final hour, where
  // the display needs seconds and the interval switches to 1s —
  // directly satisfying "do not create server traffic every
  // minute/second" and avoiding unnecessary re-renders during the
  // common (days/hours-away) case.
  useEffect(() => {
    const target = computeTarget(round, earliestGroupTeeTime)
    const msRemaining = target ? target.date.getTime() - Date.now() : Infinity
    const tickMs = msRemaining < 3600000 ? 1000 : 60000
    const interval = setInterval(() => setNow(new Date()), tickMs)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately re-evaluates tick granularity on every `now` change, so it can switch from 60s to 1s ticks exactly once crossing into the final hour
  }, [now, earliestGroupTeeTime, round])

  if (!teeTimesLoaded || round.status !== 'upcoming') return null

  const target = computeTarget(round, earliestGroupTeeTime)
  if (!target) return null
  const phase = computePhase(target, now)
  if (phase.kind === 'none') return null

  return (
    <div style={{ textAlign: 'center', marginTop: 10, marginBottom: 4 }}>
      {phase.kind === 'days' && (
        <div style={{ fontFamily: 'var(--font-display)', color: '#e8c96a', fontSize: 22, fontWeight: 800, letterSpacing: 1 }}>
          {phase.label}
        </div>
      )}
      {phase.kind === 'clock' && (
        <div style={{ fontFamily: 'var(--font-display)', color: '#e8c96a', fontSize: 19, fontWeight: 800, letterSpacing: 0.5, whiteSpace: 'nowrap' }}>
          ⏱ {phase.days > 0 ? `${phase.days} DAYS · ` : ''}
          {String(phase.hours).padStart(2, '0')} HRS · {String(phase.minutes).padStart(2, '0')} MIN
          {phase.seconds !== null ? ` · ${String(phase.seconds).padStart(2, '0')} SEC` : ''}
        </div>
      )}
      {phase.kind === 'tee-time' && (
        <div style={{ fontFamily: 'var(--font-display)', color: '#e8c96a', fontSize: 20, fontWeight: 800, letterSpacing: 0.5 }}>
          🏌️ IT&apos;S TEE TIME
        </div>
      )}
    </div>
  )
}
