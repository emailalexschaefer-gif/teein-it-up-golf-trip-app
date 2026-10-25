# Combined release: Share Leaderboard + Cancel Round + End Event Early (25 Oct 2026)

NOT deployed. NO migration applied. Migrations to run (Supabase SQL Editor, in order): 097, 098, 099.

## 1. Impact audit (End Event Early / champion declaration)

Lifecycle assumptions that had to change
- Package 2 auto-completed the event when the last playable round was cancelled or closed with a cancelled round. That implicitly crowned a champion. REPLACED: only a normal completion (every round played, none cancelled) auto-completes. Cancelling a round never finishes the event.
- Trip PATCH reverted a completed event to 'ready' when any round was not 'completed'. A cancelled round counted as "not completed", so editing an ended-early event would have reopened it. Fixed: cancelled counts as closed.
- "All rounds closed" in My HQ was treated as "event finished". With a cancelled round it now also needs trips.status = 'completed' (event-level presentation, Event Complete card, player Event Story).

How things are stored / read
- Round cancelled: rounds.status = 'cancelled' (097, unchanged).
- Event ended: trips.status = 'completed' (unchanged: still the single switch that unlocks Final Standings, Event Memories, presentation).
- How it ended: NEW trips.ended_early, champion_declared (default true), ended_early_reason/note/at/by (099, additive).
- Read by readEventOutcome (tolerant: missing 099 / any error = normal completion with champion, i.e. today's behaviour). A normal completion can never read as no-champion.

Components affected: roundLifecycle, roundCancellation, close route, trip PATCH, new eventEnd + /end-event route, finalResults, eventMemoryData, slideshowDeck, EventHighlightsPlayer, eventMakersBreakers, FinalEventResults, eventSummaryText, event-stories route, public board + page + PNG + PDF, MyHQClient, new EndEventControl, CancelRoundControl, tournament page, trip page, PlayerHomeCard.

Migration 099 vs 097/098: independent (adds trips columns only, no policy change). Run order 097, 098, 099. App works with 099 absent except End Event, which refuses with a clear message BEFORE writing anything.

## 2. Behaviour

- Cancel Round: stays on the round; text says it does not finish the event or declare a champion.
- End Event Early (My HQ, organiser only): shown when a round has been played, none is live, event not ended. Label becomes "Finish Event" when no playable round remains. Impact preview, reason (Weather / Safety or emergency / Other), optional note, "Declare an overall event champion?" defaulting to No, confirmation that scores/Moments/presentation are kept. Unplayed rounds are marked cancelled (audited). No results are invented.
- champion = Yes only when the API receives boolean true.
- No champion: champions list empty at data level; no champion slide, no event_champion highlight, no crown/confetti/trophy; at-a-glance shows Players; leaderboard caption "Final standings - Event ended early"; summary text and event-stories do not name a winner; player card says "View Final Standings". Podium/standings, round and side-game winners, Makers & Breakers, Moments, closing all kept.
- Public link / PNG / PDF: LIVE (provisional, no crown); normal FINAL RESULTS (crown); ended early no champion EVENT ENDED EARLY / Final standings (podium, no crown); ended early with champion FINAL RESULTS / Event ended early (crown).

## 3. Verification (sandbox only)

- Full suite: 1349 tests, 1349 pass, 0 fail (was 1313; +35 new). Includes Lappen scenarios B (no champion) and C (champion = Yes), strict champion flag, 099-missing writes nothing, reopen clears flags, route permissions, migration shape, public board / PDF no-crown checks, deck without champion, clientBundleSafety.
- Old tests updated because behaviour deliberately changed: P2 auto-complete-on-cancel tests, completedEventAddRound pin, organiserJourney pin, status-label list, privacy key list.
- tsc (partial checker): only pre-existing noise (React key props, slideshowDeck 4). Manual grep for `<a href="/` pages: none new.
- Previews rendered in Chromium from the real components (sample invented players): see design-preview-ended-early-2026-10-25.

NOT verified: `next build`, `next lint`, live Supabase/Vercel, iPhone/Android devices, a real End Event against the database (migration 099 untested on a real DB).

- Device bug (25 Oct, Alex's Android screenshot): Cancel Round / End Event pop-ups were hidden behind the bottom tab bar. Dialogs now sit above it (z-index 120 vs nav 100), respect the phone safe area, and the action buttons are sticky. Source-pinned test added; NOT yet re-checked on a device.
- v3: Share Leaderboard popup also portalled to the page root (cannot be trapped under the tab bar by a parent), sticky Close, gold/dark-green button with share icon, "Copy Live Link". The organiser already enables the public link inside this popup (consent checkbox, then Turn on); unchanged. Not checked on Samsung/iPhone.

## 4. Limitations / risks
- Baked slide artwork title "FINAL LEADERBOARD" is unchanged (caption underneath says Final standings).
- Event Memories "Share Event Presentation" entry still appears for an un-ended Lappen event (no standings until the event is ended).
- "Most Points" event stat can still name the top scorer (a stat, not a champion declaration).
- Cancel reason not shown publicly; PNG limited to ~138 players; non-Latin characters print as "?" in the PDF.
- Pop-up sheets (Cancel Round, End Event, Share Leaderboard, Publish Presentation) now sit above the bottom nav and fit the visible screen (fix after device screenshot; not device-verified).
- Presentations already published before ending/reopening need republishing.

## 5. Rollback
Vercel instant rollback to the previous deployment. 099: DROP the six trips columns (reopen ended-early events first). 098: drop shared-leaderboard table. 097: see its rollback block.

Audio layer is NOT in this ZIP (held).
