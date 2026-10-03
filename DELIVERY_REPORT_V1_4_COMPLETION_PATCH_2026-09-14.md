# EVENT MEMORIES V1.4 -- COMPLETION PATCH
## Delivery Report

Build/test caveat, unchanged from every prior round: no network
access, no live database/Storage connection, no way to npm install.
Full test suite: 601/601 pass -- 291 pure-function scoring + 68
highlights + 8 analytics + 7 profile + 63 SQL-scanning migration tests
+ 164 trips.

Honest headline: a substantial amount of this patch (both schema
migrations, the group-photo API route, and the bulk of the video
capture flow) was already built before this session started, from an
earlier part of this same engagement I only had partial visibility
into. I verified each piece directly rather than assuming it was
correct, found and fixed two genuine gaps in what existed, and built
the pieces that were still missing. What follows distinguishes "found
already correct," "found and fixed," and "built this session."

---

## 1. OPENING SLIDE ARTWORK

Found already correct. The supplied corrected artwork (logo removed
from the golf ball, bottom-right branding intact) was already saved as
public/images/event-highlights-opening.jpg and already wired into the
opening slide with event name/dates dynamically overlaid -- confirmed
by comparing the project's own file against your freshly uploaded
reference image, not assumed correct from the filename alone. No
event-specific text is baked into the image. No change was needed
here.

## 2. GROUP PHOTO

Found half-built, fixed the missing half. Migration 087 (a single
nullable trips.group_photo_moment_id FK -- a well-reasoned choice over
a boolean-on-moments, since a trip has at most one Group Photo) and
the PATCH /api/trips/[tripId]/group-photo route (organiser-only,
server-side revalidates the selection is a genuine photo Moment
belonging to this trip) both already existed and were correct. What
was missing, and is now built: eventMemoryData.ts never actually
fetched group_photo_moment_id, so the data never reached the deck
builder or the player -- this was the "dead code from the user's
perspective" risk you flagged, confirmed as real. Fixed: extended the
fetch, threaded the selection through all four deck-building call
sites in the gallery page, and built a picker modal (organiser-only,
shows every photo Moment as a thumbnail grid, tap to select/reselect,
a dedicated "Remove Group Photo" action) wired to the existing route.

## 3. VIDEO CAPTURE/UPLOAD

Found already substantially built. MomentCapture.tsx already had a
dedicated video capture stage, client-side duration reading via a
detached <video> element, and accepted MIME types matching migration
086's bucket configuration. The POST /api/trips/[tripId]/moments route
already validated video Moments server-side (never trusting a
client-reported duration), enforced a 15-second hard ceiling, and
persisted moment_type/duration_seconds correctly. Verified this
end-to-end by reading both files directly rather than assuming the
earlier summary was accurate. No changes were needed here.

A real, separate bug found and fixed while verifying this area: both
the gallery grid thumbnails and the detail lightbox rendered every
Memory through a plain <img> tag unconditionally -- which cannot
display a video file at all. This would have been invisible until a
real video Moment existed to expose it, since no video Moment had
reached this code path before. Fixed both to render a <video> element
when mediaType === 'video', with a duration badge on the grid
thumbnail.

## 4. BLOOPER SELECTION

Found half-built, fixed the missing half. Migration 086 already added
is_blooper; migration 088 (built before this session) already added
the exact CHECK constraint hardening you asked for --
is_blooper = false OR moment_type = 'video' -- with sound reasoning
for why a plain constraint suffices over a trigger. What was missing:
no API route and no UI existed to actually set it. Built this
session: PATCH /api/trips/[tripId]/memories/[momentId]/blooper
(organiser-only, scoped to both momentId and tripId, independently
re-validates the Moment is a video before allowing the toggle, with
the database constraint as the authoritative backstop regardless), and
an "Add to Bloopers" / "Blooper" toggle in the detail lightbox, shown
only for video Moments, never requiring the Moment to also be a
Favourite.

## 5. VIDEO-AWARE EXPORT

Built this session -- confirmed via the audit you specifically
requested that this genuinely needed work: exportManifest.ts had no
mediaType awareness at all before this patch. Changes:
- ExportMemory extended with mediaType/isBlooper.
- A text Moment (no underlying file -- image_path is database-level
  NULL for moment_type = 'text') is now excluded from every export
  scope entirely, rather than silently producing a broken entry.
- A video Moment is routed to its own VIDEOS subfolder (per round, or
  00 - EVENT/VIDEOS for event-level) -- never mixed into the
  photo-only GENERAL MOMENTS/SIDE GAMES folders, even when the clip
  carries real Side Game context.
- Its filename uses CLIP rather than GENERAL or a Side Game name, so
  the file type is legible without opening it.
- The real file extension is always preserved (.mp4/.webm/whichever
  the actual Storage object has) -- confirmed via a dedicated test,
  never defaulted to .jpg.
- A selected Blooper produces a genuine second ZIP entry under a new
  91 - BLOOPERS folder, with the identical deterministic filename --
  mirroring the existing Favourite Highlights duplication pattern
  exactly (a real duplicate, never a symlink). A Moment that is both
  Favourite and Blooper correctly produces three entries (primary +
  both copies), confirmed by a dedicated test.
- ExportResult gained blooperCount, returned alongside favouriteCount.
- The export route itself now passes mediaType/isBlooper through to
  the manifest builder.

Not done in this session, and worth naming: EVENT-SUMMARY.txt and
EVENT-MANIFEST.json were not updated to mention video/Blooper counts
explicitly -- the ZIP's actual folder structure is correct and tested,
but the summary text itself doesn't yet say "N video Moments" or
"N Bloopers" anywhere. A real, scoped gap, not a blocker to the
folder/file correctness itself.

## 6. SCHEMA HARDENING (is_blooper video-only)

Confirmed already correctly implemented in migration 088 (built before
this session) -- a plain CHECK constraint, reasoned as sufficient over
a trigger since both columns live on the same table, additive and
non-disruptive to every existing row. Nothing further was needed.

---

## FILES CHANGED THIS SESSION

- `src/lib/trips/eventMemoryData.ts` (fetch group_photo_moment_id; surface it on event)
- `src/app/(app)/trips/[tripId]/memories/page.tsx` (Group Photo picker UI + wiring; Blooper toggle UI + wiring; fixed the <img>-for-video rendering bug in both the grid and lightbox)
- `src/app/api/trips/[tripId]/memories/[momentId]/blooper/route.ts` (new)
- `src/lib/trips/exportManifest.ts` (video-aware folder/filename/duplication logic, described fully in item 5)
- `src/lib/trips/exportManifest.test.ts` (10 new tests)
- `src/app/api/trips/[tripId]/export/route.ts` (passes mediaType/isBlooper through)

## FILES CONFIRMED ALREADY CORRECT, NOT MODIFIED

- `supabase/migrations/087_trip_group_photo.sql`
- `supabase/migrations/088_moments_blooper_video_only.sql`
- `src/app/api/trips/[tripId]/group-photo/route.ts`
- `src/components/moments/MomentCapture.tsx` (video capture flow)
- `src/app/api/trips/[tripId]/moments/route.ts` (video persistence/validation)
- `src/components/memories/EventHighlightsPlayer.tsx` (opening artwork, already correctly wired)

## MIGRATION IMPLICATIONS

None added this session. Both relevant migrations (087, 088) already
existed and were verified correct, not newly introduced here.

## TESTS ADDED

10, in exportManifest.test.ts: text Moments excluded from every scope;
a video Moment's folder never collides with photo folders, even with
real Side Game context; event-level video routing; filename uses CLIP,
never a Side Game name; real extension preservation for both .mp4 and
.webm; a genuine Blooper duplicate under 91 - BLOOPERS with the
identical filename; no Bloopers entry for a non-selected video; a
video that is both Favourite and Blooper producing exactly three
correctly-labelled entries; Favourites-scope export correctly
including a Favourite video alongside Favourite photos.

Not added: anything exercising the actual UI flows (the Group Photo
picker, the Blooper toggle button, the fixed video rendering in the
grid/lightbox) -- these depend on a real browser and real Storage
data, matching every prior session's honest limitation for this part
of the feature.

## FULL TEST-SUITE RESULT

601/601 pass -- 291 pure-function scoring + 68 highlights + 8
analytics + 7 profile + 63 SQL-scanning migration tests + 164 trips.
Confirmed via a fresh, complete run this session.

## ANYTHING STILL REQUIRING LIVE/BROWSER VALIDATION

Everything about the actual end-to-end organiser/player experience --
nothing here has run against a real database, Storage bucket, or
browser:
1. The full loop your brief's own closing line named explicitly:
   organiser selects a Group Photo, a player uploads a real
   ~10-second video, the organiser marks it a Blooper, and both appear
   correctly in a real generated presentation.
2. The video/photo rendering fix in the gallery grid and lightbox, on
   a real device -- confirmed only by code inspection, never watched
   render.
3. A real ZIP export containing an actual video file, opened and
   played, to confirm the 91 - BLOOPERS folder and VIDEOS subfolders
   genuinely contain playable clips with correct extensions -- the
   folder/filename logic is tested in isolation, but never exercised
   against real Storage bytes.
4. Everything from the prior V1.4 session's own live-validation list
   (16:9 canvas, controls safe-area, Fullscreen/Wake Lock, video
   playback timing) remains equally unverified.
