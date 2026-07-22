/**
 * Explicit, named, tested rounding for handicap values.
 *
 * The project's established rule (see defaultHoles.ts / Sprint 5A) is
 * round-half-up to the nearest whole number: a decimal handicap of X.5 or
 * above rounds UP, never down. This is the WHS-aligned convention already
 * used for `resolvePlayingHandicap`, and this file is now the single place
 * that rule is implemented, tested, and named — nowhere else in the
 * codebase should call `Math.round()` directly on a handicap value.
 *
 * `Math.round()` in JavaScript already rounds halves toward +Infinity
 * (e.g. Math.round(10.5) === 11, Math.round(-10.5) === -10), which is
 * exactly the "round half up" behaviour this project wants — this wrapper
 * exists so that rule has a name, a single definition, and test coverage,
 * rather than being an implicit assumption repeated at every call site.
 */
export function roundHandicap(value: number): number {
  return Math.round(value)
}
