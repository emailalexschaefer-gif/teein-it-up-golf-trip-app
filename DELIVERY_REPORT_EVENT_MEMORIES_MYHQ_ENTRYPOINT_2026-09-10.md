# EVENT MEMORIES V1 -- MY HQ ENTRY POINT FOLLOW-UP
## Delivery Report

**Confirmed: the gap was real.** TournamentControl.tsx (My HQ) had
no reference to Event Memories anywhere -- checked directly rather than
assumed present. The gallery existed only at its own URL, exactly the
"organiser can only reach it by knowing the address" problem flagged.

**Fixed.** Full test suite: **485/485 pass**, unchanged from the prior
delivery -- this addition introduces no new calculation logic, only a
UI card and a lightweight read route, so no new pure-function tests
were needed.

---

## WHAT WAS ADDED

**GET /api/trips/[tripId]/memories/count** (new) -- a deliberately
narrow route returning { photoCount, roundsWithMemories }. Built
separately from the existing memory-manifest route rather than having
the card reuse it: the manifest batch-generates a signed URL for every
Memory (needed for the gallery grid), which would be wasteful Storage
traffic for a card that only ever displays a number. This route
selects id, round_id only -- no image_path, no Storage call at all.

**One number, not two** -- the original spec's mockup text ("84
photos • 37 Moments") implies two different figures, but the V1 audit
already confirmed moments is the sole canonical record: one row is
one photo is one Moment, with no schema concept of multiple photos per
Moment. Showing a second, different-sounding count here would be
fabricated, not read from real data, so the card shows a single,
accurate photo count.

**EventMemoriesCard.tsx** (new) -- a simple, always-visible
navigation card, not a CollapsibleSection with expandable content
(there's nothing to expand; the gallery lives at its own route). Shows
"📸 Event Memories," the photo count (or "No photos yet"), and "View
all →," linking to /trips/[tripId]/memories.

**Wired into TournamentControl.tsx**, placed immediately after "The
Story" -- the last existing section -- rather than inserted among the
Live Event control sections above it (Event Health, Side Games, Score
Management). This was a deliberate placement choice, not an
afterthought: it means the card never competes for attention with
round-control actions during an active round, directly satisfying
"without disturbing Live Event controls."

**Scope check:** per the original spec's own "V1 primary management
belongs to the organiser" -- this card was added only to
TournamentControl.tsx (My HQ), not to the player-facing
MyRoundClient.tsx. Players already see their own Moments through
existing My Golf surfaces, unchanged.

## FILES CHANGED

- `src/app/api/trips/[tripId]/memories/count/route.ts` (new)
- `src/components/scoring/EventMemoriesCard.tsx` (new)
- `src/components/scoring/TournamentControl.tsx` (one import, one component placed after the existing "The Story" section -- no existing section reordered or modified)

## MIGRATIONS

None required for this follow-up.

## TESTS

No new tests added. This addition is a lightweight read (a SELECT
with no joins, no calculation) plus a display component -- there is no
new logic here that a pure-function or contract test would
meaningfully cover beyond what a real render/click already proves.

## FULL TEST-SUITE RESULT

**485/485 pass** -- 291 pure-function scoring + 64 highlights + 8
analytics + 7 profile + 52 SQL-scanning migration tests + 63 trips.
Identical to the prior delivery's total, confirming this addition
introduced no regression and needed no new calculation coverage.

## STILL REQUIRING LIVE DEVICE VALIDATION

Everything in the original V1 report, plus specifically: confirm the
card actually renders in My HQ on a real device, that the photo count
matches the gallery's own count, that tapping "View all" navigates
correctly, and that the card's presence doesn't visually crowd a Live
Event's existing control sections on a phone screen -- this was
reasoned about during placement but not seen rendered.
