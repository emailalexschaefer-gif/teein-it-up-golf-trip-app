/**
 * Event Lobby countdown — pure logic, extracted from EventCountdown.tsx
 * specifically so it's covered by this project's existing test runner
 * (src/lib/trips/**, unlike component files under src/components/).
 *
 * Timezone note: rounds.play_date is a plain SQL DATE and rounds.tee_time
 * is free TEXT ('HH:MM') — neither carries any timezone information, and
 * there is no course/organiser timezone field anywhere in this schema.
 * The existing app-wide convention (confirmed in PlayerHomeCard.tsx's
 * formatTeeTime) is to treat these as wall-clock values and display them
 * as-is. This module follows that same convention: `new Date(dateStr +
 * 'T' + timeStr)` is interpreted in whatever local timezone it's
 * evaluated in — a genuine limitation of the current schema, not
 * something this module invents or can independently resolve.
 */

export interface RoundForCountdown { play_date: string; tee_time: string | null }

export type CountdownPhase =
  | { kind: 'none' }
  | { kind: 'days'; label: string }
  | { kind: 'clock'; days: number; hours: number; minutes: number; seconds: number | null }
  | { kind: 'tee-time' }

export function computeTarget(round: RoundForCountdown, earliestGroupTeeTime: string | null): { date: Date; hasTime: boolean } | null {
  // Hierarchy: A) earliest group-specific tee time for this round, if
  // any group has one set; B) the round's own tee_time; C) date only.
  const teeTime = earliestGroupTeeTime ?? round.tee_time
  if (teeTime) {
    const d = new Date(`${round.play_date}T${teeTime}`)
    if (!Number.isNaN(d.getTime())) return { date: d, hasTime: true }
  }
  const d = new Date(`${round.play_date}T00:00:00`)
  return Number.isNaN(d.getTime()) ? null : { date: d, hasTime: false }
}

export function daysBetweenCalendarDates(from: Date, to: Date): number {
  // Calendar-day difference, not a raw ms/86400000 division — avoids
  // off-by-one errors from partial days/DST.
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate())
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

export function computePhase(target: { date: Date; hasTime: boolean }, now: Date): CountdownPhase {
  const msRemaining = target.date.getTime() - now.getTime()
  const daysRemaining = daysBetweenCalendarDates(now, target.date)

  if (!target.hasTime) {
    if (daysRemaining > 1) return { kind: 'days', label: `${daysRemaining} DAYS TO GO` }
    if (daysRemaining === 1) return { kind: 'days', label: 'TOMORROW' }
    if (daysRemaining === 0) return { kind: 'days', label: 'TODAY' }
    return { kind: 'none' }
  }

  if (msRemaining <= 0) return { kind: 'tee-time' }

  const totalMinutes = Math.floor(msRemaining / 60000)
  const totalHours = Math.floor(msRemaining / 3600000)

  if (totalHours >= 72) {
    const days = Math.max(1, daysRemaining)
    return { kind: 'days', label: `${days} DAYS TO GO` }
  }

  const days = Math.floor(totalHours / 24)
  const hours = totalHours % 24
  const minutes = totalMinutes % 60
  const seconds = totalHours < 1 ? Math.floor((msRemaining % 60000) / 1000) : null
  return { kind: 'clock', days, hours, minutes, seconds }
}
