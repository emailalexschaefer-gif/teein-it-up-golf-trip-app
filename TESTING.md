# Teein' It Up — Sprint 3 Testing Guide

## Build status
- TypeScript: ✅ zero errors
- Build: ✅ passes

## Sprint 3 Stabilisation fixes (this build)
- **Dashboard crash fixed**: `useMyTrips` no longer selects `expected_players` /
  `players_per_group` from trips. These columns don't exist until migration 015
  is applied. Dashboard now loads correctly with or without the migration.
- **Trip detail fallback expanded**: the missing-column fallback now also triggers
  on `playing_handicap` and `handicap_status`, not just `group_id` / `expected_players`.
- **Generate route made resilient**: the group auto-generate endpoint falls back
  gracefully if Sprint 3 columns are missing from the trips table.

---

## Step 1 — Environment variables

Add this to your Vercel project settings (or `.env.local` for local testing):

```
ENABLE_TEST_ACCOUNT_RESET=true
```

This enables the "Developer Testing" reset button on the My Profile page
for the test account only. Set it to `false` or remove it to hide the button.

---

## Step 2 — Apply migrations

Run **one file only**: `supabase/migrations/015_sprint3_definitive.sql`

This supersedes all previous Sprint 3 migrations (009 through 014).
It is fully idempotent — safe to run even if earlier migrations were applied.

**How to run:**
1. Supabase Dashboard → SQL Editor → New query
2. Paste the entire contents of `015_sprint3_definitive.sql`
3. Click Run
4. Confirm success (no red errors)

**Verify:**
```sql
SELECT
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='public'
   AND table_name='trips'
   AND column_name IN ('expected_players','players_per_group','organiser_is_playing')
  ) AS trips_cols,              -- expected: 3
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='public'
   AND table_name='profiles'
   AND column_name IN ('handicap','handicap_status')
  ) AS profiles_cols,           -- expected: 2
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='public'
   AND table_name='trip_members'
   AND column_name IN ('group_id','playing_handicap')
  ) AS tm_cols,                 -- expected: 2
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'
   AND table_name='trip_groups'
  ) AS trip_groups_table,       -- expected: 1
  (SELECT COUNT(*) FROM pg_policies WHERE schemaname='public'
   AND tablename='trip_groups'
  ) AS trip_groups_policies;    -- expected: 2
```

All five must match. If any return 0, check the SQL Editor output for the error.

---

## Step 3 — Deploy the build

Push to your repository and deploy via Vercel. Confirm the deployment
succeeds before testing.

---

## Step 4 — Reset the test account

Test accounts:
- `teeinitupapp@gmail.com` — Alex (primary)
- `teeinitupdaztest@gmail.com` — Darren (secondary)

### Option A — Reset via the app (preferred)

Once `ENABLE_TEST_ACCOUNT_RESET=true` is set and deployed:

1. Sign in as `teeinitupapp@gmail.com`
2. Go to My Profile
3. Scroll to "Developer Testing" section
4. Click "Delete & Reset Test Account"
5. Type `RESET` in the confirmation field
6. Click "Delete Account"
7. The app signs out and redirects to the signup page
8. You can now create the account again from scratch

### Option B — Manual SQL reset (preserve Auth user)

Use when you want to keep the auth user but reset the profile state:

```sql
DELETE FROM public.trip_members
  WHERE profile_id = (
    SELECT id FROM public.profiles WHERE email = 'teeinitupapp@gmail.com'
  );

UPDATE public.profiles
  SET handicap = NULL, handicap_status = 'pending'
  WHERE email = 'teeinitupapp@gmail.com';

-- Verify
SELECT full_name, handicap, handicap_status,
  (SELECT COUNT(*) FROM public.trip_members tm
   JOIN public.profiles p2 ON p2.id = tm.profile_id
   WHERE p2.email = 'teeinitupapp@gmail.com') AS memberships
FROM public.profiles
WHERE email = 'teeinitupapp@gmail.com';
-- Expected: handicap=NULL, handicap_status='pending', memberships=0
```

### Option C — Full manual delete (Supabase dashboard)

Use when testing the complete first-time signup flow including email confirmation:

1. Supabase → Authentication → Users → find `teeinitupapp@gmail.com` → Delete
2. Run cleanup SQL:
```sql
DELETE FROM public.profiles WHERE email = 'teeinitupapp@gmail.com';
```

---

## Step 5 — End-to-end test sequence

Work through these in order. Do not proceed if a step fails.

### 1. Create account
- Open `/login?mode=signup`
- Enter: full name, `teeinitupapp@gmail.com`, password, confirm password, handicap (e.g. 15.4)
- Submit
- **Expected:** redirect to dashboard (email confirmation off) OR "Check your email" (email confirmation on)

**Verify:**
```sql
SELECT id, full_name, handicap, handicap_status
FROM public.profiles WHERE email = 'teeinitupapp@gmail.com';
-- Expected: full_name set, handicap=15.4, handicap_status='provided'
```

### 2. Login and dashboard
- Confirm dashboard loads with "My Trips" heading
- Confirm "Join a Trip" card appears at the top (above trip list)

### 3. Join via trip code
- Enter a valid invite code in the "Join a Trip" card
- **Expected:** redirected to the trip page

**Verify:**
```sql
SELECT tm.role, tm.playing_handicap, t.name
FROM public.trip_members tm
JOIN public.trips t ON t.id = tm.trip_id
JOIN public.profiles p ON p.id = tm.profile_id
WHERE p.email = 'teeinitupapp@gmail.com';
-- Expected: row with role='player'
```

### 4. Join via magic link
- Open an invite link while logged out
- **Expected:** prompted to sign in, then joined the trip

### 5. Handicap prompt (if handicap_status = 'pending')
- If the account has no handicap on file, joining a trip should show the handicap prompt
- Enter handicap or select "No official handicap"
- **Expected:** profile updated, then joined

### 6. Organiser appears in trip
- Open a trip where this account is the organiser
- Go to Players tab
- **Expected:** organiser appears in Organiser section

### 7. Trip-specific handicap editing
- In Players tab, click "Edit HCP" beside a player
- Enter a new value and save, then reload
- **Expected:** new value persists; profile handicap unchanged

### 8. Developer Testing reset (Option A flow)
- Go to My Profile
- Confirm "Developer Testing" section is visible
- Complete the reset flow (type RESET, delete)
- **Expected:** signed out, redirected to signup, same email can be reused

### 9. Security check
- Sign in as a different account
- **Expected:** "Developer Testing" section does NOT appear
- Attempt to POST `/api/dev/reset-test-account` directly
- **Expected:** 403 Forbidden

---

## Known limitations

- **Email confirmation**: Supabase's built-in email provider allows ~2
  confirmation emails per hour project-wide. If emails don't arrive,
  configure custom SMTP (Supabase → Settings → Auth → SMTP) or temporarily
  disable email confirmation for testing.

- **handicap_status column**: Requires migration 015. The app falls back
  gracefully if the column is missing, but the prompt logic won't work
  correctly until the migration is applied.

- **Groups tab**: Requires `trip_groups` table and `trip_members.group_id` —
  both added by migration 015.

- **Organiser-as-player**: Only shows in Players/Groups when
  `trips.organiser_is_playing = true`. This is set during trip creation
  ("Will you also be playing?"). Existing trips default to false.

---

## Files changed in this build

- `src/app/api/dev/reset-test-account/route.ts` — new secure server-side deletion API
- `src/components/profile/DevResetSection.tsx` — new client component (test email only)
- `src/app/(app)/profile/page.tsx` — conditionally renders DevResetSection
- `supabase/migrations/015_sprint3_definitive.sql` — one definitive migration

## Environment variable required

```
ENABLE_TEST_ACCOUNT_RESET=true
```

Add to Vercel → Project Settings → Environment Variables.
Remove or set to `false` when not needed.


---

## Sprint 3 Journey Audit (15 Jul 2026)

Full code trace of both journeys. No logic gaps found in the code.
The journeys are blocked only by migration 015 not yet being applied.

### Organiser Journey — code status

| Step | Status | Notes |
|---|---|---|
| Login | ✅ | Password and magic link both work |
| Create Trip | ✅ | Wizard → POST /api/trips → redirect to /trips/[id] |
| Edit Trip | ✅ | PATCH /api/trips/[tripId], prefill via ?editTripId= |
| Invite Players | ✅ | Code + full URL both shown with copy buttons |
| View Players | ✅ | Players tab, organiser-as-player handled |
| Create Groups | ✅ | POST /api/trips/[tripId]/groups (requires migration 015) |
| Assign Players | ✅ | PATCH /api/trips/[tripId]/members/[memberId] with group_id |
| Set Tee Times | ✅ | PATCH /api/trips/[tripId]/groups/[groupId] with tee_time |
| Ready to Start | ✅ | Status transition via Overview tab |

### Player Journey — code status

| Step | Status | Notes |
|---|---|---|
| Create Account | ✅ | /login?mode=signup, handicap captured |
| Save Handicap | ✅ | Saved to profiles on immediate session; trigger saves on email confirm |
| Confirm Email | ✅ | do-join fires after confirmation via emailRedirectTo |
| Login | ✅ | Password and magic link |
| Join via Magic Link | ✅ | /api/auth/callback → do-join → trip page |
| Join via Trip Code | ✅ | JoinByCode → POST /api/join → trip page |
| Trip appears in My Trips | ✅ | useMyTrips reads trip_members for the user |
| Update Profile | ✅ | /profile → ProfileForm |
| Developer Reset | ✅ | /profile → DevResetSection (requires ENABLE_TEST_ACCOUNT_RESET=true) |

### Fixes applied in this audit

- `useMyTrips` SELECT now includes `expected_players` and `players_per_group`
  so dashboard cards show real capacity (was always showing 0/?)
- `playerCount` in TripDetailClient now includes organiser when
  `organiser_is_playing = true`

### Remaining dependency

Both journeys require **migration 015** to be applied.
Without it: groups tab fails, organiser_is_playing is ignored, handicap_status is missing.


---

## Trip Lifecycle (Archive vs Delete)

### Features added

**Dashboard — filter tabs:**
- Active (live + upcoming + drafts) — default view
- Completed — finished trips
- Archived — hidden from default, preserved in full

**Archive Trip:**
- Available from Overview tab for all non-archived trips
- Confirmation sheet: "Archive Trip?" with Archive / Cancel buttons
- Marks trip as `archived`, removes from Active, preserves all data
- Redirect to dashboard after archiving

**Restore Trip (from archived):**
- Visible on Overview tab when trip status is `archived`
- One-click restore, no confirmation required
- Returns trip to `completed` status

**Delete Trip Permanently:**
- Available from Overview tab for `completed` and `draft` trips
- Also available from archived trip view
- Requires typing `DELETE` to enable the button
- Cascades via FK: removes trip_members, rounds, groups, scores, etc.
- Only the organiser can delete

### Acceptance test

1. Create a trip → Archive it → confirm it moves to Archived tab
2. Open archived trip → Restore → confirm it moves to Completed tab
3. Open completed trip → Delete → type DELETE → confirm it disappears entirely
4. Verify other users' trips are unaffected


---

## Sprint 5A — Begin Round & Scoring Foundation

### New files
- `src/lib/scoring/defaultHoles.ts` — default 18/9-hole template + `resolvePlayingHandicap()` + `getDefaultHoles()`
- `src/app/api/trips/[tripId]/rounds/[roundId]/start/route.ts` — POST start-round API
- `src/app/api/trips/[tripId]/rounds/[roundId]/scorecards/route.ts` — GET scorecards API
- `src/components/scoring/BeginRoundModal.tsx` — 3-stage pre-round confirmation modal
- `src/app/(app)/trips/[tripId]/rounds/[roundId]/page.tsx` — active round server page
- `src/app/(app)/trips/[tripId]/rounds/[roundId]/ScoreSessionShell.tsx` — active round shell UI

### Modified files
- `src/app/(app)/trips/[tripId]/tabs/TripRoundsTab.tsx` — Begin Round button, modal, status badges
- `src/app/(app)/trips/[tripId]/TripDetailClient.tsx` — passes `isOrganiser` to TripRoundsTab

### No database migrations required
Migration 004 (scoring tables) must be applied. No new tables needed for Sprint 5A.

### Handicap rounding rule
`resolvePlayingHandicap()` in `defaultHoles.ts` applies `Math.floor()` to any decimal handicap.
Example: 14.5 → 14. This is consistent with standard amateur golf practice (play off whole number, rounding down).
The resolved value is shown to the organiser in the confirmation modal before the round starts.

### Duplicate prevention
- Holes: `upsert` with `onConflict: 'round_id,hole_number'` — defined in migration 004 as `UNIQUE (round_id, hole_number)`
- Scorecards: `upsert` with `onConflict: 'round_id,player_id'` — defined in migration 004 as `UNIQUE (round_id, player_id)`

### Sprint 5A manual test checklist

**Begin Round flow (organiser)**
- [ ] Open a trip with `live` or `ready` status
- [ ] Go to the Rounds tab
- [ ] Confirm "Begin Round" button appears on an upcoming round
- [ ] Tap "Begin Round" — confirm modal opens
- [ ] Stage 1: Review shows all groups, players and handicaps
- [ ] Stage 1: Missing handicap shows ⚠ warning with player name
- [ ] Stage 2: Holes — default template loads with 18 holes
- [ ] Stage 2: Edit par/SI — changes save correctly
- [ ] Stage 2: "Review & Confirm" disabled if validation fails
- [ ] Stage 3: Summary shows all players with resolved handicaps
- [ ] Tap "Confirm & Begin Round"
- [ ] Verify `rounds.status = 'active'` in Supabase
- [ ] Verify 18 rows in `holes` for this round
- [ ] Verify one `scorecard` per assigned player
- [ ] Verify `playing_handicap` in scorecard matches `Math.floor()` of source
- [ ] Redirected to `/trips/[tripId]/rounds/[roundId]/score`
- [ ] Round shell shows: round name, date, tee time, all players with HCP
- [ ] "Enter Scores" button visible (Sprint 5B placeholder)

**Access control**
- [ ] Non-organiser does NOT see "Begin Round" button
- [ ] Non-organiser CAN see "Enter Scores" on an active round
- [ ] Calling POST /start as a non-organiser returns 403

**Validation**
- [ ] No groups → error message, Begin Round blocked
- [ ] Group with no players → error message
- [ ] Player missing handicap → error message with player name
- [ ] Begin Round a second time → 409 "already started"
- [ ] 9-hole round → SI validates 1–9, hole table shows 9 rows

**Regression (existing features)**
- [ ] Trip detail page loads correctly
- [ ] Overview tab status transitions unchanged
- [ ] Players tab unchanged
- [ ] Groups tab unchanged
- [ ] Dashboard trip counts unchanged
- [ ] Join by code unchanged
- [ ] Create Trip wizard unchanged

---

## Sprint 5B — Live Scoring Engine (Core)

### Migration

Run `supabase/migrations/017_sprint5b_group_scoring.sql` after 016. It is additive
and idempotent (uses `DROP POLICY IF EXISTS` before recreating). It does **not**
touch table structure — only the `score_entries` RLS policies and adds one
helper function, `same_playing_group(scorecard_id)`.

```sql
-- Verify the policies after running the migration:
select polname, polcmd from pg_policies where tablename = 'score_entries';
-- Expect: "Members: view scores" (r), "Group: insert scores" (a/INSERT),
--         "Players: update group scores" (w/UPDATE), "Organisers: update scores" (w/UPDATE)
```

### What changed vs. Sprint 5A

- `POST /api/scores` now allows any member of the **same playing group**
  (`trip_groups` via `trip_members.group_id`) to score for another member of
  that group, not just their own card. Organisers can score anyone.
- Fixed a real bug: re-confirming an already-scored hole used to hit the
  `UNIQUE(scorecard_id, hole_id)` constraint and silently fail as a false
  "already recorded" 409 instead of updating the score. It now updates.
- `GET /api/trips/[tripId]/rounds/[roundId]/scorecards` now also returns each
  scorecard's `score_entries`, so a reload mid-round rehydrates already-saved
  scores instead of showing every hole as blank.
- The scoring screen now writes through the existing Dexie-backed offline
  queue (`src/lib/db/dexie.ts` + `sync.ts`) instead of calling `fetch()`
  directly. That queue already existed in Sprint 5A but was never wired into
  `ScoreSessionShell` — this was the "offline architecture" gap.
- Removed from the active scoring screen: live leaderboard, medal rankings,
  "N scoring now" / live-syncing chrome. Replaced with a neutral **Group
  Progress** panel (holes played + running total per player, no ranking).
  Live leaderboards return in Sprint 5C.

### End-to-end test sequence

**Setup**
- [ ] Use `teeinitupapp@gmail.com` (organiser) and `teeinitupdaztest@gmail.com`
      (player), plus 2+ seeded test profiles in the same playing group
- [ ] Begin a round per the Sprint 5A flow above so `rounds.status = 'active'`

**Solo scoring**
- [ ] Open the round as a player with no groupmates online — only your own
      card appears, no group switcher shown
- [ ] Tap `+`/`−`, confirm gross updates and Stableford points recalculate
      instantly with no page refresh
- [ ] Tap PAR shortcut — sets gross to par, points recalc
- [ ] Confirm Score — flash animation shows, hole auto-advances after ~600ms
- [ ] Reload the page mid-round — previously confirmed holes still show
      their scores and point values (hydration check)

**Group scoring (the critical path)**
- [ ] As Player A, open the round; confirm the "Playing Group" switcher shows
      all group members
- [ ] Score Player A's hole → Confirm → UI auto-selects Player B
- [ ] Score Player B → Confirm → auto-selects Player C, and so on
- [ ] After the last group member is confirmed for the hole, the whole group
      auto-advances to the next hole, back to Player A
- [ ] Verify in Supabase that each `score_entries.entered_by` is the scorer's
      user id, while `scorecard_id` correctly points to each different player
- [ ] As Player B, attempt to `POST /api/scores` for a player in a
      **different** playing group — expect 403 "You can only score for your
      own playing group"

**Editing**
- [ ] Tap back to a previous hole tile, change Player A's score, Confirm
- [ ] Verify the `score_entries` row was updated (same id), not duplicated
- [ ] Running total and hole-strip tile reflect the new value immediately

**Offline**
- [ ] Turn off network (devtools offline mode), confirm several scores —
      sync status shows pending count, scores appear queued
- [ ] Turn network back on — queue flushes automatically, sync status clears
- [ ] Confirm no duplicate `score_entries` rows after reconnect (client_id
      idempotency)

**Exclusions (should NOT appear anywhere in this screen)**
- [ ] No live leaderboard / rankings / medals
- [ ] No Powerplay banner or toggle
- [ ] No side-competition prompts (Longest Drive, Nearest Pin, Pro's Approach)
- [ ] No toasts other than the offline-save notice
- [ ] No round-complete / celebration / trophy screen after hole 18

**Regression**
- [ ] Sprint 5A "Begin Round" flow unchanged
- [ ] Non-group-member trip members still cannot score for others
- [ ] Build passes with zero TypeScript/ESLint errors (`npm run build`)

---

## Sprint 5B Verification Report

This section answers the verification request point by point.

### 1. Organiser Group Scoring

Implemented server-side, not just in the UI:

- `page.tsx` now branches on `trip_members.role`. Non-organisers only ever
  receive their own group's scorecards from the server — there's no client
  code path that could show them another group even if the UI were edited.
- Organisers receive every group (`allGroups`), with a default group chosen
  as: their own group if `myGroupId` resolves (i.e. they're a playing
  organiser), otherwise the first group with players (non-playing organiser).
- The switcher in `ScoreSessionShell` only re-slices already-fetched data
  client-side — it grants no new access, because the organiser already had
  server-side permission to view/write every group's scores.
- The actual enforcement is in `/api/scores`: `isOrganiser` (from
  `trip_members.role`, checked server-side) bypasses the same-group
  requirement entirely. An ordinary player hitting the same endpoint for a
  scorecard outside their group gets a 403 regardless of what the UI shows
  them — verified by re-reading the route logic; **not yet tested against a
  live server**, that's on your checklist below.

### 2. Offline Queue & Conflict Handling

| Requirement | Status | How |
|---|---|---|
| Stable operation ID | ✅ | `queueScoreEntry` resolves one `clientId` per (scorecardId, holeId) and reuses it across edits/retries |
| Retries don't duplicate | ✅ | `/api/scores` short-circuits on `client_id` match before touching the DB |
| Editing an unsynced score replaces the queued version | ✅ (fixed) | `queueScoreEntry` now looks up any not-yet-synced entry for the same (scorecardId, holeId) and overwrites it in place, same `clientId`, instead of adding a second queued row |
| Newer local scores never overwritten by older server data | ✅ (fixed) | Hydration reads server data first, then overlays anything still in the queue on top; `markEntrySynced` takes a snapshot of the gross score at send time and refuses to mark an entry synced if it's since been edited again |
| Rapid Confirm taps can't duplicate | ✅ (added) | `confirmingRef` guards `confirmScore()` synchronously, in addition to the existing `disabled` button state |
| Queued scores survive refresh / app restart | ✅ | Inherent to Dexie/IndexedDB (Sprint 5A already had this); now additionally **surfaced in the UI** on load via the hydration merge, which Sprint 5A's shell never did |

**Exact conflict-resolution strategy, end to end:**
1. Confirm → `queueScoreEntry` writes/replaces one row in IndexedDB keyed by a stable `clientId` for that (scorecardId, holeId).
2. `syncScoreQueue` sends it to `/api/scores`, snapshotting the gross score first.
3. Server: if `client_id` already landed → 200 no-op (idempotent retry). Otherwise, if a row already exists for (scorecard_id, hole_id) → UPDATE it; else INSERT. This is the actual conflict-resolution key — not `client_id` — because `client_id` is per-submission while (scorecard_id, hole_id) is the real identity of "this player's score for this hole."
4. On success, the local queue entry is marked synced **only if** its gross score still matches what was sent — if the person edited it again mid-flight, it's left pending so the newer value goes out next pass.
5. On page load, server-confirmed scores hydrate first, then any still-queued (unsynced) local entries are overlaid on top, so local always wins over a potentially-stale server snapshot.

### 3. Database Security (RLS)

| Requirement | Enforced by |
|---|---|
| Authenticated user | Every check depends on `auth.uid()`; NULL for anonymous requests, so all `EXISTS` checks fail closed |
| Active trip membership | `trip_members` row existing *is* the membership record — this schema has no separate invited/pending state, so "member exists" = "active member" |
| Scorecard belongs to correct round | `scorecards.round_id` FK, joined in `same_playing_group()` |
| Round belongs to correct trip | `rounds.trip_id` FK, joined in `same_playing_group()` |
| Group belongs to correct trip | `trip_members.group_id` compared only within rows already scoped to the same `trip_id` |
| Scorer belongs to that playing group OR is organiser | `same_playing_group()` — organiser short-circuits true, otherwise compares the caller's and target's `group_id` within the trip |
| Hole belongs to the same round | `hole_matches_scorecard_round()` (new in migration 018) — this was missing before; the API checked it but the DB didn't |
| Non-members cannot read or update | `"Members: view scores"` SELECT policy requires `is_trip_member`; write policies all resolve to `same_playing_group()`, which returns false for non-members |

**Final policy summary on `score_entries`:**
- SELECT — any trip member of the round's trip
- INSERT — `entered_by = auth.uid()` AND same playing group AND hole belongs to that scorecard's round
- UPDATE (players) — same playing group AND hole belongs to that scorecard's round
- UPDATE (organisers) — trip organiser, hole belongs to that scorecard's round

### 4. Editing Existing Scores

Traced through the fixed `/api/scores` logic:
- First save: no existing (scorecard_id, hole_id) row → INSERT. `compute_stableford` trigger fires, correct points.
- Second save (edit): existing row found by (scorecard_id, hole_id) → UPDATE by its own `id`, not a fresh INSERT. Same trigger fires on `UPDATE OF gross_score`, recalculates points.
- No duplicate rows possible — `UNIQUE(scorecard_id, hole_id)` still exists and the code path no longer collides with it.
- No 409s in the normal edit flow — 409-equivalent (200 no-op) only fires for an exact `client_id` replay, which is the offline-retry case, not a genuine edit.
- Running totals: computed client-side in `ScoreSessionShell` from the confirmed map, which is updated on every successful confirm, including edits.

### 5. Resume Scoring

- On load, holes and score_entries hydrate from the server, then unsynced queue entries overlay on top (see §2).
- `findResumePosition()` walks the group's holes in order and lands on the first hole where not everyone in the group has confirmed; within that hole, the active player defaults to the first group member not yet confirmed.
- This runs once per session (`resumedRef` guard) so it doesn't fight with the user's manual navigation after that; switching groups (organiser) recalculates the resume position fresh for the newly selected group.
- Unsynced local scores are part of what "confirmed" means for this calculation, so a half-scored, not-yet-synced hole correctly counts as done for resume purposes.

### 6. Production Build

**I could not run this.** No network access in this sandbox (`npm install`
returned a 403 from the registry). See `DEPLOYMENT_NOTES.md` for exactly
what I did instead (isolated type-check of the hardest logic, manual
cross-referencing of every changed signature, balance/syntax checks) and
what still needs to happen on your end before this is "done":

```bash
npm install && npm run build && npm run lint && npx tsc --noEmit
```

### 7. Manual Testing

**I could not run this either** — no live Supabase instance or browser
available here. Below is the exact sequence mapped to each item you asked
for; please run it (or have Daz run it) and report back:

1. **Player scores own group** — sign in as a non-organiser test account, confirm the group switcher does NOT appear (single group only), score a hole, confirm it saves and advances.
2. **Player cannot score another group** — with dev tools, call `POST /api/scores` with a `scorecard_id` belonging to a player outside your group → expect `403`.
3. **Playing organiser switches groups** — sign in as the organiser account (with `organiser_is_playing = true` and a scorecard), confirm it defaults to their own group, then use the "SWITCH PLAYING GROUP" row to move to another group and score a hole there.
4. **Organiser-only host can score every group** — set `organiser_is_playing = false` for the trip, confirm the organiser still sees all groups and defaults to the first one.
5. **Edit an existing hole** — score a hole, tap back to it, change the score, confirm — check Supabase directly that the row was updated (same `id`), not duplicated.
6. **Refresh and resume** — score a few holes for two different group members, refresh the browser, confirm scores/totals/hole position/active player are all exactly as left.
7. **Offline scoring** — devtools → offline, score 2–3 holes, confirm the sync indicator shows a pending count and the UI still shows the scores as entered.
8. **Reconnect and sync** — go back online, confirm the queue flushes and the pending count clears, then check Supabase for exactly one row per hole (no duplicates).
9. **Rapid double-tap on Confirm** — tap Confirm as fast as possible (or simulate a double `click` event) — check Supabase for exactly one `score_entries` row for that hole.
10. **Two groups scoring simultaneously** — two browsers/devices, two different groups, confirm holes in both at the same time — no cross-contamination, each group's data is independent.
11. **Invalid/non-member access** — sign in as a user with no `trip_members` row for this trip, hit the round URL directly → expect redirect to `/dashboard`.
12. **Invalid trip/round access** — hit the URL with a `roundId` that doesn't belong to the given `tripId` → expect redirect to `/trips/[tripId]`.

### 8. Scope check (unchanged from the original Sprint 5B delivery)

No live leaderboard, rankings, live tournament updates, side competitions,
Powerplay, notifications, toasts (other than the offline-save notice),
winner screens, confetti, trophy ceremony, or sharing were added. Nothing
from this verification pass touches Sprint 5C territory.

---

## Scoring Rules and Format Architecture

Full detail on what's live vs. prepared-for-later vs. Ryder-Cup-future is in
`SCORING_ARCHITECTURE.md`. This section covers the calculation rules
themselves and how to verify them.

### Stableford — nett-score rules

Calculated from the NETT score, never gross alone:

```
nettScore        = grossScore - handicapStrokesReceived
stablefordPoints = max(0, 2 + par - nettScore)
```

| Nett result | Points |
|---|---|
| Double bogey or worse | 0 |
| Bogey | 1 |
| Par | 2 |
| Birdie | 3 |
| Eagle | 4 |
| Albatross | 5 |
| Better than albatross | 6, 7, 8... (uncapped) |

Worked example: par 4, gross 5, 1 handicap stroke received → nett 4 (par) →
2 points. Without the stroke, the same gross score is a nett bogey → 1 point.

### Handicap-stroke allocation

```
fullStrokes = floor(playingHandicap / holesInRound)
remainder   = true-mod(playingHandicap, holesInRound)   — always ≥ 0
extraStroke = 1 if strokeIndex <= remainder, else 0
strokes     = fullStrokes + extraStroke
```

| Handicap | Result |
|---|---|
| 0 | No strokes anywhere |
| 8 | 1 stroke on SI 1–8 |
| 10 | 1 stroke on SI 1–10 |
| 18 | 1 stroke on every hole |
| 24 | 2 strokes on SI 1–6, 1 on SI 7–18 |
| 36 | 2 strokes on every hole |
| 40 | 3 strokes on SI 1–4, 2 on SI 5–18 |
| −2 (plus handicap) | 0 strokes on SI 1–16, −1 (gives a stroke back) on SI 17–18 |

### Daily handicap

```
Daily Handicap = GA Handicap × Slope Rating ÷ 113
```

Example: `8.8 × 138 ÷ 113 = 10.747` → rounds to **11**.

**Not currently wired into the live round-start flow** — see
`SCORING_ARCHITECTURE.md` for why (no `slope_rating` column exists yet).

### Rounding rule

Round-half-up to the nearest whole number, for every handicap value
anywhere in the app (`rounding.ts`'s `roundHandicap`, the single named
implementation — nothing else should call `Math.round()` on a handicap):

| Input | Result |
|---|---|
| 10.49 | 10 |
| 10.50 | 11 |
| 10.74 | 11 |
| −2.50 | −2 (same convention: rounds toward +Infinity) |
| −2.51 | −3 |

### Ambrose / alternate-shot team handicaps

| Format | Formula | Default allowance | Example |
|---|---|---|---|
| Two-player Ambrose | `(A + B) ÷ 4` | 25% | 10 + 18 = 28 → **7** |
| Four-player Ambrose | `(P1+P2+P3+P4) ÷ 8` | 12.5% | 8+12+16+20 = 56 → **7** |
| Alternate shot | `(A + B) ÷ 2` | 50% | 8 + 16 = 24 → **12** |

Allowances are centrally configurable (`DEFAULT_HANDICAP_ALLOWANCES` in
`teamHandicap.ts`) and can be overridden per call without touching the
formula. **Not wired into any round-creation or scoring screen yet** —
these are tested domain utilities, not a playable format. See
`SCORING_ARCHITECTURE.md`.

### Known limitations

See the "Known limitations" section of `SCORING_ARCHITECTURE.md` — in
short: the DB (Postgres trigger) and TS implementations of Stableford are
two hand-synced copies by necessity; `calculateDailyHandicap` is schema-
blocked; only one rounding mode exists; existing `stableford_pts` rows were
not retroactively recomputed by migration 019.

### Manual verification steps

1. Run the automated unit tests (see "Running the scoring-domain tests"
   below) — 51 tests covering every rule above.
2. In the live scoring screen, score a hole where the player receives a
   handicap stroke (check the "SHOTS" tile shows the expected count for
   their playing handicap and that hole's index) and confirm the points
   shown match the nett-score table above.
3. Score a hole with a very low gross score and a handicap that grants 2
   strokes on that hole (e.g. gross 1, hole par 5, handicap ≥ 19 on SI 1) —
   confirm the points shown are not silently capped at 5.
4. In Supabase, directly compare a `score_entries.stableford_pts` value
   against the TS calculation for the same inputs — they should match,
   since migration 019 keeps the DB trigger in sync with the domain logic.

### Running the scoring-domain tests

```bash
npm install   # pulls in tsx, added as a devDependency for this
npm test
```

This runs all 51 tests in `src/lib/scoring/*.test.ts` via Node's built-in
test runner. I ran these myself in this sandbox by compiling the scoring
module (which has zero npm dependencies — only Node built-ins and its own
local files) with a globally available `tsc` and executing the output with
`node --test`, since I don't have network access here to run `npm install`
against the full project. Result: **51/51 passing.** One test
(`stableford.test.ts`, "result better than albatross") had a genuine
arithmetic mistake in its own hand-worked example — the implementation was
correct, the test's chosen inputs weren't; I corrected the test's inputs
rather than the implementation. Full detail in the completion report below.
