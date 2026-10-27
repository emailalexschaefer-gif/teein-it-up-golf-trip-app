# V7 audit — HTTP 405 score submissions, round numbering, mismatch notifications (27 Oct 2026)

## HTTP 405 (confirmed mechanism, production trigger unconfirmed)
- `middleware.ts` answered an unauthenticated `/api/*` request with a redirect to `/login`. A redirected POST is followed by `fetch`, lands on the `/login` page and returns 405. The client treated any non-401/408/425/429 4xx as permanent, so the queued score became `rejected`.
- Fix: unauthenticated `/api/*` returns JSON 401. "Signed out" is shown ONLY when auth failure is established: a 401, or a redirect that ended on a sign-in page (`/login`, `/auth`, `/signin`). Any other 405 or redirect keeps the score queued and shows `Server refused the score request: HTTP 405 at <path> ... kept on this device and will retry`, one request per pass. Old `HTTP 405` rejections are re-queued on start-up, newest row per hole/role only.
- Queued rows (pending/error) are retried by the normal timer, so they send after sign-in. Real refusals (e.g. 422) stay rejected with their reason.
- Safety: signed-out with 34 queued rows sends one request and rejects none; recovery cannot resurrect superseded rows; the server still keeps the latest `entered_at` and the organiser lock (`decideScoreWrite`). Tests: `transport405.test.ts`.
- Not confirmed: why the PC session lapsed in the field.

## Round numbering
- Rule: one function (`numberRounds`) numbers ALL rounds, cancelled included, in stable scheduled order (play_date, created_at, id). Cancelled rounds keep their number. Eligibility (cancelled / unscored excluded from results) is a separate step applied after numbering.
- Applied to: My HQ, My Golf, Event Schedule, round page/banner, Release, Arrangements, My Round, Leaderboard (page, live, public share), Side Games, Final Results, Moments manifest/presentation, memories chips.
- Display only: stored round names are never rewritten.
- **Limitation:** the database has no stored round number. Editing a round's date or deleting a round can change a derived label. Immutable numbers need a stored column (a migration), not added in V7 (no speculative migrations).

## Mismatch notifications
- Cause: the "Scores Don't Match" warning was built only on a forward tap from the hole on screen. A disagreement that appeared later (partner's entry synced after moving on) was never announced.
- Fix: `findLateMismatches` reads saved captures for every hole in both directions; a non-blocking banner offers "Go to Hole N" and "Dismiss". Acknowledged per exact disagreement, so an edited dispute re-announces. Waiting, matched, organiser-resolved, shared-device and paper never warn.
- Indicators: one `statusIndicator` mapping (green matched / red mismatch / amber waiting or organiser override) now drives the hole badge and Round Summary rows; waiting now shows an amber badge on the hole.

## Unscored completed rounds vs official results
- Confirmed: `finalResults.ts` counted any `completed` round. An unscored completed round became the countback "final round" (empty hole points), added a zero column to the standings and could list a 0-point winner.
- Fix: rounds with no recorded scores are excluded from standings, countback, round winners, side competitions and the event engine. They keep their number. Scoring rules are unchanged.

## Makers & Breakers
- Flow is now Select -> Save -> Review & Present. Saving is the only write; presenting uses the saved highlights; the separate "Finish & Publish" step is removed. Skip and Edit Selection remain.

## Playing-partner box
- The "hasn't started scoring yet" box is hidden as soon as the partner is detected.

## Group Photo shown twice (added after review)
- Cause: the Group Photo has its own slide, but the same Moment was not removed from the ordinary Moments stream. A group photo that was a round Moment, or an unassigned event upload auto-suggested into the aftershow, played twice. (Event-level photos were already de-duplicated in Package 1.)
- Fix, in both deck builders: when the Group Photo slide is shown, that Moment is excluded from round Moments, event-level Moments and the aftershow. The Moment itself is untouched (Event Memories keep it). If the Group Photo slide is switched off, it remains an ordinary Moment.

## Backlog (not in V7)
- Permanent stored round numbers (needs a migration) before public launch.
