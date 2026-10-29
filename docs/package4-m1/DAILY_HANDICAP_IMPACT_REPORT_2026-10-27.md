# Daily Handicap - Impact Assessment (preliminary)
27 Oct 2026 · **Analysis only. No code, schema or stored score was changed. V7 behaviour preserved. No recalculation of any historical score.**

## 1. What the app does today (traced in code)
- `calculateDailyHandicap` = `round(GA Handicap x Slope / 113)` (`src/lib/scoring/dailyHandicap.ts`, "Darren's supplied MVP formula"). It has no Scratch-minus-Par term and no 0.93 factor.
- Live flow (`BeginRoundModal`): when a round has a **library tee-set slope**, the starting value is that Daily Handicap; for **manual courses** (no slope) it is `round(GA Handicap)` with no slope at all. The organiser can override per player at Start Round; the final integer is snapshotted to `scorecards.playing_handicap` and never recomputed.
- Rounding is half-up to a whole number. Plus handicaps pass through as negatives.
- The inputs the published formula needs **are stored**: `rounds.course_rating`, `rounds.slope_rating`, `rounds.par` (from `course_tee_sets`, migration 039).

## 2. What Golf Australia publishes (read this session, from GA help pages via page fetch - please confirm wording and date yourself)
- 18-hole: `((GA Handicap x Slope Rating / 113) + (Scratch Rating - Par)) x 0.93`. No rounding rule or effective date on the page.
- 9-hole: `((GA Handicap x Slope Rating / 113) + ((Scratch Rating - Par) x 2)) x 0.93`; strokes then applied using the 9-hole course indexes; first-card instruction uses 27. The page does not say whether Slope/Scratch/Par are the nine-hole values, nor how rounding applies.
- The archived GA Operational Guidance (30 Jan 2020 edition) states the Daily Handicap "is rounded to the nearest whole number" (Section 3(H)) and says to use the 18-hole stroke index for the holes played in a 9-hole round. That is a 2020 edition and **predates the October 2025 CONNECT change you flagged**; I could not confirm which text is current.
- **Not confirmed by me:** which formula is in force today, from when, and whether it is the published rule for Stableford handicap strokes in competitions run outside a club system. This is the first thing to settle.

## 3. Eighteen-hole comparison (computed with the real app function vs the published formula)
Each cell: **app today → published formula (difference in strokes)**, whole-number rounding half up.

| GA Handicap | Neutral 113 / CR 72.0 / par 72 | Easier 120 / 69.5 / 71 | Typical 128 / 71.2 / 72 | Hard 138 / 73.4 / 72 |
|---|---|---|---|---|
| -2 | -2 → -2 (0) | -2 → -3 (-1) | -2 → -3 (-1) | -2 → -1 (+1) |
| 0 | 0 → 0 (0) | 0 → -1 (-1) | 0 → -1 (-1) | 0 → 1 (+1) |
| 5.4 | 5 → 5 (0) | 6 → 4 (-2) | 6 → 5 (-1) | 7 → 7 (0) |
| 12.3 | 12 → 11 (-1) | 13 → 11 (-2) | 14 → 12 (-2) | 15 → 15 (0) |
| 18 | 18 → 17 (-1) | 19 → 16 (-3) | 20 → 18 (-2) | 22 → 22 (0) |
| 24.6 | 25 → 23 (-2) | 26 → 23 (-3) | 28 → 25 (-3) | 30 → 29 (-1) |
| 36 | 36 → 33 (-3) | 38 → 34 (-4) | 41 → 37 (-4) | 44 → 42 (-2) |

Sweep of GA Handicaps -5.0 to 36.0: the two formulas agree for only 0% (easier course), 7% (typical), 26% (neutral) and 28% (hard) of handicaps. Differences range from **-4 to +2 strokes**. The 0.93 factor reduces most mid/high handicaps by 1-3 strokes; the Scratch-minus-Par term moves low handicaps either way depending on the course. The illustrative tee values are examples I chose, not real course data.

## 4. Effect on Stableford points
An extra handicap stroke is worth at most +1 point on the hole where it lands (e.g. par 4, gross 5: 1 → 2 points; a hole already at 0 points, such as a gross 7 on a par 4, stays at 0 with one stroke). So a player given N extra strokes gains **up to N points** over a round, usually fewer. A -2 stroke change typically costs a player 0-2 points and can change finishing order in tight fields. The `compute_stableford` trigger uses the stored `scorecards.playing_handicap`, so **nothing in stored results changes unless a handicap is recalculated**.

## 5. Plus handicaps, tees, snapshots, rounding
- Plus handicaps: both formulas handle negatives; the published formula can push a scratch player below zero (0 → -1 on easier courses), which the app must display consistently (a "plus" Daily Handicap). Not tested end-to-end.
- Course/tee rating inputs: stored per round, so a published-formula calculation is feasible without schema change; manual courses have none and would need a fallback rule (decision).
- Snapshots: the handicap is snapshotted at Start Round (`scorecards.playing_handicap`, integer) and by migration 101 optionally on `round_arrangements`. Historical rounds keep what was snapshotted; there is no GA Handicap snapshot beside it, so a historical round cannot be exactly re-derived - only compared approximately using today's profile handicap.
- Rounding: whole number half-up in the app and in the 2020 guide. The 2025 pages state none.

## 6. Nine-hole
- The app applies the 18-hole Daily Handicap to the nine holes with the trigger's 18-hole allocation. The published nine-hole formula differs (x2 on the rating term, then 0.93) and uses nine-hole indexes. Whether production has nine-hole rounds that are affected is **unknown until the read-only results arrive.**
- Nine-hole Ambrose stays blocked.

## 7. Future Ambrose net results
Net team results use player handicaps as inputs (weighted or divisor). If every player's Daily Handicap moves by 2 strokes, a four-person club-divisor team handicap moves by 1.0 (4 x 2 ÷ 8) and a four-person weighted team handicap moves by 1.4 (70% of 2). So the Daily Handicap decision directly changes Ambrose placings. **Net Ambrose stays disabled until this is settled.** Gross Ambrose is unaffected.

## 8. Which historical results would change
**None, unless someone recalculates.** If the formula were changed for new rounds only, existing scorecards keep their snapshots and stored Stableford points; the app would then use two rules over time (documented by round date). If you ever want historical alignment, that is a separate approved, itemised, reversible exercise - not part of this work.

## 9. Production evidence needed
Run `READONLY_daily_handicap_impact_query.sql` (new) with `READONLY_nine_hole_query_2.sql`, the first nine-hole query and `READONLY_m1_preflight.sql`. It shows how many real rounds have slope/rating/par and what handicaps were stored.

## 10. Decisions for you (nothing is changed until you decide)
1. Confirm the currently effective Golf Australia Daily Handicap rule (formula, rounding, effective date) from the GA source you trust.
2. If it differs from the app: adopt for new rounds only (my recommendation as the option with no historical effect), or hold.
3. Manual courses with no slope/rating: keep raw handicap, or require tee data.
4. Show the handicap basis ("Daily Handicap per <rule>") on scorecards and Ambrose workings.
