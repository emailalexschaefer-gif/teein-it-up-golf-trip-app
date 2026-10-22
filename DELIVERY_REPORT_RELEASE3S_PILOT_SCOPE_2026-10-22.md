# Release 3S — Pilot Scope (simplified) — 22 Oct 2026

Baseline Release 3A. No 3B cosmetics. **Not deployed. No migration applied.**

## Verification
- Automated tests: **1228 / 1228 pass** (3A: 1196), re-run on a fresh extract of the ZIP.
- Strict lint on all changed/new files: clean (one `any` in `lib/sharing/server.ts` with a directly-preceding disable comment, the same pattern the repo already uses for the admin client).
- **Not run (unavailable here): real `tsc`, `next lint`, `next build`; live Supabase/RLS; devices; WhatsApp previews.** Vercel's build is the first real compile.

## Minimal change plan (what changed from the previous 3S package)
Removed: final-round consent prompt, consent API route, `presentation_media_consent` (**migration 097 deleted — not needed**), player-consent/paper-player/group-photo-consent eligibility, prompt wiring in My Golf. Scoring completion flow untouched.
Kept: organiser-only **Publish** (Playing never publishes), automatic single Chat card, Watch Presentation, Copy Link, My Golf → event → **Watch Event Presentation**, unpublish/revoke, republish keeping the same link.
New/changed for the pilot:
1. **Two modes when publishing.** Default = **event members only** (nothing public exists; the public link returns "no longer available"). Optional tick: *"Also allow a shareable link for people outside the event."*
2. Public mode requires the organiser to **confirm clearance** ("players have been told… any media without permission is removed below") and shows a **tap-to-remove grid** of every photo/video; removed items are excluded from the public version only. Public names default to abbreviated; full names need a second tick.
3. Public access remains limited to the stored approved snapshot: group-only Moments and text never included; no storage paths or signed URLs stored; 10-min media URLs; tokens revocable; identical 404 for bad/revoked/non-public.
4. Chat card: **Copy Link shows only when public sharing is on**; otherwise just Watch Presentation. If you enable public later, **Update** the presentation (same link, same single Chat card).
5. Migration **096 only** (edited before any application): adds `public_enabled` (default false) and `public_cleared_at`.

## Files
New: `supabase/migrations/096_shared_presentations.sql`; `src/lib/sharing/{token,names,eligibility,snapshot,configSchema,chatMessage,server,publish}.ts` + 3 test files; `src/lib/auth/publicRoutes.ts`(+test); routes `share-presentation`, `presentation/media/[momentId]`, `api/s/[token]/m/[momentId]`; pages `app/s/[token]`, `(app)/trips/[tripId]/presentation`; components `SharePresentationPanel`, `SharedPresentationViewer`, `WatchPresentationLink`, `PresentationCard`.
Modified: `middleware.ts` (adds only `/s/` and `/api/s/`), `memories/page.tsx` (Publish button/panel), `EventMessages.tsx` (card), `MyRoundClient.tsx` (Watch link), `trackEvent.ts` + `perfMetrics.ts` (token redaction from analytics).

## Migration
Run **096 only**, after reviewing it (additive, RLS on, no policies → service role only). Do not run 097 (removed). Run before deploying.

## Risks / limits
- Build and SQL unverified (above). Test signed-out viewing on the production domain (Vercel preview URLs are often login-protected).
- Clearance is the organiser's attestation, not tracked per player. Once a public link is forwarded, photos can be saved; unpublishing stops new access only.
- Name abbreviation replaces full names only; a bare first name in a caption is not changed.
- Group-only photos still show to members in the existing gallery (pre-existing, unfixed); the new presentations exclude them.
- Publish after the event is marked complete, or no champion slide.
- Video playback via redirect on iPhone Safari untested.

## Rollback
Redeploy 3A. Stop sharing instantly: Unpublish, or `UPDATE public.shared_presentations SET status='revoked', revoked_at=now() WHERE status='active';`. Optional: `DROP TABLE public.shared_presentations;`.

## Rehearsal checklist
Scoring/offline regression first. Then: Round 1 and 2 show no new prompts; Memories → build → ▶ Play (nothing published, no Chat post) → **Publish with public OFF** → exactly one Chat card (Watch only); tap Publish/Update again → still one card, same link; Watch from Chat and from My Golf → event. Then **Update with public ON**: tick clearance, remove a photo, publish → Copy Link now appears; open it **signed out on another phone**: plays, removed photo absent, winner slides use trophy artwork, names abbreviated, no group-only photos. Unpublish → link and media say "no longer available"; publish again → new link + new card. Android Chrome and iPhone Safari photo/video playback.

## Final freeze additions (22 Oct, late)
- **Chat card reads live status.** `PresentationCard` and `WatchPresentationLink` query `/share-presentation` (not the message text): refetch on mount/focus and every 15 s while visible (paused in background tabs); the publish panel also invalidates it immediately. So Copy Link appears/disappears without refreshing Chat. (Source-checked by test; behaviour on devices not yet seen.)
- **Winners are always celebrated.** Test: with the champion's and a side-game winner's photos removed, the public deck keeps the champion, side-game winner and round-results slides with names (abbreviated) and points; photo fields are null (the existing trophy artwork shows); the members' version still shows the real photos; the removed photos' ids appear nowhere in the public deck.
- **Switching public sharing off** keeps the same token for members, sets `public_enabled=false`, and the public page and media routes (which require `public_enabled=true`) return the same "no longer available"/404 immediately, so a previously copied link stops working; switching it on again restores the same link. The panel pre-ticks the current state and warns before an update that would switch public sharing off.

## Build, migration, deployment, rollback (nothing is done automatically)
1. Review `supabase/migrations/096_shared_presentations.sql` (full text supplied in chat).
2. Ideally apply it first to a **separate Supabase project/branch**, point a Vercel Preview at it, and test there; otherwise apply to production **before** deploying (additive; harmless if unused).
3. Upload this ZIP to the Vercel project as the new deployment (flat root, no parent folder). If the build fails, send the log; expect a targeted repair only.
4. Smoke test order: scoring online/offline and round close; then Chat, My Golf; then public link signed out (production domain).
5. Saturday decision: promote 3S only if scoring + Chat + My Golf pass; publish **members-only first**, enable external sharing only after the media has been reviewed.
6. Rollback: promote the previous 3A deployment in Vercel (instant). Stop sharing immediately: Unpublish, or `UPDATE public.shared_presentations SET status='revoked', revoked_at=now() WHERE status='active';`. Optional cleanup: `DROP TABLE public.shared_presentations;`.
