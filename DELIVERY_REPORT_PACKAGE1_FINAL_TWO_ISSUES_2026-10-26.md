# Package 1 — final two issues: champion applause and the fullscreen notice (26 Oct 2026)

Baseline: the Package 1 sync-fix release. Package 2 and 3 untouched, no migrations, nothing deployed.

## 1. Fullscreen notice on the opening slide

**Cause (confirmed from the source):** the grey message is not in Teein' It Up (no such text exists anywhere in the code). The player called `requestFullscreen()` automatically on open, and Android Chrome answers every fullscreen request with its own "viewing full screen / swipe to exit" notice. A page cannot hide or shorten it, so no CSS or JavaScript workaround was attempted.

**Fix:**
- The player no longer requests browser fullscreen by itself. It is already a full-viewport overlay, so it opens clean.
- A new optional full-screen button (in the tap-to-reveal controls, shown only where the browser supports it) requests fullscreen only when the viewer taps it. Chrome's notice then appears only for viewers who asked for it.
- Landscape: the rotate hint remains for portrait phones, and the landscape lock is still applied when the viewer chooses fullscreen. Android only allows that lock in fullscreen, so without it viewers rotate the phone.
- Sizing: without fullscreen the address bar stays visible, so the 16:9 canvas is now sized from the player's own visible box (container units, already used by the slides) instead of the viewport height, so the bottom controls are not clipped.

## 2. Champion applause and cheering

**Cause:** a missing asset, not a playback fault. `celebration-applause.mp3` was deliberately not shipped (the recovered V62 clip had no verifiable licence) and the feature flag was off. The champion trigger, mute handling and celebration logic were already correct.

**Fix:**
- New original clip `public/audio/celebration-applause.mp3` (9.43 s, MP3), **synthesised** from random noise and simple oscillators (crowd claps, a swell, a few cheer-like "woo" voices). It contains no recorded or third-party audio, so there is no licence to clear. The seeded generator is kept in `local-test-assets/generate_applause.py`. The V62 clip is still not used or shipped, and a test guards that.
- Applause is now on by default. `NEXT_PUBLIC_PRESENTATION_APPLAUSE=off` in Vercel switches it off without a code change.
- Found while testing: the champion slide lasts (slide time + 2) s, which is 7–12 s, but the celebration needs about 10.4 s, so the cheering and confetti could be cut off when the slide advanced. The champion slide now stays up for the whole celebration (reveal pause + 9.4 s + a 1.2 s beat). Other slides are unchanged.

**Be aware:** I cannot listen to audio. I verified the file decodes and plays, its length and level, and when it starts and stops, but not how it sounds. It is a synthesised crowd, so it may sound less natural than a real recording. Please judge it on your phone. If you want a real recorded crowd, drop a licensed MP3 over `public/audio/celebration-applause.mp3` (any royalty-free or purchased clip with a licence record, about 9–10 s); nothing else needs changing.

## 3. Verification

Sandbox-verified in real Chromium (phone-size viewport, real audio elements):
- Opening the presentation makes **0** fullscreen requests; the control appears after a tap; tapping it makes exactly **1** request.
- Canvas is 16:9 and fits the player box.
- Champion slide: music fades and pauses, then applause starts about 1 s after the reveal, plays the full 9.4 s with no media error, confetti (71 pieces) runs alongside, the slide then advances, and music resumes. Applause stops if the viewer leaves the slide early (existing tests).
- Existing behaviour retained: photo/caption sync, music, navigation, pause/resume, controls hidden until tap.

Tests: full suite **1428 pass / 0 fail** (was 1425; changed the licensing guards to the new asset rules and added fullscreen and champion-hold tests). Syntax check clean. `next build` / `next lint` cannot run in this sandbox.

**Not verified here:** a real Samsung or iPhone, Chrome's fullscreen behaviour on the phone, how the clip sounds, and Chrome's autoplay rules on your phone (the existing first-tap audio unlock is unchanged, so the music working for you is a good sign).

## 4. Deployment (only when you approve)
Deploy over the sync-fix release. No migration, no environment variable needed (set `NEXT_PUBLIC_PRESENTATION_APPLAUSE=off` only if you want applause off). Public and private sharing code is unchanged; `/audio/` was already reachable by public viewers.

## 5. Short phone re-test
1. Open the presentation: no grey notice, opening slide clean.
2. Tap the screen: controls appear, including the new full-screen button. Tapping it enters fullscreen (Chrome's notice is expected then).
3. Play to the champion slide: music fades out, then applause and confetti start together and last about 10 s, then the show moves on and music returns.
4. Also check a shared public link: the same applause plays without signing in.
5. Confirm photo/caption timing, navigation and pause/resume as before.
