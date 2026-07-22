# Scoring Architecture

This document distinguishes three different levels of "done" in the scoring
codebase, per the instruction not to claim more than what's actually true:

1. **Currently implemented and live** — used by the running application today.
2. **Domain utilities prepared for future formats** — fully built, fully
   tested, reusable, but not wired into any screen or API route yet.
3. **Future Ryder Cup implementation** — types only, no schema, no UI.

Everything in this codebase lives in `src/lib/scoring/`. Nothing here
duplicates itself elsewhere — components and API routes call these
functions rather than re-deriving the arithmetic.

## 1. Currently implemented and live

- **Stableford** (`stableford.ts`) — used by `ScoreSessionShell.tsx` for
  every points calculation and running total shown on the active scoring
  screen, and independently re-implemented by the Postgres trigger
  (`calculate_stableford_points`, migration 019) that computes
  `score_entries.stableford_pts` as the database's source of truth.
- **Handicap-stroke allocation** (`strokeAllocation.ts`) — used by both
  `stableford.ts` and the "SHOTS" display in `ScoreSessionShell.tsx`.
- **Playing-handicap rounding at round start** (`defaultHoles.ts`'s
  `resolvePlayingHandicap`, now delegating to `rounding.ts`'s
  `roundHandicap`) — this is what Sprint 5A's Begin Round flow actually
  uses today.

## 2. Domain utilities prepared for future formats (not wired in yet)

These exist, are fully unit tested, and are ready to be called the moment
there's a screen or API route that needs them — but nothing calls them yet:

- **Daily handicap from GA handicap + slope rating** (`dailyHandicap.ts`).
  Not wired in because **there is no `slope_rating` column anywhere in the
  current schema** — not on `trips`, not on `rounds`, and there is no
  `courses` table. `resolvePlayingHandicap` (the thing Sprint 5A actually
  uses) takes an already-resolved handicap number and does not apply any
  slope adjustment. Wiring in `calculateDailyHandicap` is a schema decision,
  not a code change — see "Schema recommendation" below.
- **Team handicaps** for two-player Ambrose, four-player Ambrose, and
  alternate shot (`teamHandicap.ts`), with centrally configurable
  allowances (`DEFAULT_HANDICAP_ALLOWANCES`). `rounds.scoring_format`
  already has an `'ambrose'` value in its CHECK constraint (migration 004),
  but nothing in the current round-start or scoring flow branches on it —
  `BeginRoundModal` and `ScoreSessionShell` are Stableford-only today. No
  team/pairing tables exist to assign players into Ambrose pairs; that's
  additional schema work, not just wiring this function in.
- **Explanation strings** (`explain.ts`) for both of the above — ready for
  an info-icon or calculation-details modal whenever one is built. Not
  rendered anywhere currently, to keep the live scoring screen uncluttered
  per the Sprint 5B brief.

**Do not read any of the above as "Ambrose is implemented."** The
calculation is implemented and tested; the format is not playable.

## 3. Future Ryder Cup implementation (types only)

`ryderCup.types.ts` defines the vocabulary a later Ryder Cup sprint would
need (`RyderCupEventTeam`, `RyderCupMatch`, `RyderCupMatchOutcome`, and a
pure `sumRyderCupPoints` helper) so that sprint doesn't have to invent team
color / match / outcome naming from scratch. **No database tables exist for
any of this.** No UI exists for any of this.

### Schema recommendation for the later Ryder Cup sprint

Reviewed against the current schema (`trips`, `trip_members`, `trip_groups`,
`rounds`, `scorecards`, `score_entries`). None of these can represent an
event team, a match, or a match result today. Recommended new tables when
that sprint starts:

| Table | Purpose | Notes |
|---|---|---|
| `event_teams` | Team Red / Team Blue for a trip | `trip_id`, `colour`, `name` |
| `event_team_members` | Player → team assignment | `team_id`, `profile_id`; unique per trip |
| `matches` | One match within the event | `trip_id`, `format` (reuses `TeamFormat` + `'stroke'`/`'stableford'`), `round_id` if tied to a specific round |
| `match_participants` | Players/teams in a match | `match_id`, `profile_id`, `side` ('red'/'blue') |
| `match_results` | Outcome + points | `match_id`, `outcome` ('red_win'/'blue_win'/'halved'), `red_points`, `blue_points` — mirrors `RyderCupMatchOutcome` and `RYDER_CUP_OUTCOME_POINTS` exactly, so the DB and TS stay in the same vocabulary from day one |

None of these tables have been created. This is a proposal for that future
sprint's planning, not a commitment made by this update.

## Known limitations

- **Two independent Stableford implementations.** `stableford.ts` (TS) and
  `calculate_stableford_points` (Postgres, migration 019) must be kept in
  sync by hand — there is no single source of truth across the language
  boundary. If one changes, the other must change with it. This is a
  structural limitation, not a bug; a DB trigger genuinely needs to compute
  this independently of the Node process for data integrity.
- **`resolvePlayingHandicap` and `calculateDailyHandicap` are two different
  functions**, not a migration path from one to the other yet. The former
  is what's live; the latter is schema-blocked (see above). When
  `slope_rating` lands in the schema, the round-start flow should switch to
  calling `calculateDailyHandicap` — that's a deliberate future change, not
  an oversight today.
- **`RoundingMode` currently only supports `'nearest'`.** Every function
  that accepts a `roundingMode` parameter throws `UNSUPPORTED_ROUNDING_MODE`
  for anything else. This is intentional — there is exactly one agreed
  rounding rule right now, and the parameter exists so a second mode can be
  added later without changing every call site's signature.
- **Existing `score_entries.stableford_pts` values were not retroactively
  recomputed** by migration 019. Only rows written after this migration use
  the corrected (uncapped, negative-handicap-safe) formula. Given the
  existing test accounts and how recently Sprint 5B landed, this is
  extremely unlikely to have produced any real bad data (a nett score
  better than albatross, or a genuinely negative playing handicap, are both
  rare), but it's worth stating plainly rather than silently ignoring.
