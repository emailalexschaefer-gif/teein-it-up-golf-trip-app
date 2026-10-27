# Presentation polish audit - 27 Oct 2026 (Lappen Invitational desktop screenshots)

Baseline: V5 (Packages 1-3 + V5 live-sync). Migration 100 / Finish Round Early not included. No SQL added. Canonical scoring untouched
(`determineRoundStandings`, `determineRoundWinners`, `computeFinalResults` unchanged).

## Root causes
1. **Cancelled-round zero-point "winners" (critical).** A round that is not `cancelled` (e.g. `completed`/in-progress) but where nobody
   recorded a score was ranked like any other round. All 20 scorecards summed to 0, `determineRoundStandings` gave them all position 1,
   and its "never split a tie at the cutoff" rule kept all 20 - so a 20-row "Round Winner" list ran off the screen.
   Cancelled rounds were already dropped by the manifest query; an unplayed round with another status was not.
   Fix at the data layer (`lib/trips/roundPlay.ts`, `eventMemoryData.ts`): only players with at least one recorded **self** score entry are
   ranked; a round with no recorded scores is dropped from rounds, results, winners, cumulative totals and counts. Decided by recorded
   entries, **never by zero points** (a played round with 0-point holes is kept). Defence in depth at the deck builder
   (`slideshowDeck.ts presentableData`): cancelled / `hasRecordedScores=false` rounds never reach any builder, however the manifest arrived.
   Moments stay in Event Memories; side-game winners tied to a dropped round are not shown.
2. **Tiny type.** Captions, side-game, Makers & Breakers, results and leaderboard text used fixed 11-17 px sizes (a few `vw` clamps), so on a
   1366-1920 px stage they read as metadata. The stage already exposes a 16:9 container; the new `sz(min, cqw, max)` helper sizes against it
   (no user-agent sniffing) with a phone floor and a TV ceiling.
3. **Literal `·`** printed in the "Final standings - Event ended early" line (an escape inside JSX text). Fixed.
4. **Leaderboard ranks 4-5** rendered dark on dark and row backgrounds were too transparent over the bright sunset art. Fixed (dark base under each tint).

## Top-5 rule (`lib/trips/topFive.ts`)
Round results, "Total Scores" and the final leaderboard show at most five rows. Positions come from the scoring layer and are never re-derived.
- Whole tie groups only: a group that would cross fifth place is left out and reported ("3 more players tied for 4th - full standings in the app").
- Joint leaders larger than five are all shown (the winners are never hidden).
- Fewer than five players: only those players. Champion / ended-early / no-champion logic unchanged.

## Event Moments callout - rule (`presentationLayout.showsMomentsCallout`)
Shown on every ordinary Moment photo slide and every Blooper photo/video (portrait: side card; landscape: corner pill). Never on Side Game winner,
results, totals, champion, final leaderboard, group photo, dividers, Makers & Breakers, opening/closing. By design it is shown on all photo slides, so
the inconsistency in the screenshots could not be reproduced from the code. One real gap was hardened: an image that finished loading before its
handler was attached never reported its size, which would silently drop the callout; the size is now also read from the ref. Whether that was the
cause of the screenshots is unverified. The callout is also drawn after the caption gradient so it is not dimmed.

## Music
Background music is OFF by default; only an explicit ON is remembered for the session; manual ON/OFF persists across slides. Applause / audio
fix remains parked. Navigation controls stay hidden until interaction; fullscreen unchanged.

## Verification
TypeScript suite 1541/1541 (V5: 1518). Real Chromium (real player, fixture slides): 51/51 slide-viewport checks with no text outside the stage at 1366x768,
1920x1080 and 844x390; music OFF initially, ON/OFF toggles. Before/after screenshots in `docs/presentation-polish-2026-10-27/`.
Not run: `npm ci`, `tsc`, lint, `next build` (registry unreachable, no lockfile); live Supabase; real devices; projector.
