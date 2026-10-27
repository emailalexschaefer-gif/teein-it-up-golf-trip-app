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

// ── V7: late-arriving mismatches ────────────────────────────────────────────────
// The warning above is built only when the player taps Next Hole, from the hole on screen at that moment. A
// disagreement that appears AFTER that (the partner's entry syncs in later, or a poll lands while the player is on
// another hole) was therefore never announced. This reads the SAVED per-hole captures for every hole and lists the
// disputed ones, in both directions (my entry vs my marker's, and my entry for my partner vs their own). Advisory only:
// it never changes, verifies or clears an entry, and never blocks play.
export type CaptureMapLike = Record<number, CaptureValue | undefined>

export interface LateMismatch {
  holeNumber: number
  /** Changes whenever either side of the disagreement changes, so an edited dispute is announced again. */
  signature: string
  items: { golfer: string; yourEntry: string; otherEntry: string }[]
}

export interface LateMismatchInput {
  holeNumbers: number[]
  myName: string
  partnerName: string | null
  /** false for shared-device, paper or individual scoring -- those never compare two independent entries. */
  comparing: boolean
  mySelf: CaptureMapLike
  myMarker: CaptureMapLike
  partnerSelf: CaptureMapLike
  partnerMarker: CaptureMapLike
  /** Whether a playing partner is currently selected (the partner-side comparison needs one). */
  hasPartner: boolean
}

import { compareCaptures as _compare } from './comparison'

export function findLateMismatches(i: LateMismatchInput): LateMismatch[] {
  if (!i.comparing) return []
  const out: LateMismatch[] = []
  for (const n of i.holeNumbers) {
    const items: LateMismatch['items'] = []
    if (_compare(i.mySelf[n] ?? null, i.myMarker[n] ?? null) === 'mismatch') {
      items.push({ golfer: i.myName, yourEntry: describeEntry(i.mySelf[n]), otherEntry: describeEntry(i.myMarker[n]) })
    }
    if (i.hasPartner && _compare(i.partnerSelf[n] ?? null, i.partnerMarker[n] ?? null) === 'mismatch') {
      items.push({ golfer: i.partnerName ?? 'your playing partner', yourEntry: describeEntry(i.partnerMarker[n]), otherEntry: describeEntry(i.partnerSelf[n]) })
    }
    if (items.length) out.push({ holeNumber: n, items, signature: `${n}|${items.map(x => `${x.golfer}:${x.yourEntry}/${x.otherEntry}`).join('|')}` })
  }
  return out
}

/** Disputed holes to announce now: not the hole on screen (it has its own panel and the forward warning) and not
 *  already acknowledged. */
export function pendingLateNotices(all: LateMismatch[], currentHole: number, acknowledged: ReadonlySet<string>): LateMismatch[] {
  return all.filter(m => m.holeNumber !== currentHole && !acknowledged.has(m.signature))
}
