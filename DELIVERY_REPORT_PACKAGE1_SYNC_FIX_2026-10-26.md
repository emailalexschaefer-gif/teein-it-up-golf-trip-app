# Package 1 — final correction: photo / caption / timer synchronisation (26 Oct 2026)

Baseline: the Package 1 release you phone-tested (branch `release-share` + Package 1). Package 3 / migration 100 not merged. Package 2 not started. No migrations. Nothing deployed.

## 1. Root cause (confirmed in code, then reproduced in a real browser)

Three small faults in `EventHighlightsPlayer.tsx`, all on the playback side:

1. **The slide timer started when the slide index changed, not when the slide was on screen.** A slow picture therefore used up its own viewing time. A 7 s winner slide whose photo took 4 s to arrive showed the complete slide for about 3 s.
2. **Only a plain photo slide was preloaded.** Side-game winner, champion, group-photo and blooper pictures were not, and their text was drawn immediately, so the caption showed first and the photo arrived later.
3. **The photo layers had no identity.** React reused one `<img>`, so the previous picture could sit under the next caption until the new one arrived.

Reproduced before changing anything: with the delivered build and a deliberately slow winner image, the winner text appeared with no picture for the first 7 s of its slot (the image arrived after the slide had ended) and the champion text showed before its photo. This was a real Chromium run with timed image responses, not a simulation of the logic.

## 2. Fix (small, playback-timing only — the presentation engine is not rebuilt)

- New `src/lib/presentation/slideMedia.ts`: which picture a slide needs, a per-URL loader (loading / ready / failed), and a "slide with its picture removed" fallback.
- The next 2 slides' pictures are fetched and decoded ahead of time (all kinds, including winner, champion, group and blooper photos).
- A slide's picture, caption and label are revealed together once its picture is decoded. Until then a small spinner shows (delayed so a fast or cached picture never flashes it).
- The auto-advance timer, and the champion confetti / celebration, start only when the slide is revealed. Pause, resume and manual navigation use the same path, so they behave as before.
- If a picture has not loaded 10 s after a viewer reaches the slide, or it fails, the slide shows its existing no-photo layout (the caption still appears) and carries on. A late arrival is ignored, so nothing pops in mid-slide.
- Photo layers are keyed per moment, so a previous picture can never sit under the next caption.
- Music is untouched; it keeps playing while a slide loads.

Files: `src/lib/presentation/slideMedia.ts` (new), `src/lib/presentation/slideMedia.test.ts` (new), `src/components/memories/EventHighlightsPlayer.tsx`, `src/lib/scoring/presentationUxPolish.test.ts` (one pin regex updated on purpose to allow the new `slideReady &&` gate).

## 3. Verification

**Sandbox-verified (real Chromium, timed image responses; a fake-clock simulation was not used for timings):**

| Scenario | Delivered Package 1 | This fix |
|---|---|---|
| Slow winner photo (16 s) | Winner text with no picture for its whole slot; photo arrives after the slide has ended | Spinner, then winner text and photo together, full 7 s counted from reveal |
| Champion photo (2.5 s delay) | Text first, photo later | Text, photo and confetti together after reveal |
| Back-to-back winner → Moment → Moment | Mismatch / short photo time | Each slide gets its full 5 s (winner 7 s) |
| Photo that never arrives (25 s) | Not handled | Falls back after 10 s to the no-photo layout, caption shown, full duration, then carries on |
| Pause during a slide, then resume | n/a | Time counted only while playing |
| Manual next / previous across a slow slide | n/a | Consistent; arriving at a loading slide waits, then shows it together |
| Fast / cached images | n/a | No spinner flash, no layout shift |
| Music | n/a | Plays throughout; pauses only on the champion slide, as designed |
| Each image | n/a | Fetched once |

**Tests:** full regression suite **1425 pass / 0 fail** (1410 before + 15 new: loader, preload, fallback, late-result, timeout bound, and source pins for timer/celebration/render gating). Syntax and strict type checks are clean on the new files; remaining type diagnostics are in older files and come from the sandbox lacking Supabase types.

**Not verified here (needs your phone):** real Samsung/iPhone behaviour, real mobile network speeds, how the production signed image URLs cache, and sound quality. `next build` and `next lint` cannot run in this sandbox.

## 4. Applause / cheers — confirmed unchanged

Applause is still disabled for the one reason in the earlier report: the source clip's licence cannot be verified. `public/audio/celebration-applause.mp3` is deliberately absent, the feature is off unless `NEXT_PUBLIC_PRESENTATION_APPLAUSE=on`, and a test fails if the file appears by accident. No unlicensed clip is enabled.

Simplest way to add a licensed clip later (about 5 minutes, no code change):
1. Obtain a clip with a licence that allows commercial use in an app (record it, or buy / use a CC0 or royalty-free clip) and keep the licence record.
2. Save it as `public/audio/celebration-applause.mp3` (short, roughly 5–10 s, MP3).
3. Set `NEXT_PUBLIC_PRESENTATION_APPLAUSE=on` in Vercel and redeploy.
4. Update the one test that asserts the file is absent, so the change is a conscious decision.

## 5. Deployment (only when you approve)

Same as Package 1: deploy this ZIP over the Package 1 release. No migration, no new environment variable. Existing shared presentations keep working; no republish is needed.

## 6. Short phone re-test (about 3 minutes)

1. Play the full presentation with autoplay on a normal connection. On each side-game winner slide the name and photo appear together, and stay for the full time.
2. Repeat after turning on Chrome's "Slow 3G" throttling or switching to weak mobile data. You may see a brief spinner; the caption and photo still appear together, and the photo still gets its full time.
3. Tap next / previous quickly across winner and Moment slides. Nothing from the previous slide lingers.
4. Pause and resume during a winner slide. Time only counts while playing.
5. Confetti starts when the champion photo and name appear, not before.
6. Music plays throughout and pauses only on the champion slide.
7. Controls stay hidden until you tap.
