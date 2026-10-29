# Package 4 / M4 - Ryder Cup-style competition: specification v0.2 (draft)
28 Oct 2026 · Updated with Darren's confirmed match rules. **Specification only. Ryder Cup implementation has NOT started; no SQL, no code in the app tree, nothing deployed.** It stops at the normal approval gate before any major build.
Legend: **[C]** confirmed by Darren/Alex · **[P]** my proposal for approval · **[?]** open · **[U]** needs a primary-source check (I have not verified it).

## 1. Structure and layers
- Two sides: **Red** and **Blue** [C]. Each round/session has matches between players or pairs from opposite sides [C].
- Match points: win **1**, halved **0.5 each**, loss **0** [C]; overall winner = accumulated match points [C]. Per-match weighting is not requested; I keep the points configurable per match but default 1 / 0.5 / 0 [P].
- **Three layers, never mixed** [C]: (1) the competition *scoring format* (what is scored), (2) the individual *match result* (who won/halved), (3) *Red/Blue standings* (sum of awarded match points). Stableford points or stroke totals are never added to the tally.
- Different match bases can be mixed across (and within) rounds [C]. Each match's basis is shown before play and **frozen when its round starts**; a later change is an organiser correction with a reason and an audit row, and is flagged on the result [P].

## 2. Match schema and participant relationships [P] (future migration, NOT 104)
- `competition_sides` (trip, `red`|`blue`, display name). `competition_side_members` (trip, player, side) with **one side per player per event**.
- `ryder_matches` (id UUID, trip, round, kind `singles`|`four_ball`|`pairs_team` [later: `foursomes`], basis `stableford_total`|`net_stroke_total`|`hole_by_hole`, holes_scheduled, points_win/half/loss, status `scheduled`|`in_progress`|`complete`|`suspended`, created/frozen timestamps).
- `ryder_match_participants` (match, side, player and/or `round_team_entries.id`). The database function that saves a match enforces: both sides present, **opposite sides**, every participant on the event roster and in the round, no player in two matches in the same round, sizes valid for the kind. All IDs are UUID foreign keys (round and match UUID integrity [C]).
- `ryder_match_concessions` and `ryder_match_results` (sections 6 and 7). Same security pattern as 104: identity from `auth.uid()`, authority from `is_trip_organiser()` / the match's participants, no caller-supplied actor, no direct table writes, immutable history.
- Existing `src/lib/scoring/ryderCup.types.ts` (red/blue, outcomes, 1 / 0.5 / 0, `sumRyderCupPoints`) is **reused and extended** (basis, status, side vs team, concession), not duplicated [C].

## 3. Stableford total-points matches [C]
- Singles only in the initial scope. Inputs: each player's **official** Stableford total, read from the existing individual scorecards (official score = the `self` capture entry; the Stableford trigger and golden tests are untouched).
- Higher total wins; equal = halved; award 1 / 0.5 / 0.
- **Eligibility [P]:** both scorecards complete for all scheduled holes, submitted, and **reconciled** (no unresolved marker mismatch or open query). Otherwise the match shows "Awaiting scores/reconciliation" and awards nothing. No winner is declared early.
- The players' own stored playing handicaps decide the Stableford totals exactly as in an ordinary round. Whether a Ryder match applies a reduced allowance is **[U]**.

## 4. Net Stroke matches [C]
- Official net total = gross total − the player's stored playing handicap; lower wins; equal = halved.
- A missing hole, a No Return or an incomplete scorecard is **never** an eligible low total; the match stays "Awaiting scores" until complete and reconciled. A resolved No Return follows the event rules: an organiser-confirmed score is a score; "no score" leaves the match unresolved for organiser decision (same principle as team scoring).
- Handicap requirements: both players must have a stored playing handicap snapshot for the round; the Daily Handicap decision (separate report) changes the inputs here too. Nine-hole rounds are blocked until the nine-hole contract is settled.

## 5. Traditional hole-by-hole Match Play [C]
Verified against a throwaway calculation (not in the app tree); all expected results matched:
- Per hole: compare the two sides' **net** scores for that hole (after the approved match allowance [U]); lower wins the hole; equal = halved hole. A conceded hole is a win for the other side (section 6).
- Status after each hole: **All Square**, **1 Up**, **2 Up**...; **Dormie** when the lead equals holes remaining.
- The match **concludes as soon as the lead exceeds holes remaining**: e.g. 3 up after 16 of 18 -> **3 & 2**; 2 up after 17 -> **2 & 1**; 4 up after 15 -> **4 & 3**; a 9-hole match 3 up after 7 -> **3 & 2**. Won on the last hole by one -> **1 Up**.
- All square after the final scheduled hole = **halved**, unless an organiser-configured, separately approved playoff rule exists [C] (none is designed yet).
- After conclusion, unplayed holes are not missing scores and no further entry is required [C]. The rule is **specific to hole-by-hole**: it never ends a Stableford-total or Net-Stroke match early [C].
- Status text and Ryder points come from the **same** function, so they cannot disagree [C].
- Score source: singles and four-ball better-ball read the players' individual gross scores per hole (four-ball: best net of the two partners on each hole). Foursomes and pair-vs-pair Ambrose matches would read the team score engine (later). Handicap allowances for singles, four-ball and foursomes match play are **[U]**.

## 6. Concessions [C] (rules) / authorisation [P]
- **Concede Hole** is an explicit action, never a fabricated gross score, never a Stableford pick-up, and never an individual score record. It records: match, hole, conceding side/player, awarded side, actor, timestamp, reason. The other side gets the hole for match purposes.
- **Concede Match** is a separate, confirmed action that awards the match to the other side.
- **Who may concede [P]:** a participant on the **conceding** side (or their nominated scorer) or the organiser - never the side that would benefit. **Accidental entries** can be reversed only by an audited organiser correction (reason required) [C].
- Offline: concessions use the same revision/idempotency/conflict model as team scores (a per-match revision), so a replayed or stale concession cannot overwrite a newer decision.
- Concessions apply to hole-by-hole matches only [C].

## 7. Suspended / abandoned matches [C]
- An undecided match that stops is **Incomplete/Suspended**: no points, no winner, scores and state preserved, can be resumed.
- The organiser may resume, or resolve it under the published conditions. Any organiser-awarded outcome is explicit, reasoned and audited. **Options to offer (for approval, none is a default) [P]:** resume later; award as halved; award on current standing; void (no points). The system never picks one automatically.
- Standings show "x of y matches complete" and the points still available, and count an unresolved match as 0 until resolved.

## 8. Handicap allowances and sources [U]
Not verified by me and not stated as fact: match-play allowances for singles (difference of handicaps), four-ball, foursomes; whether Stableford/stroke Ryder matches use full handicaps or a reduced allowance; Alternate Shot combined ÷ 2. **Primary-source verification (Golf Australia/R&A, and the current Daily Handicap rule) is a gate before any net or match-play result is enabled.**

## 9. Red/Blue aggregation [P]
Pure TypeScript over stored official results: `sumRyderCupPoints` (existing, tested) for awarded points; plus points available, matches complete/total, per-session breakdown. Official results are stored when a match completes (or an organiser resolves it) so that later edits cannot silently change standings: an organiser score correction on a completed match re-derives the result, shows "result changed" and writes an audit row.

## 10. Format compatibility matrix
| Match kind | Basis | Score source | Engine | Phase |
|---|---|---|---|---|
| Singles | Stableford total | individual cards | existing Stableford | M4 |
| Singles | Net Stroke total | individual cards | existing gross scores | M4 |
| Singles | Hole-by-hole | individual per-hole gross | new match engine | M4 |
| Four-ball (better-ball) | Hole-by-hole | two players' individual cards | new match engine | M4 |
| Two-person Ambrose pair v pair | Net Stroke / Team Stableford total | team score engine (M2) | M2 + match wrapper | later |
| Two-person Ambrose pair v pair | Hole-by-hole | team gross per hole | match engine | later |
| Alternate Shot (foursomes) | all three bases | team score engine | M2 + match wrapper | later, outside V8 [C] |
Side Games (Skins etc.) stay under My HQ -> Side Games and are independent of the match tally.

## 11. Organiser setup, leaderboards, presentation, tests [P]
- Setup stays within the My HQ lifecycle: assign Red/Blue (players), create matches per session (kind, basis, participants), review, release; no extra stages.
- Views: Red v Blue scoreboard ("Red 2.5 - Blue 1.5"), per-session match list with live status (All Square / 2 Up / 3 & 2 / Halved), clear Incomplete/Suspended state, text plus colour for sides. Presentation reuses the V6/V7 pipeline; deferred presentation-polish items stay deferred [C].
- Tests required before release: the match engine over many sequences (as in section 5), concession/revision/offline conflicts, eligibility and reconciliation gating, standings aggregation, UUID/trip-membership integrity, security (direct RPC, cross-event, non-participant), regression on Stableford golden tests, and 100-player multi-round fixtures. Scratch tests prove logic only; Supabase, device and live checks remain separate.

## 12. Open decisions for the M4 gate
1. Match handicap allowances and Ryder Stableford/stroke allowance basis (primary source).
2. Suspended-match resolution options and who may apply them.
3. Playoff rule for all-square matches (default: halved).
4. Who may concede (proposal above) and whether Concede Match needs the other side's acknowledgement.
5. Freeze boundary for match basis (proposal: round start).
6. Store official results at completion (proposal) vs derive always.
7. Per-match point weighting: needed or fixed 1 / 0.5 / 0?
