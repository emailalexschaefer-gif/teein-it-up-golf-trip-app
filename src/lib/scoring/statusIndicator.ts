// V7: ONE mapping from a hole's comparison status to its indicator, used by the hole badge and the Round Summary rows
// so the same state can never be green on one screen and something else on another.
//   green = both entries agree · red = entries disagree (needs review) · amber = waiting / organiser override.
import type { ComparisonStatus } from './comparison'

export type IndicatorTone = 'green' | 'red' | 'amber' | 'grey'
export interface StatusIndicator { tone: IndicatorTone; color: string; icon: string; label: string }

const COLOR: Record<IndicatorTone, string> = { green: '#16a34a', red: '#dc2626', amber: '#a1791f', grey: '#9ca3af' }

export function statusIndicator(status: ComparisonStatus): StatusIndicator {
  switch (status) {
    case 'matched': return { tone: 'green', color: COLOR.green, icon: '🟢', label: 'Score matched' }
    case 'mismatch': return { tone: 'red', color: COLOR.red, icon: '🔴', label: 'Needs review' }
    case 'resolved_by_organiser': return { tone: 'amber', color: COLOR.amber, icon: '⚙️', label: 'Organiser Override' }
    case 'pending_marker': return { tone: 'amber', color: COLOR.amber, icon: '🟡', label: 'Waiting for marker' }
    case 'pending_self': return { tone: 'amber', color: COLOR.amber, icon: '🟡', label: 'Waiting for your score' }
    default: return { tone: 'grey', color: COLOR.grey, icon: '⚪', label: 'Not started' }
  }
}

/** Round Summary buckets use the same tones. */
export function summaryIndicator(bucket: 'matched' | 'mismatch' | 'awaiting' | 'not_started'): { icon: string; color: string } {
  const s = statusIndicator(bucket === 'matched' ? 'matched' : bucket === 'mismatch' ? 'mismatch' : bucket === 'awaiting' ? 'pending_marker' : 'not_started')
  return { icon: s.icon, color: s.color }
}
