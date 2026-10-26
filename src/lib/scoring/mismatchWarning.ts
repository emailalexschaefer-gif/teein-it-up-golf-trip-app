// Package 3 -- Score Mismatch Warning (pure logic).
//
// A warning shown when a player moves FORWARD off a hole whose two required entries disagree. It is advisory only:
// it never changes, verifies, clears or picks either entry, and it never blocks play. The reconciliation state itself
// (compareCaptures) is untouched -- this module only READS the statuses that function already produced.
import type { CaptureValue, ComparisonStatus } from './comparison'

export interface MismatchItem {
  /** The golfer whose score is in dispute. */
  golfer: string
  yourLabel: string
  yourEntry: string
  otherLabel: string
  otherEntry: string
}
export interface MismatchWarning {
  holeNumber: number
  items: MismatchItem[]
  /** Identifies this exact disagreement, so it is shown once -- not on every tap of Next Hole. */
  signature: string
}

/** Plain-language entry text. Never invents a number for a missing entry. */
export function describeEntry(c: CaptureValue | null | undefined): string {
  if (!c) return 'No score yet'
  if (c.pickedUp) return 'Picked up'
  if (c.grossScore === null || c.grossScore === undefined) return 'No score yet'
  return `${c.grossScore} ${c.grossScore === 1 ? 'stroke' : 'strokes'}`
}

export interface MismatchInput {
  holeNumber: number
  myName: string
  partnerName: string | null
  myStatus: ComparisonStatus | null
  partnerStatus: ComparisonStatus | null
  /** What I entered for myself (on screen) and what my marker entered for me. */
  myDraft: CaptureValue | null
  myMarkerEntry: CaptureValue | null
  /** What I entered for my partner (on screen) and what my partner entered for themselves. */
  partnerDraft: CaptureValue | null
  partnerSelfEntry: CaptureValue | null
}

/** Returns the warning to show, or null. Only the 'mismatch' status counts: waiting, matched, not-started and
 *  organiser-resolved holes never warn, and shared-device / paper pairs (statuses passed as null) never warn. */
export function buildMismatchWarning(i: MismatchInput): MismatchWarning | null {
  const items: MismatchItem[] = []
  if (i.myStatus === 'mismatch') {
    items.push({ golfer: i.myName, yourLabel: `Your entry for ${i.myName}`, yourEntry: describeEntry(i.myDraft), otherLabel: `${i.partnerName ?? 'Marker'}'s entry for ${i.myName}`, otherEntry: describeEntry(i.myMarkerEntry) })
  }
  if (i.partnerStatus === 'mismatch') {
    const p = i.partnerName ?? 'your playing partner'
    items.push({ golfer: p, yourLabel: `Your entry for ${p}`, yourEntry: describeEntry(i.partnerDraft), otherLabel: `${p}'s own entry`, otherEntry: describeEntry(i.partnerSelfEntry) })
  }
  if (items.length === 0) return null
  return { holeNumber: i.holeNumber, items, signature: `${i.holeNumber}|${items.map(x => `${x.golfer}:${x.yourEntry}/${x.otherEntry}`).join('|')}` }
}

/** Warn only going forward, and only once per distinct disagreement. Backward moves and revisits never warn. */
export function shouldWarn(direction: 'forward' | 'backward', warning: MismatchWarning | null, acknowledged: ReadonlySet<string>): warning is MismatchWarning {
  return direction === 'forward' && warning !== null && !acknowledged.has(warning.signature)
}
