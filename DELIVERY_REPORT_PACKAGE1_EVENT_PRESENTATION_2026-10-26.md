# Package 1 — Event Presentation restoration & reliability (26 Oct 2026)

**Not deployed. No migration applied or required. No environment variable required.** Built from `release-share` (presentation public-link fix, 1,368 tests). Package 3 / migration 100 not merged. Canonical scoring untouched.

## Root cause and fix, per item

**1. Background music — restored.** Not a bug in the current code: the music layer (`usePresentationAudio`, `lib/presentation/*`, `public/audio/funky-clubhouse-mix.mp3`) was built on 23 Oct as a separate, optional layer on the 3S pilot and was never merged into the v3 → share line, so this branch had only video-clip audio. Re-applied as the same code (diff of that layer vs the pilot applied to the current player, nothing else changed) plus `/audio/` added to the public static paths so public (signed-out) viewers get the music instead of a login redirect. Music is an original generated track (approved earlier), starts from the Watch/Play tap, 25% volume, loops without restarting on slide change, ♪ toggle in the (hidden-until-tap) controls, stops on exit, failure never blocks the slideshow.

**2. Sound effects / applause — code restored, asset BLOCKED (licensing).** Same cause as item 1. The only effect that ever existed was champion applause, and that clip's source and reuse rights are unverified (found online). I did **not** ship it and removed it from the package; the feature stays off (`NEXT_PUBLIC_PRESENTATION_APPLAUSE` unset, no file in `public/`), and a test fails if the file is ever committed to `public/audio/`. Applause code only runs on a declared Overall Champion, respects the viewer's mute, plays once per visit, never overlaps music. **Needed from you:** a clip you have rights to (e.g. your own clubhouse recording with players' agreement, or a clip from a library whose commercial/public-use licence you have read and can keep a copy of). Drop it at `public/audio/celebration-applause.mp3`, set the env var to `on`, redeploy. I cannot verify a third-party licence from here and have not invented a replacement.

**3. Champion confetti — restored.** Same cause: confetti inside the presentation only existed in the audio layer (the existing `ConfettiBurst` is on the Final Results page, not the player). With applause off, confetti still runs ~9.4 s at the champion reveal (none under reduced-motion), music pauses for that slide and resumes on Top 5. The champion slide exists only when a champion is declared (deck builder, unchanged); the trigger is that slide kind only. Event ended early without a champion: no champion slide, no crown, no confetti, no applause; Final Standings stay.

**4. Missing photos with All Memories — real defect, fixed.** The older builder put photos with no round (event-level uploads: arrival, dinner, prize-giving) under an "Event Memories" divider. The configurable builder used since the flexible builder dropped them, so **All Memories, Favourites and Choose Memories all silently left them out**, and the Review grid never showed them. Fix: one shared eligibility rule (`isPresentationPhotoCandidate`) used by the deck builder, the selection resolver and the three organiser screens; for a full-event presentation, event-level photos appear under one divider after the opening/group photo/event numbers and before the rounds (same placement as before); a single-round presentation still contains only that round. The group photo is not repeated. No cap exists in the builder (verified; a 250-photo test passes with 250 slides). Review now says "X of Y photos are on photo slides" and, for All Memories, explains the deliberate omissions: a Side Game winner's photo is on the winner slide, non-winner Side Game photos are left out (existing 18 Oct rule), videos play in the aftershow. A photo whose file cannot be found now shows "Photo unavailable" (was a silent black frame) and a failed load logs the Moment id; the slideshow continues.
Other reasons a photo can be absent, all by design and **not changed**: audience "playing group only" (excluded from published decks; the publish panel lists the count), text moments, a round left out, **and photos uploaded after publishing (the published snapshot is frozen until you press Update)**. I cannot see Darren's data, so I cannot say which applied at Lappen; the event-level omission is the confirmed code defect.

**5. Navigation controls — already correct in this branch; verified.** The 18 Oct fix (controls start hidden; only tap/click/focus reveal them; a slide change never does) is present, with its test. I did not change it. Verified in a real Chromium run with a 5 s slide timer: controls hidden throughout automatic advances, shown on tap, hidden after 3.5 s idle. If Darren's phone still showed them on every slide, his deployed build predates that fix — please confirm what build was live.

**6. Private / public sharing — verified, plus last package's clarity fix.** Private = members-only page and media route both check event membership; public = `/s/{token}` only when the publication is active **and** public sharing was explicitly enabled with the clearance acknowledgement, served from the consent-filtered public deck and approved Moments only; revoke/disable stops page and media. Nothing is made public implicitly (default off; unticking while public warns that existing links stop). The panel labels members-only vs public links (previous package). Public sharing has no connection to marketing use of content (tests assert no marketing flag is read or written by sharing).

## Verification
- Full suite **1,410 pass / 0 fail / 0 skipped** (baseline 1,368 + 24 restored audio tests + 18 new Package 1 tests). Mutation check: reverting the event-level fix makes 6 of the new tests fail.
- Lint-style and hook checks clean on all changed/added files. Type check: no new diagnostics beyond the known stub artefacts (a `key` prop and an inferred `any` from stubbed React types); `next build`, `next lint`, real `tsc` were not available here.
- **Real Chromium (desktop engine, mobile emulation), real audio element:** from a tap on "Watch Presentation" under default autoplay policy the music started and ran continuously (position advanced, never restarted) across slides; champion slide paused the music and showed confetti once; ended-early/no-champion deck: music throughout, no confetti, no champion slide; reduced-motion: no confetti; controls hidden during auto-advance. Portrait and landscape screenshots reviewed.
- **Not tested (need your phone):** Samsung Chrome, iPhone Safari (including iOS audio start/gain path), screen-lock behaviour, loop seam smoothness, how it sounds, signed media URLs in production, WhatsApp, a real Lappen data run, applause (asset blocked).

## Files
Added: `public/audio/funky-clubhouse-mix.mp3` (1.28 MB); `src/lib/presentation/{audioConfig,audioController,audioChannel,celebrationTrigger}.ts` + `audioController.test.ts`; `src/components/memories/{usePresentationAudio.ts,PresentationConfetti.tsx}`; `src/lib/trips/package1Presentation.test.ts`; `local-test-assets/README.md`.
Modified: `src/components/memories/EventHighlightsPlayer.tsx`, `src/lib/trips/slideshowDeck.ts`, `src/app/(app)/trips/[tripId]/memories/page.tsx`, `src/lib/auth/publicStaticPaths.ts` (+test), `src/middleware.ts` (matcher string only).
New assets: music MP3 only. Migrations: none. Env vars: none (optional `NEXT_PUBLIC_PRESENTATION_APPLAUSE=on` later).

## Deployment (when you approve)
1. Replace the repo contents with this ZIP's files (flat), commit, let Vercel build. 2. Open the Lappen presentation → Memories → Create/Share → check the "X of Y photos" line → **Update published presentation** (needed to pick up event-level photos and any later uploads). 3. Rollback: redeploy the previous build.

## Phone acceptance checklist (about 5 minutes)
1. Open Lappen presentation, tap Watch → music starts within ~2 s (volume up).
2. Slides advance; controls stay hidden. Tap once → controls show; wait → they hide.
3. ♪ off, then on: music stops/starts. Pause/Play and ‹ › work.
4. Reach Champion: music stops, name shows, confetti ~9 s. (No applause until a clip is added.)
5. Next to Top 5: music returns, no confetti. Closing: music continues. Close: silence.
6. Event-level photos (dinner/arrival) appear under "Event Memories" before Round 1.
7. Review screen: "X of Y photos" matches what you expect.
8. Private link while signed out → asks to sign in. Public link (after enabling) in a private tab → plays with music, no login.
9. Repeat on iPhone Safari if you can.
