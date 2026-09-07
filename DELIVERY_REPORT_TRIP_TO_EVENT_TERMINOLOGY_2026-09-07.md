# TRIP -> EVENT TERMINOLOGY MIGRATION
## Delivery Report

**Build/test caveat, unchanged from every prior round:** no network
access -- `npm run build` was not run, and there is no live database
connection to execute the one new migration. All 27 touched files
syntax-check with zero errors, verified fresh this session. Full test
suite: **411/411 pass** -- identical to the prior total, confirming
this copy/terminology pass changed no calculation anywhere.

**Database boundary held throughout, as instructed:** `trips`,
`trip_members`, `trip_groups`, `trip_id`, and every other internal
identifier are completely untouched. Every change in this package is
either a UI string literal or one narrow, additive database change
(described in full below) that was required by a *different* part of
this same brief, not a renaming of the technical model.

---

## HOMEPAGE

- Headline: "Run your golf trip like a pro" -> "Run your golf event
  like a pro." Subheading unchanged.
- "+ Create Trip" -> "+ Create Event."
- Practice Round upgraded from a small secondary text link to a proper
  second button, placed side by side with Create Event -- matching your
  exact "+ Create Event | Practice Round" example rather than reading
  as an afterthought beneath the primary CTA.
- Caught and fixed a real bug while making this change: my first edit
  left an orphaned fragment of the old Practice Round link block behind
  (mismatched JSX). Caught by re-viewing the file immediately after the
  edit rather than assuming it landed correctly, then corrected and
  re-verified with a fresh syntax check.

## JOIN FLOW

"Join a trip" heading, "Join Trip" button, "Joining trip...", "Sign In
& Join Trip," "Create Account & Join Trip," "Save and Join Trip,"
"Trip code:" label, "Could not join trip," "Network error while
joining trip," "Couldn't join trip" -- all changed to Event language,
across `JoinByCode.tsx`, `JoinForm.tsx`, `HandicapPrompt.tsx`,
`PendingJoinHandler.tsx`, and `JoinWelcomeInner.tsx`. Also fixed the
underlying API error text in `/api/join/route.ts` (four separate
messages) and `/api/scores/route.ts`'s "Not a trip member" -- these
are the actual strings a user sees when something goes wrong, not just
happy-path copy.

## CREATE EVENT FLOW -- EVENT TYPE

**Investigated first, as instructed.** An Event Type selector already
existed in the wizard (`EVENT_TYPE_OPTIONS` in `src/types/app.ts`),
just not matching your exact requested wording or full option set.

- Relabelled "Corporate Day" -> "Corporate Golf" and "Charity Day" ->
  "Charity/Fundraiser" -- **label only**, the underlying stored values
  (`corporate_day`, `charity_day`) are unchanged, so no existing trip's
  data needed to move.
- Added "Competition/Tournament" as a genuinely new option
  (`competition`), per your explicit list.
- Kept "Golf Society" and "Bucks Weekend" -- not in your list, but
  removing them would have meant either breaking existing trips already
  classified with those values or a data migration neither of us
  wanted for a copy change.

**Caught a real bug before it could ship:** adding a new option value
also had to pass the database's own `CHECK` constraint on
`trips.event_type` -- confirmed this codebase already has a dedicated
regression test for exactly this kind of drift (`eventTypeConstraint.test.ts`,
itself born from an earlier P0 where the two sides genuinely diverged
in production). Wrote migration `077_event_type_add_competition.sql`
specifically to keep that existing test passing, then ran it directly
to confirm -- not assumed correct.

Also updated the wizard's own copy: "Trip name" -> "Event name," "Trip
details" -> "Event details," "Create trip" -> "Create event," the
date-range warning text, and the `/trips/new` page's own header
("My Trips"/"Back to trip"/"Edit trip"/"Create a trip" -> the Event
equivalents). Fixed the underlying "Trip name is required" validation
message in the API route too, not just the label above the field.

## NAVIGATION / GENERAL

"My Trips" -> "My Events" everywhere found: bottom nav, every "Back to
My Trips" link, wizard back-buttons, the post-join welcome screen.
"+ New Trip" -> "+ New Event" in the top nav.

## TRIP INFORMATION / EVENT LOBBY

`TripInformationCard.tsx` had the most concentrated cluster of
untouched copy in the whole app -- eight separate strings ("Trip
information," "Edit Trip Information," "+ Add Trip Information," "View
Full Trip Information," the save/loading/placeholder text, and the
empty state), all fixed together. `PlayerHomeCard.tsx`'s "Trip
Information ->" teaser link fixed to match. One deliberate judgment
call, checked rather than assumed: that component's own code comment
documented an *earlier* explicit decision to keep "Trip Information"
as the label despite an internal restructure -- this brief supersedes
that decision directly, so it was changed now with the comment updated
to reflect why.

## CHAT

"Trip Message" (a message-type label) and "Trip Chat" (a section
heading) in `EventMessages.tsx` -> "Event Message"/"Event Chat,"
including the surrounding code comments, so a future reader doesn't
find "Trip Chat" in a comment sitting next to "Event Chat" in the
actual UI.

## EMPTY STATES

Per your explicit instruction to check these: "No active/completed/
archived trips" -> "...events," with matching body copy, plus "Couldn't
load trips" -> "Couldn't load events," all in `TripList.tsx` -- the
component that actually renders the My Events list and its empty
states.

## PROFILE

"Golf Trip Organiser" appeared in two places (`profile/page.tsx`,
`players/[profileId]/page.tsx`). **Checked the underlying logic before
changing it, per your own "don't blindly replace" instruction** -- it's
computed from "organiser of *any* event, anywhere," with zero check on
event type, so labelling it "Golf Trip" specifically was already
inaccurate, not just off-terminology. Changed to "Event Organiser" in
both places. Also fixed a full paragraph of handicap-help copy in
`ProfileForm.tsx` ("Trip handicaps," "future trips," "current trips,"
"trip-specific handicap... go to the trip") -- four separate
occurrences in one paragraph, all updated together for consistency.

## ONBOARDING

Checked both the onboarding intent form and its Profile-page
counterpart directly -- neither contains the word "trip" at all
already (the organiser-type options there were already correctly
specific: "Golf Trips," "Social Golf," etc., which is exactly the
"don't blindly replace a specifically-classified type" case your brief
itself calls out as fine to leave alone). No change needed.

---

## FILES CHANGED

**Application (27 files):** `DashboardHero.tsx`, `JoinByCode.tsx`,
`JoinForm.tsx`, `HandicapPrompt.tsx`, `AppNav.tsx`,
`JoinWelcomeInner.tsx`, `TripDetailClient.tsx`,
`players/[profileId]/page.tsx`, `trips/[tripId]/page.tsx`,
`TripOverviewTab.tsx`, `trips/new/page.tsx`, `profile/page.tsx`,
`types/app.ts`, `StepDetails.tsx`, `StepRounds.tsx`, `StepReview.tsx`,
`TripList.tsx`, `EventMessages.tsx`, `rounds/[roundId]/page.tsx`,
`PlayerHomeCard.tsx`, `TripInformationCard.tsx`, `ProfileForm.tsx`,
`api/scores/route.ts`, `api/join/route.ts`, `api/trips/route.ts`,
`PendingJoinHandler.tsx`, `TripPlayersTab.tsx`.

**Migration (1 new):**
`supabase/migrations/077_event_type_add_competition.sql`.

## MIGRATION REQUIRED

`077_event_type_add_competition.sql` -- widens
`trips.event_type`'s `CHECK` constraint to also permit `'competition'`.
Purely additive; every existing value remains valid. Comes after
everything already pending (070 through 076).

## TESTS

No new tests were needed beyond the existing
`eventTypeConstraint.test.ts`, which already exists specifically to
catch frontend/database drift on this exact field, and was re-run
directly to confirm the new option is genuinely in sync on both sides
-- not just visually consistent.

## FULL TEST RESULT

**411/411 pass** -- 274 pure-function scoring + 61 highlights + 8
analytics + 7 profile + 7 SQL-scanning migration tests + 54 trips
(including the event-type constraint check). Confirmed via a fresh,
complete run this session.

## WHAT THIS PASS DID NOT TOUCH, ON PURPOSE

Golf-specific instances of "trip" that refer to an actually-classified
Golf Trip event (e.g. anywhere the app already reads and displays a
specific trip's own `event_type` back to the user) were left alone --
only the *generic* umbrella-product language was changed, per your own
explicit "don't blindly replace" instruction.

## REAL-DEVICE ACCEPTANCE STILL REQUIRED

Nothing here has run on a device.

1. Confirm the migration applies cleanly, then confirm "Competition/
   Tournament" is genuinely selectable and savable in the Create Event
   wizard.
2. Walk the full homepage -> Create Event -> Join Event -> My Events
   flow on a real screen, checking specifically for any remaining
   "Trip" text this sweep might have missed -- this was a broad manual
   audit across dozens of files, not an exhaustive automated
   verification, and the honest limitation of that approach is it can
   miss an instance.
3. Confirm an existing Golf Trip event still displays and behaves
   exactly as before -- the regression check for the one part of this
   migration that genuinely touches shared code (`EVENT_TYPE_OPTIONS`,
   the wizard, the join flow).
