# Presentation Audio & Champion Celebration — FINAL SEQUENCE — 23 Oct 2026

Isolated layer on the frozen Release 3S pilot (which sits on 3A). **NOT DEPLOYED.** No migrations, no scoring/offline/Supabase/RLS/sharing/privacy changes, no 3B.

## Final sequence (implemented to the consolidated brief)
1. **Normal slides:** Funky Clubhouse Mix, 25%, looping, one instance, never restarted by slide changes; starts from the viewer's Watch/Play tap; blocked autoplay retries on the next tap; ♪ toggle in the hidden controls layer, remembered for the session; stops and is disposed on exit.
2. **Overall Champion (the only celebration):** music fades completely out over 0.5 s and **pauses** (position kept) → champion name/photo/trophy shown → after ~1 s **applause and confetti start together** (confetti is triggered by the applause's real `playing` event; length tracks the clip's real duration, clamped 9–10 s, 9.4 s fallback) → applause ends naturally, confetti clears, champion stays on screen **in silence** → music does **not** return while on this slide.
3. **Top 5 Final Results:** standings only — no applause, no confetti. Music resumes from its paused position, fading in over 0.7 s to 25%. If the viewer leaves early, applause and confetti stop immediately and music restores; jumping straight to Top 5 just plays normal music.
4. **Closing:** music continues; no effects.
- Deck order was already Champion → Top 5 → Closing (verified by test on the real deck builder).
- One celebration trigger (`isCelebrationSlide`, champion only); one `celebrate()` call site in the player.
- Audible Blooper video fades music out/pauses and resumes it after; muted video doesn't duck; video can never bring music back on the champion slide.
- Without applause (flag off / ♪ celebration sound muted / blocked / failed / stalled): same reveal, ~9.4 s confetti (none under reduced-motion), music stays off for that slide, nothing gets stuck (3 s start timeout). A viewer's "music off" is never overridden.
- Every delayed callback is tied to a generation counter, so late timers/events from an earlier visit can't act on a later slide (rapid Champion → next → Champion tested). Music and applause are never audible at once (tested).
- Same shared player on all three surfaces; `/audio/` stays a public static path; publication/token/privacy logic untouched.

## Applause licensing — STILL A PUBLIC-DEPLOYMENT BLOCKER
Source and reuse rights of the V62 recording are unverified (organiser reports it was found online; metadata proves nothing either way). Therefore:
- The file is **not in `public/`** and is not served by this package. It is supplied unmodified (9.43 s, byte-identical to your upload) at `local-test-assets/celebration-applause.mp3` with a README for **local testing only**: copy to `public/audio/`, set `NEXT_PUBLIC_PRESENTATION_APPLAUSE=on`, then delete the copy before any deployable build.
- An automated test fails if `public/audio/celebration-applause.mp3` exists, and another asserts the flag defaults off.
- Production: keep the flag unset until rights are verified or a licensed replacement is supplied. I did not create or source any replacement audio.

## Files changed vs the 3S pilot
New: `public/audio/funky-clubhouse-mix.mp3`; `local-test-assets/{celebration-applause.mp3,README.md}`; `src/lib/presentation/{audioConfig,audioController,audioChannel,celebrationTrigger}.ts`; `src/lib/presentation/audioController.test.ts`; `src/components/memories/{usePresentationAudio.ts,PresentationConfetti.tsx}`.
Modified: `src/components/memories/EventHighlightsPlayer.tsx`, `src/lib/auth/publicStaticPaths.ts` (+ its test), `src/middleware.ts` (matcher string only: `audio/` excluded).
Nothing else differs from the 3S pilot (checked with a directory diff).

## Verification
- **Automated: 1252 / 1252 pass** (3S pilot 1228; audio +24), including the pre-existing "controls hidden until interaction" wiring test unchanged. New tests map to your list: start after interaction/25%/loop/no restart; toggle and stored preference; audible vs muted video; champion fade-out and pause; applause+confetti together and only after music stops; confetti tracks applause length; music stays off after applause; once per visit, no replay on re-render; clean revisit; leaving stops applause and restores music from the same position over 0.7 s; Top 5 and closing never celebrate (all slide kinds checked, real deck order); dispose; missing/off/blocked/stalled applause; reduced motion; rapid navigation; blocked-autoplay recovery; no database/signed-URL code in audio modules.
- Strict lint, hooks and type checks on the new modules: clean. 
- **NOT available/run here: real `tsc`, `next lint`, `next build`; any real audio output; Android Chrome / iPhone Safari; the iOS WebAudio gain path; loop seam smoothness.** Tests use fake audio channels and a fake clock — they prove the sequencing logic, not how it sounds.
- No scoring, offline, Supabase or permission files were touched (see file list).

## Caveats
- Native MP3 loop may have a tiny seam gap.
- If a browser blocks the first music start there is no banner (by design); any tap retries and the ♪ button has a tooltip.
- Mobile OS/browsers may pause audio on screen lock or tab switch; not promised otherwise.
- The public link streams the 1.28 MB music file once per viewer.

## Real-device acceptance (needed before approval)
Music after Watch/Play and continuous across slides; ♪ off/on; Blooper video priority; Champion: music stops, applause + confetti together ~9–10 s, silence after, champion still readable; advance to Top 5: music returns smoothly, no effects; Closing keeps music; exit = silence; revisit Champion replays; advancing mid-applause stops it; reduced-motion on = no confetti; signed-out public link on iPhone Safari and Android Chrome. For applause tests use the local-only copy described above and delete it afterwards.

## Rollback
Redeploy the previous 3S (or 3A) build; this package is separate and optional.
