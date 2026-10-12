# Presentation UX Polish — Delivery Report (12 Oct 2026)

Three fixes from real Samsung testing. No scoring, round-closure, Side Game, database or slideshow content-selection changes. Not deployed.

## 1. Entry flow
**Root cause:** the Phase D Review & Present deep link (`?startSlideshow=event|round`) called `chooseScope()` on arrival, which jumps straight to the "Which Memories should we include?" popup.
**Fix (memories/page.tsx):** the deep link now only *pre-selects* the scope and highlights the matching round chip. The organiser lands on Event Memories home (Group Photo, Upload Moments, gallery). **Create Slideshow** then calls the same `chooseScope()` with that scope, and the popup and all later steps are unchanged. Tapping a different round chip clears the pre-selection, so Create Slideshow falls back to the normal scope picker. URL cleanup and the once-only guard are untouched, so returning to the page cannot re-open the popup.
**Entry points audited:** My HQ Stage 5 has three: full-event deep link, round deep link, and plain `/memories`. The plain link already landed on the home screen. `EventMemoriesCard` links to `/memories` and was already correct.
**Side effect handled:** Create Slideshow is hidden when an event has zero photos, and the old deep link was the only way in. A Create Slideshow button now appears in that case when a scope is pre-selected.

## 2. Event Snapshot
**Root causes:** text was sized in `vw` (device viewport) on a letterboxed 16:9 canvas, so type overflowed the slide; and the Rounds column was centred at ~18% of width, directly over the golf ball.
**Fix (EventHighlightsPlayer.tsx, new presentationLayout.ts):** the canvas is now a size container and the slide is one composition sized in `cqw` (1% of canvas width), designed against the approved 1672×941 reference. Title scales by name length (one line where practical), EVENT SNAPSHOT sits directly beneath it, four equally sized stats align to the artwork's measured dividers, and the Rounds column starts at 19% (clear of the ball). Course names are larger and split "Club / Course" onto two lines as in the reference. Live data and the tie (2+) / pending (0) champion states are unchanged. No hardcoded demo data.
**"- Slide Show" in the title is not added by code.** The Event Memories page header shows the same text, and the deck passes the trip's stored name straight through (`trips.name`). That trip is literally named "Schaefers Invitational - Slide Show". Rename the trip and the slide updates; I did not strip text from names in code. Very long names scale down to fit.
**Browser note:** `cqw` needs container-query units (Chrome/Samsung Internet from 2022–23).

## 3. Moments / Bloopers label
New `MomentsSourceLabel`, mounted once, only on photo Moment and Blooper slides (never group photo, winners, champion, dividers).
- Portrait / square media (≥17cqw pillarbox each side): branded green/gold card in the right pillarbox, vertically centred, clear of the photo, close button and mute button.
- 4:3 and landscape: small translucent corner pill, top-left.
- Wording: **EVENT MOMENTS** / **BLOOPERS**, then "Relive it in My Golf → Moments", plus TEEIN' IT UP in the side card. BLOOPERS only for memories the organiser flagged as Bloopers; the "Moments & Bloopers" chapter also carries unassigned event Moments, which are labelled EVENT MOMENTS. This needed one additive, optional, display-only `isBlooper` field on the Blooper slide (from the existing memory record; it affects no selection or ordering).
- Waits for the real media size (image `onLoad` / video `loadedmetadata`) rather than guessing. Media is never cropped, stretched or moved. The label ignores pointer events and sits below the controls layer, so playback controls, mute and slideshow timing are unaffected.

## Verification
- Automated tests: **935/935 passing** (was 909; +26 new in `presentationUxPolish.test.ts`, 5 older tests updated for the changed behaviour). Sandbox-verified only.
- Visual: I rendered the real player component in headless Chromium (esbuild + React) at 1920×1080 and 900×415 (phone landscape), for the Event Snapshot (normal, 35-character and ~70-character names, tie, zero champion, 5 courses), and the label on portrait photo, 9:16 video, 4:3 and landscape media. These used stand-in images and fonts (Georgia/Helvetica, not Playfair/Lato), not your live data and not a real phone.
- **Full `tsc --noEmit` and `next build`: NOT RUN** (this sandbox cannot reach the npm registry; no React/Next types installed). `slideshowDeck.ts` was type-checked with the real compiler and showed no errors in changed lines (pre-existing noise from missing Supabase types elsewhere). Run the Vercel build before deploying.
- Real-phone acceptance: **not done** (checklist attached).
