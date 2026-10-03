# EVENT MEMORIES V1.4 -- PRESENTATION EXPERIENCE + BLOOPERS + FINAL POLISH
## Delivery Report

Build/test caveat, unchanged from every prior round: no network
access, no live database/Storage connection, no way to npm install.
Full test suite: 591/591 pass -- 291 pure-function scoring + 68
highlights + 8 analytics + 7 profile + 63 SQL-scanning migration tests
+ 154 trips.

This is a large brief (24 sections). What follows is an honest account
of what was built and verified, and what remains genuinely
unimplemented -- not a claim that every section was completed.

---

## 1. EXISTING ARCHITECTURE FOUND

Confirmed V1.3's deck/player/export architecture (slideshowDeck.ts,
eventMemoryData.ts, EventHighlightsPlayer.tsx) was intact and working
-- extended it in place rather than rewriting, per the brief's own
explicit instruction. Audited the Moments/Storage architecture
specifically for video (item 2).

## 2. WHETHER VIDEO REQUIRED A MIGRATION, AND WHY

Yes, genuinely, confirmed by reading the actual schema rather than
assuming. moments.moment_type is CHECK-constrained to
('photo', 'text') only (migration 030) -- a video row would be
rejected outright. The same migration's "well-formed row" constraint
also requires a third branch for video. Separately, the
event-moments Storage bucket (migration 028) is configured with
allowed_mime_types = ['image/jpeg','image/png','image/webp'] and an
8MB file_size_limit -- no video MIME type is permitted, and 8MB is
very likely too small for a ~10 second clip at any watchable quality.
Migration 086 extends both: adds 'video' to the type constraint plus
a required duration_seconds column (needed for V1.4's own "account
for video duration before advancing" playback requirement) and an
is_blooper boolean (mirroring is_event_favourite's own established
pattern, per the brief's "do not over-engineer a single selection
category" precedent from V1.1); widens the existing bucket's MIME
types and raises its size limit to 50MB. The existing bucket's
access-control policies (trip-member read, own-folder upload, owner
delete) apply identically to a video object at the same path
convention -- no new bucket, no new policies needed.

## 3. EXACT FILES CHANGED

- `supabase/migrations/086_moments_video_support.sql` (new)
- `src/lib/highlights/makersBreakers.ts` ("win by 0" fix)
- `src/lib/highlights/makersBreakers.test.ts` (4 new tests)
- `src/lib/trips/eventMemoryData.ts` (mediaType/durationSeconds/isBlooper surfaced per Memory)
- `src/lib/trips/slideshowDeck.ts` (groupPhoto, bloopersDivider, blooper slide kinds and build logic; photo-only filtering fix)
- `src/lib/trips/slideshowDeck.test.ts` (11 new tests)
- `src/components/memories/EventHighlightsPlayer.tsx` (16:9 canvas, controls safe-area, new slide renderers, video playback, redesigned Champion/Leaderboard/Side-Game-winner-fallback)

## 4. EXACT MIGRATIONS ADDED

One: 086_moments_video_support.sql, described fully in item 2.

## 5. NEW SLIDE/DECK SEQUENCE

Opening -> [Group Photo, if explicitly selected] -> [Event Memories
divider + event-level photos, if any] -> for each round with content:
round divider -> that round's photos -> official Side Game winner
card(s) -> published Makers & Breakers (only if published highlights
exist for that round) -> [Event Champion + paginated Final
Leaderboard, only if the event is completed] -> [Bloopers divider +
selected video clips, only if at least one exists] -> Closing. Every
divider/chapter only appears when it has real content -- confirmed
directly by tests, not just by design intent.

## 6. HOW GROUP-PHOTO SELECTION WORKS

buildSlideshowDeck/rebuildDeckFromOrder both take an optional
groupPhotoMomentId parameter. If supplied and it matches a real,
genuine photo-type Memory in this event's own data, a groupPhoto
slide is inserted immediately after the opening slide. An id that
doesn't match anything, or that points at a video/text Moment, is
silently omitted -- never fabricated or substituted. Not built this
session: the actual UI for the organiser to make this selection.
The deck builder is ready for it; nothing in the gallery page
currently lets an organiser choose a group photo, so this parameter is
never actually populated yet in the shipped product. Named as a real
gap, not glossed over.

## 7. HOW BLOOPERS SELECTION WORKS

Bloopers are derived directly from data.memories, filtered to
mediaType === 'video' && isBlooper === true, independent of which
slideshow source (favourites/all/selected) is chosen or of Favourite
status -- confirmed by a dedicated test. A photo or text Moment
flagged isBlooper (which the database schema permits, by design --
enforcing "only video" is an application-layer decision, not a
database constraint) is still excluded here. Not built this
session: the UI for an organiser to flag a video Moment as a Blooper
-- same honest gap as item 6. The migration's is_blooper column and
the deck builder's filtering logic are both ready; there is no
toggle anywhere in the product yet that sets it.

## 8. HOW VIDEO IS REPRESENTED IN MOMENTS/STORAGE/EXPORT

Moments/Storage: covered in item 2 -- a video Moment is a moments
row with moment_type = 'video', image_path pointing at the video
object (reusing the same column as photos, not a parallel
video_path), and a required duration_seconds. Export: NOT yet
updated. The brief's own item 18 explicitly requires auditing how
video affects the ZIP before calling this complete -- that audit was
not performed this session. exportManifest.ts/eventSummaryText.ts
currently have no awareness of mediaType at all; a video Moment
flowing through the existing export path today would very likely be
treated as an ordinary photo-shaped entry (copied by its image_path
with a photo-style filename), which is almost certainly wrong for a
video file and needs its own deliberate design (a different filename
convention at minimum, likely a dedicated folder) before being called
correct. Flagged explicitly as unverified and unimplemented, not
assumed to work.

## 9. PERFORMANCE STRATEGY

Images: unchanged from V1.3 -- current/next/previous only. Video: only
the current slide's <video> element ever has a real src attached;
adjacent Blooper slides render no video element at all until they
become current, so opening the presentation never triggers any video
download, and only one clip is ever "live" in the DOM at a time --
directly satisfying "do not preload every video in an event." Mobile
bandwidth implications were reasoned about (small number of short
clips per event, not hundreds) but not measured against a real
network.

## 10. ANALYTICS

Not implemented, and the audit itself was not performed this
session, exactly as it was left in V1.3 -- a carried-forward gap, not
a new one, named honestly rather than attempted without the
groundwork the brief itself asked for first.

## 11. TESTS ADDED

15 total. 4 in makersBreakers.test.ts for the "win by 0" fix: a
genuine positive margin, a two-way tie, a three-way tie, and the
no-runner-up fallback -- all confirming the fix's exact wording and
that "win by 0"/"won by 0" can never appear. 11 in
slideshowDeck.test.ts: group photo selection present/absent/
non-matching/video-rejected, text and video Moments never leaking into
the regular photo sequence, Bloopers only including explicitly
selected video Memories (a flagged photo or text Moment still
excluded), the Bloopers divider only appearing with real content,
Bloopers positioned correctly between Leaderboard and Closing,
Bloopers being independent of slideshow source/Favourite status, and
deterministic chronological ordering with the same tie-break rule as
photos.

Not added, and why: anything about the player's own visual rendering
(the 16:9 canvas math, the controls safe-area actually preventing
overlap on a real screen, video playback timing against a real clip,
Fullscreen/Wake Lock behaviour) depends entirely on a real browser --
none of it can be meaningfully exercised in this sandbox's Node test
runner, matching the same honest limitation named in every prior
Event Memories session for this component.

## 12. FULL TEST-SUITE RESULT

591/591 pass -- 291 pure-function scoring + 68 highlights + 8
analytics + 7 profile + 63 SQL-scanning migration tests + 154 trips.
Confirmed via a fresh, complete run this session.

## 13. ANYTHING STILL REQUIRING LIVE VALIDATION

Everything about the player's actual runtime/visual behaviour --
nothing here has run in a real browser. Specifically, per the brief's
own checklist: the 16:9 canvas on a real TV/desktop and on a portrait
Android controller; the controls safe-area genuinely never overlapping
a Makers & Breakers card on a real device (the fix is structural --
content never lays out under the reserved strip -- but this was never
watched happen on a screen); the improved no-photo Side Game winner
card and the elevated Champion slide's actual visual impact; the
redesigned Leaderboard's legibility on a TV at a real viewing
distance; and -- most importantly, since nothing about video was
actually exercised -- video playback with real audio, autoplay
behaviour across different mobile browsers, and Previous/Next during
an actively playing clip.

## 14. ANYTHING DELIBERATELY NOT IMPLEMENTED

Named directly, not left implicit:
- The literal supplied opening artwork. No image-generation or
  asset-hosting capability was available in this environment to
  produce or serve the actual reference image (golf ball on tee,
  sunrise fairway, logo removed as instructed). The opening slide's
  new "movie-opening" treatment uses a gradient approximation of the
  same premium aesthetic direction with the existing design tokens --
  this is explicitly a placeholder for the real artwork, not a
  finished substitute, and should be revisited once the actual asset
  can be added as a static file.
- Video upload/recording UI and Chat integration (brief section
  12's second half) -- only the schema/storage foundation was built;
  there is no way for a player to actually record/upload a 10-second
  clip anywhere in the product yet.
- Group photo and Bloopers selection UI -- the deck builder
  supports both; no organiser-facing control exists to make either
  selection.
- Export/ZIP video handling -- explicitly flagged in item 8 as
  unaudited and almost certainly incorrect if a video Moment reached
  the export path today.
- Analytics -- carried forward from V1.3, audit not performed.

Everything above is infrastructure-ready (schema, deck logic, player
rendering) but not product-complete -- an organiser cannot yet
actually produce a Bloopers chapter or select a group photo through
the app, even though the presentation would render correctly if that
data existed.
