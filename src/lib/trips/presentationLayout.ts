/**
 * Pure layout rules for the presentation player (12 Oct 2026 UX polish).
 * Kept free of React so they can be unit-tested with real inputs. All
 * lengths are `cqw`: 1% of the 16:9 presentation canvas width (the canvas
 * is therefore 56.25cqw tall).
 */

export const CANVAS_HEIGHT_CQW = 56.25

/** Reference Event Snapshot title size (for a ~22 character name). */
const TITLE_MAX_CQW = 5.2
const TITLE_MIN_CQW = 2.6
const TITLE_REFERENCE_CHARS = 22

/** Title font size: full size for short names, shrinking in proportion
 * for longer ones (floor 2.6cqw) so the name stays on one line where
 * practical and never overflows the slide. */
export function snapshotTitleCqw(eventName: string): number {
  const len = Math.max(eventName.trim().length, 1)
  return Math.max(TITLE_MIN_CQW, Math.min(TITLE_MAX_CQW, (TITLE_MAX_CQW * TITLE_REFERENCE_CHARS) / len))
}

/** Splits "Club — Course" onto two lines (as the approved reference does)
 * so a long course name never has to wrap mid-name. A name with no
 * dash separator stays whole. */
export function splitCourseName(name: string): { club: string; course: string | null } {
  const [club, ...rest] = name.split(/\s+[\u2012\u2013\u2014\u2015-]\s+/)
  return { club, course: rest.length > 0 ? rest.join(' — ') : null }
}

/** Pillarbox width (each side, in cqw) left by media of a given aspect
 * ratio (width / height) contained in the 16:9 canvas. 0 when the media
 * is as wide as, or wider than, the canvas. */
export function pillarboxCqw(aspect: number): number {
  if (!(aspect > 0)) return 0
  return Math.max(0, (100 - CANVAS_HEIGHT_CQW * aspect) / 2)
}

/** Below this much pillarbox per side the side card would be too small to
 * read on a phone, so a compact corner pill is used instead. */
export const SIDE_CARD_MIN_PILLARBOX_CQW = 17

export type MomentsLabelPlacement =
  | { mode: 'side'; sideSpaceCqw: number }
  | { mode: 'corner' }

export function momentsLabelPlacement(aspect: number): MomentsLabelPlacement {
  const side = pillarboxCqw(aspect)
  return side >= SIDE_CARD_MIN_PILLARBOX_CQW ? { mode: 'side', sideSpaceCqw: side } : { mode: 'corner' }
}

/** "BLOOPERS" only for a memory the organiser actually flagged as a
 * Blooper; every other photo/video (including unassigned event Moments
 * riding in the same "Moments & Bloopers" chapter) is "EVENT MOMENTS". */
export function momentsLabelHeading(isBlooper: boolean | undefined): 'BLOOPERS' | 'EVENT MOMENTS' {
  return isBlooper === true ? 'BLOOPERS' : 'EVENT MOMENTS'
}
