# Combined Release: Package 1 (Share Leaderboard) + Package 2 (Cancel Round and Finalise Event)

Date: Sun 25 Oct 2026. Nothing has been deployed. No migration has been applied. Both are yours to do.

This ZIP contains, in one flat tree:
- the 3S baseline (Event Presentation sharing, Chat card, My Golf link)
- the `node:crypto` build repair (`tokenShape.ts` split, with a guard test)
- the Event Presentation sharing discoverability fix
- Package 2, exactly as delivered earlier (no refactor)
- Package 1, built on top

## 1. Migrations: run in this order, in the Supabase SQL Editor

1. `supabase/migrations/097_round_cancellation.sql` (Package 2)
2. `supabase/migrations/098_shared_leaderboards.sql` (Package 1)

Steps: Supabase dashboard > SQL Editor > New query > paste the whole of 097 > Run. Confirm "Success". New query > paste the whole of 098 > Run. Do 097 before 098, and both before (or at the same time as) the Vercel deploy goes live. Deploying the code first is safe for existing screens, but Cancel Round and Share Leaderboard will show an error until their migration has run.

Quick checks after running (read-only):
- `select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid='public.rounds'::regclass and conname='rounds_status_check';` should list upcoming, active, completed, cancelled.
- `select count(*) from public.shared_leaderboards;` should return 0 (no event is public).

Both files are re-runnable (IF NOT EXISTS / constraint scan). Neither changes any existing row. Neither edits an already-shipped migration.

## 2. What Package 1 does

- **Share Leaderboard button** on the event Leaderboard page, visible to every participant (hidden for practice rounds).
- **Public read-only link** `/l/<token>`: opens with no login on a phone; token is 256-bit (43 characters); noindex; no-referrer; unknown, malformed and revoked tokens all give the same "no longer available" page.
- **Live throughout the event**: NOT STARTED, LIVE (with Thru N / F per player), ROUND COMPLETE (between rounds), EVENT FINAL. Multi-round events show R1..Rn columns and totals with a countback note. Polls every 30 seconds only while the tab is visible; the server response is cached 15 seconds so many viewers cost one calculation.
- **Same numbers as the app**: the leaderboard calculation was moved unchanged into `src/lib/scoring/roundLeaderboard.ts` and is used by both the member route and the public link. There is no second scoring calculation. The member route keeps its own auth, practice and 404 rules.
- **Organiser control**: only the organiser can turn the link on. The panel says plainly that anyone with the link sees every player's full name and score, with no login, and requires a ticked acknowledgement; the server refuses without it. The organiser can turn it off at any time (confirm prompt). Turning it off is permanent for that link; turning it on again makes a new link. Existing events are not public until an organiser does this.
- **Non-organiser players** see the link once the organiser has enabled it (Copy Link, Share). Otherwise they see "your organiser hasn't turned on the public link yet" and can still save an image or PDF.
- **What is public**: full name, position, points, holes played. Never emails, contact details, handicaps, avatars, player ids, per-hole scores, chat or Moments. The public shape is built by picking fields, with a test that fails if any private field appears.
- **Copy Link and native phone sharing** (share sheet where the browser supports it; falls back to copy).
- **Branded PNG** of the whole leaderboard (1080 px wide, up to 2x), with Teein' It Up header, logo, status, footer invitation ("Scored live with Teein' It Up ... Discover the app").
- **Paginated PDF**, A4, any number of players, repeated table header, "Page x of y", same branding. Built by a small dependency-free generator.
- **Practice rounds** are excluded everywhere.
- **Telemetry**: `/l/<token>` is redacted from analytics and performance metrics so tokens are not logged.

## 3. Audio: would anything currently deployed be lost?

The audio layer (music and applause on the presentation) was a separate held build (`release-3s-audio`). It was never part of the 3S ZIP I told you to upload, and this combined ZIP contains no audio files, no `public/audio`, no audio hook and no confetti component.

- If you deployed the 3S ZIP (no audio): nothing is lost.
- If at any point you deployed the separate audio ZIP: deploying this combined ZIP would remove that music and applause from the presentation player. Applause licensing was never confirmed, so I have not carried it forward. Tell me if you did, and I will produce a version with the audio layer re-applied on top.

## 4. Tests: sandbox results

Full suite on the shipped tree: **1308 tests, 1308 pass, 0 fail** (baseline before Package 1 was 1259; Package 1 added 49).

New Package 1 test files:
- `publicBoard.test.ts` (9): statuses, ties, multi-round columns, privacy shape, hostile names.
- `service.test.ts` (17): link enable idempotent and race-safe, revoke, revoke does not affect other events, malformed tokens rejected before any database read, database failure paths; boards before / during / between / after rounds; Lappen scenario (Saturday completed, Sunday cancelled, event completed gives a one-round EVENT FINAL and ignores the cancelled round's scores); public board equals the member leaderboard on a 20-player fixture; 20- and 50-player boards.
- `exportPdf.test.ts` (10): 0, 2, 20, 50 and 120 players: valid xref offsets, ASCII-only, every player present once, 50+ paginates, footer "Page x of y", header repeated; encoding and awkward names.
- `sharePackage.test.ts` (12): PNG layout limits, public route access, cache header, no write operations in the public route, organiser-only enable/revoke, acknowledgement required, members-only snapshot, UI wiring, migration 098 shape, token redaction.
- `clientBundleSafety.test.ts` extended so the leaderboard service cannot be imported into a browser bundle.

Real-file checks beyond unit tests (sandbox): generated PDFs opened with qpdf, pdfinfo, pypdf, pdftotext and rendered with pdftoppm at 2, 20, 50 and 120 players; the PNG renderer run in real Chromium (mobile-emulated) at 0, 2, 20 and 50 players and viewed.

Regression coverage (combined): Lappen cancelled-round scenario and full Event Presentation deck with one completed and one cancelled round (Package 2 tests, still passing); Package 2's 21 cancellation tests; existing scoring, verification, Stableford, side-game and Moments suites all pass unchanged (I did not touch those modules); Event Presentation sharing entry points test (`organiserJourney`) passes.

## 5. Not verified (be clear about this)

- `next build`, `next lint` and full `tsc` could not be run here (no Next.js toolchain or npm registry). Type-checking with the real TypeScript compiler (React/Next types unavailable) shows no diagnostics in the new files except one that comes from the missing React types in the sandbox (`PublicLeaderboardView.tsx` line 68; the value is already null-guarded two lines earlier). **The Vercel build is the first real compile of the new code.** If it fails, send me the log.
- Not tested on real devices or browsers: iPhone Safari, Samsung Internet, the native share sheet, and file downloads or "save to Photos" from the phone. The PNG was verified in Chromium only.
- Not run against a real Supabase: the SQL, RLS and unique index were reviewed and shape-tested, not executed. The public link's behaviour was tested against an in-memory store that mirrors the same constraints.
- The Lappen scenario and presentation were verified at data and deck level, not on a live screen.

## 6. Known limitations

- PNG supports up to about 140 players in one image; beyond that the app tells the person to use the PDF. The PDF has no player limit.
- PDF uses a standard font: names with characters outside Western European (for example Chinese, emoji) show as "?" in the PDF. The PNG and the web page show them correctly.
- After the organiser revokes the link, a viewer whose copy is cached may still see standings for up to roughly 15 to 45 seconds. New requests are refused straight away.
- A public viewer sees the leaderboard of the active round, or the latest completed round, plus event totals. They cannot browse other rounds.
- Cancel Round: the reason is stored but not yet shown to players; the invite page and Run Again counts still include a cancelled round; only unplayed rounds can be cancelled (abandoning a partly-played round is not supported); DNF handling untouched.
- Public live scores are provisional until the organiser closes the round (the page says so).

## 7. Vercel build expectations

Expect a normal build with the new routes `/l/[token]`, `/api/l/[token]`, `/api/trips/[tripId]/share-leaderboard`, `/api/trips/[tripId]/leaderboard-snapshot` and `/api/trips/[tripId]/rounds/[roundId]/cancel|reinstate`. No new npm dependencies. No new environment variables. The earlier `node:crypto` failure is guarded by a test; if the client bundle fails again it will name the file.

## 8. Rollback

- **Code**: in Vercel, Deployments > select the previous production deployment > Promote / Instant Rollback. Needs no database change; the new tables and column are ignored by older code.
- **Package 1 data**: `DROP TABLE IF EXISTS public.shared_leaderboards;` (removes every public link; nothing else depends on it). Run this to cut off all public access immediately if ever needed.
- **Package 2 data**: first reinstate or otherwise resolve any cancelled round (older code does not understand `cancelled`), then run the ROLLBACK block at the bottom of `097_round_cancellation.sql`.

## 9. How to check it after deploying (about 10 minutes)

1. As organiser on a test event, open Leaderboard > Share Leaderboard. Confirm the warning and tick-box, turn the link on, copy it.
2. Open the link in a private/incognito phone tab (no login). Confirm names and points, and that nothing else is shown.
3. Score a hole as a player; within about 30 seconds the public page should update.
4. As a non-organiser player, open Share Leaderboard: link visible if enabled; Save image and Save PDF work.
5. Turn the link off; reload the public page: "no longer available".
6. On a test event with two rounds, cancel the unplayed one from My HQ, close the first, and confirm the event completes and Share Event Presentation is available.
