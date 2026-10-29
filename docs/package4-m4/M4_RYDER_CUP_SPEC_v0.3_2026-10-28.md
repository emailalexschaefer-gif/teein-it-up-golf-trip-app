# Package 4 / M4 - Ryder Cup-style competition: specification v0.3 (draft, decisions incorporated)
28 Oct 2026 · v0.2 accepted as the working specification; Alex's seven decisions and refinements are incorporated below. **Specification only. Ryder Cup implementation is NOT authorised and has not started; no SQL, no app code, no ZIP.** Implementation waits for the normal M4 approval gate; current priority is Ambrose M2.
Legend: **[C]** confirmed by Darren/Alex · **[P]** my proposal · **[?]** open · **[U]** pending primary-source verification (not verified by me).
## 1. Structure and layers
- Two sides: **Red** and **Blue** [C]. Each round/session has matches between players or pairs from opposite sides [C].
- Match points: win **1**, halved **0.5 each**, loss **0** [C]; overall winner = accumulated match points [C]. **Fixed at 1 / 0.5 / 0 for the initial Ryder Cup release (V10); no per-match weighting and no organiser control for it** [C]. The code keeps the values in one named constant (the existing `RYDER_CUP_OUTCOME_POINTS`) so later extension needs no redesign.
- **Three layers, never mixed** [C]: (1) the competition *scoring format* (what is scored), (2) the individual *match result* (who won/halved), (3) *Red/Blue standings* (sum of awarded match points). Stableford points or stroke totals are never added to the tally.
- Different match bases can be mixed across (and within) rounds [C]. Each match's participants, kind, scoring basis and rules are shown before play and **frozen when the relevant round starts** [C]. Any post-start adjustment is a deliberate, authorised, audited organiser correction; accepted scores are never silently reassigned [C].

## 2. Match schema and participant relationships [P] (future migration, NOT 104)
- `competition_sides` (trip, `red`|`blue`, display name). `competition_side_members` (trip, player, side) with **one side per player per event**.
- `ryder_matches` (id UUID, trip, round, kind `singles`|`four_ball`|`pairs_team` [later: `foursomes`], basis `stableford_total`|`net_stroke_total`|`hole_by_hole`, holes_scheduled, points_win/half/loss, status `scheduled`|`in_progress`|`complete`|`suspended`, created/frozen timestamps).
- `ryder_match_participants` (match, side, player and/or `round_team_entries.id`). The database function that saves a match enforces: both sides present, **opposite sides**, every participant on the event roster and in the round, no player in two matches in the same round, sizes valid for the kind. All IDs are UUID foreign keys (round and match UUID integrity [C]).
- `ryder_match_concessions` and `ryder_match_results` (sections 6 and 7). Same security pattern as 104: identity from `auth.uid()`, authority from `is_trip_organiser()` / the match's participants, no caller-supplied actor, no direct table writes, immutable history.
- Existing `src/lib/scoring/ryderCup.types.ts` (red/blue, outcomes, 1 / 0.5 / 0, `sumRyderCupPoints`) is **reused and extended** (basis, status, side vs team, concession), not duplicated [C].

## 3. Stableford total-points matches [C]
- Singles only in the initial scope. Inputs: each player's **official** Stableford total, read from the existing individual scorecards (official score = the `self` capture entry; the Stableford trigger and golden tests are untouched).
- Higher total wins; equal = halved; award 1 / 0.5 / 0.
- **Completion rule [C]:** a total-points match is awarded only when eligible results exist for **every required hole** - it has no early finish. **Eligibility:** both scorecards complete for all scheduled holes, submitted, and **reconciled** (no unresolved marker mismatch or open query). Otherwise the match shows "Awaiting scores/reconciliation" and awards nothing. No winner is declared early.
- The players' own stored playing handicaps decide the Stableford totals exactly as in an ordinary round. Whether a Ryder match applies a reduced allowance is **[U]**.

## 4. Net Stroke matches [C]
- Official net total = gross total − the player's stored playing handicap; lower wins; equal = halved.
- **Completion rule [C]:** like Stableford-total, a net-total match needs eligible results for every required hole; there is no early finish.
- A missing hole, a No Return or an incomplete scorecard is **never** an eligible low total; the match stays "Awaiting scores" until complete and reconciled. A resolved No Return follows the event rules: an organiser-confirmed score is a score; "no score" leaves the match unresolved for organiser decision (same principle as team scoring).
- Handicap requirements: both players must have a stored playing handicap snapshot for the round; the Daily Handicap decision (separate report) changes the inputs here too. Nine-hole rounds are blocked until the nine-hole contract is settled.

## 5. Traditional hole-by-hole Match Play [C]
Verified against a throwaway calculation (not in the app tree); all expected results matched:
- Per hole: compare the two sides' **net** scores for that hole (after the approved match allowance [U]); lower wins the hole; equal = halved hole. A conceded hole is a win for the other side (section 6).
- Status after each hole: **All Square**, **1 Up**, **2 Up**...; **Dormie** when the lead equals holes remaining.
- The match **concludes as soon as the lead exceeds holes remaining**: e.g. 3 up after 16 of 18 -> **3 & 2**; 2 up after 17 -> **2 & 1**; 4 up after 15 -> **4 & 3**; a 9-hole match 3 up after 7 -> **3 & 2**. Won on the last hole by one -> **1 Up**.
- All square after the final scheduled hole = **halved by default, 0.5 points each; no automatic extra holes or playoff in the initial release** [C].
- After conclusion, unplayed holes are not missing scores and no further entry is required [C]. This early completion is the **one difference in completion logic** between bases and is **specific to hole-by-hole**: it never ends a Stableford-total or Net-Stroke match early [C].
- Status text and Ryder points come from the **same** function, so they cannot disagree [C].
- Score source: singles and four-ball better-ball read the players' individual gross scores per hole (four-ball: best net of the two partners on each hole). Foursomes and pair-vs-pair Ambrose matches would read the team score engine (later). Handicap allowances for singles, four-ball and foursomes match play are **[U]**.

## 6. Concessions [C]
- **Concede Hole** and **Concede Match** are explicit actions for **hole-by-hole Match Play only**; they do not exist for Stableford-total or Net-Stroke-total matches.
- A concession never creates a gross score, a Stableford score or an individual score record. It records: match, hole (or match), conceding side/player, awarded side, actor, timestamp, reason/audit data. The other side is awarded the hole (or the match).
- **Who may concede:** a participant authorised to represent the **conceding** side, or the organiser recording it on that side's behalf (confirmation and audit). **The benefiting opponent can never concede on the other side's behalf.** An explicit confirmation step is shown before anything is recorded.
- **Accidental concessions** are reversed only by an audited organiser correction (reason required).
- Offline: concessions use the same per-match revision/idempotency/conflict model as team scores, so a replayed or stale concession cannot overwrite a newer decision. Concede Match needs no acknowledgement from the other side beyond the confirmation step above.
## 7. Suspended / abandoned matches [C]
- An undecided match that stops is **Pending / Suspended**. It is displayed as pending - **never as a completed loss or a zero-point result**. It awards **no points** and no winner; scores and match state are preserved.
- **Organiser-only resolution, with confirmation, reason, actor, timestamp and audit history; no automatic resolution:**
  1. **Resume** the match.
  2. **Declare halved** - only if permitted by the event conditions.
  3. **Award victory to Red or Blue** under the event conditions.
  4. **Void** the match (no points either side).
- Standings show **completed match points separately from unawarded potential points** ("Red 2.5 - Blue 1.5 · 4 of 12 matches complete · 8 points still available"). A pending match contributes nothing until officially resolved.
- **[?] Minor:** how "permitted by the event conditions" is recorded: a required free-text confirmation (reason) on the resolution, or a per-event setting saved in advance. I propose the required reasoned confirmation for the initial release, because it adds no setup stage.
## 8. Handicap allowances - format-specific, pending verification [C]/[U]
Match handicap methods are specific to each scoring format, and **scramble/Ambrose allowances are never reused for traditional match play** [C]. Nothing below is enabled until a current primary source (Golf Australia or the R&A) is verified:
| Basis / kind | Allowance rule | Status |
|---|---|---|
| Singles Match Play | match-play allowance (difference of handicaps / any reduction) | **[U] pending** |
| Four-ball better-ball Match Play | per-player allowance and its stroke allocation | **[U] pending** |
| Net Stroke-total match | whether stored full handicap or a reduced allowance applies | **[U] pending** |
| Stableford-total match | whether stored full handicap or a reduced allowance applies | **[U] pending** |
| Alternate Shot / Foursomes (later, outside V8) | combined ÷ 2 and match-play allowance | **[U] pending** |
The Daily Handicap investigation and the nine-hole restrictions stand. No unverified net or match-play calculation is activated.
## 9. Red/Blue aggregation and official results [C]/[P]
- Pure TypeScript over stored official results: `sumRyderCupPoints` (existing, tested) for awarded points, plus completed matches, **unawarded potential points** and per-session breakdown.
- **Official match results are stored at completion** [C]; live status is computed from accepted scores.
- If an authorised later correction changes a completed result: the result is **recalculated**, the **previous and new outcome are recorded**, **who changed it and why** is audited, **Red/Blue standings update**, and published views/presentations must not be left showing inconsistent totals - any published scoreboard or presentation built from the old totals is flagged stale and regenerated through the existing presentation pipeline rather than patched by hand [P].
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

## 12. Decision log and what remains
**Decided (Alex, 28 Oct):** (1) match handicaps are format-specific and verified before use; (2) suspended-match options as in section 7, organiser-only, no automation; (3) all-square = halved 0.5 each, no playoff; (4) concession permissions as in section 6; (5) freeze participants, kind, basis and rules at round start; (6) store official results, audit corrections; (7) fixed 1 / 0.5 / 0 for V10.
**Still pending:**
1. Primary-source verification of each match handicap rule in section 8 (blocks any match-play or net-total result).
2. How "permitted by the event conditions" is recorded for halving/awarding (proposal in section 7).
3. The shared Ambrose/handicap blockers: Daily Handicap rule, nine-hole contract, Supabase integration test.
Ryder Cup implementation stays parked behind Ambrose M2 and Skins.
