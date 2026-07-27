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

---

## Critical Fixes — "No scorecard found" + Logo Loading

### Issue 1 root cause: "No scorecard found for this group"

**Not a scorecard-creation bug.** `begin_round()` (migration 016) was already
correctly creating one scorecard per assigned player. The bug was entirely
in the scoring page's READ path:

`page.tsx` queried scorecards with:
```
.from('scorecards').select('..., trip_members!inner(group_id), ...')
```
`scorecards.player_id` references `profiles(id)` — there is **no foreign
key from `scorecards` to `trip_members`**, so PostgREST has no relationship
to embed. This query failed on every single request, for every user, on
every round. The failure was never checked (`allCardsRes.data ?? []`
silently turned the error into an empty array), so the page always believed
there were zero scorecards, regardless of what was actually in the database.

**Fix:** fetch scorecards on their own (their embeds of `profiles` and
`score_entries` ARE valid — real foreign keys exist for both), fetch
`trip_members` separately, and merge group membership in application code
instead of asking PostgREST to embed a relationship that doesn't exist.

**Practical implication:** the existing live "Round 1" almost certainly
already has correct scorecard data — see migration 021's diagnostic query to
confirm this for your specific round before assuming a repair is needed.

### Issue 1 — additional hardening added

- `begin_round()` (migration 020) now verifies, after insert, that the
  distinct hole count and active scorecard count match what was expected,
  and that every scorecard's player has a playing-group assignment — RAISEs
  (full rollback, round stays `upcoming`) if not. Returns a structured
  result: `{ roundId, holesCreated, scorecardsCreated, expectedScorecards,
  groupsProcessed, success }`.
- The direct-insert fallback path (used only if the RPC itself doesn't
  exist) now runs the equivalent checks before flipping the round to
  `active`.
- The start-round API route no longer falls back to direct inserts when the
  RPC raises a genuine validation error (`HOLE_COUNT_MISMATCH`,
  `SCORECARD_COUNT_MISMATCH`, `UNMAPPED_PLAYING_GROUP`) — that fallback path
  doesn't have those checks, so silently retrying through it would have
  reintroduced the exact problem the RPC just caught. Fallback is reserved
  for "the RPC doesn't exist yet" only.
- Organiser group resolution: `page.tsx` now keeps every group in
  `allGroups` for an organiser (even an empty one), instead of filtering
  empty groups out — an empty group is exactly the state an organiser needs
  to see and act on, not one to hide.
- The scoring screen no longer shows a flat "No scorecard found for this
  group" in every case. It now distinguishes: organiser + genuine empty
  group → "Scorecards were not created correctly for this group. Return to
  the trip and regenerate the round setup."; ordinary player + genuine empty
  group → a message telling them to contact the organiser, not a dead end.
- Temporary structured diagnostic logging was added to `page.tsx`, gated
  behind `SCORING_DEBUG=1` (off by default) — logs `user_id`, `trip_id`,
  `round_id`, `trip_member_id`, `trip_role`, `resolved_group_id`,
  `available_group_ids`, and scorecard counts before/after filtering. **Do
  not leave `SCORING_DEBUG=1` set in production** — remove it from Vercel's
  environment variables once this is confirmed fixed.

### Existing broken test round — repair or recreate?

Given the root cause was a read-path bug, not a write-path bug: **the
existing "Round 1" almost certainly does not need repair.** Redeploying the
fixed `page.tsx` should be sufficient on its own.

To be certain, run the diagnostic query at the top of migration 021 against
the actual `round_id` for Round 1 before doing anything else. If — and only
if — that diagnostic genuinely shows missing or unmapped scorecards, run:
```sql
SELECT public.repair_round_scorecards('YOUR_ROUND_ID');
```
This is idempotent and safe to run more than once; it only creates
scorecards that are genuinely missing and never touches existing
`score_entries`.

### Issue 2 root cause: logo not loading

- Two separate logo files existed (`/public/logo-full.png`,
  `/public/logo-app.png`), referenced from two different, non-shared
  components (`(auth)/BrandLogo.tsx`, and inline markup duplicated in
  `AppNav.tsx`). Neither was case-ambiguous or corrupted in this working
  tree, and `logo-app.png` (used in `AppNav`, visible on dashboard/trip
  pages) was clearly rendering fine in the screenshots — only
  `/logo-full.png` (the `(auth)` pages only: login/join) showed a broken-
  image icon in production.
- This points at the same recurring class of issue already noted in
  project history: a file present in the working tree but not committed
  (`git add`-ed) before a Vercel deploy 404s in production while working
  fine in local dev. I can't verify your actual git/Vercel state from here
  — see the deployment steps below for how to confirm it this time.
- Consolidated to **one** shared component (`src/components/brand/
  BrandLogo.tsx`), used on the `(auth)` pages (landing/login/join),
  `AppNav` (dashboard + every `(app)` page including trip pages), and the
  scoring screen header (which previously had no logo image at all, just
  text).
- Moved both assets to the stable path the brief specified:
  `/public/brand/teein-it-up-logo.png` and `/public/brand/teein-it-up-
  icon.png`. Old `/public/logo-full.png` and `/public/logo-app.png` removed
  — nothing references them anymore.
- The `(auth)` logo now uses a responsive `fill`-based wrapper
  (`clamp(160px, 55vw, 280px)`) instead of a fixed 220px box, so it scales
  correctly on narrow phones without clipping, and is larger/more prominent
  per the requirement.
- Removed the `next/image` `fill`-inside-fixed-box pattern in favor of
  explicit width/height for the icon variant (header use), which is more
  robust across build environments.
- Added a genuine text fallback (`Teein' It Up` in the display font) that
  only appears on an actual `onError` from `next/image` — there was no
  golfer-emoji fallback in the code to begin with (confirmed by search), but
  there also wasn't a controlled fallback for a genuine load failure either;
  now there is.

### Manual test steps for the logo (do these on the actual Vercel deployment)

1. Hard refresh (Ctrl+Shift+R) the landing/login page — confirm the full
   crest logo renders, not a broken-image icon.
2. Open DevTools → Network tab, filter "brand" — confirm both
   `teein-it-up-logo.png` and `teein-it-up-icon.png` return **HTTP 200**,
   not 404.
3. Repeat in an incognito window (rules out a stale local cache).
4. Check the join page, dashboard, a trip page, and the scoring page — all
   should show the compact icon variant in the header.
5. Check on a mobile viewport (DevTools device toolbar or a real phone) —
   confirm no clipping and the logo still reads clearly at the smaller size.

If it's still broken after deploying this fix, the very next thing to check
is `git status` / `git ls-files public/brand/` — confirm both PNGs are
actually tracked and were included in the commit that got deployed, not just
sitting on disk locally. This exact class of issue has happened before on
this project.

---

## Self + Marker Scoring Model (MiScore-style)

Sprint 5B's default scoring model changed from "one scorer enters the whole
group" to "each player enters their own score and one nominated marker
partner's score." The old model is retained, not deleted — see
`rounds.score_capture_mode` (`self_and_marker` is now the default,
`group_scorer` is the legacy behaviour, selectable per round).

### Marker assignment rules

- 2 players: mutual — each marks the other.
- Even player count: consecutive mutual pairs in playing order.
- Odd player count: circular — each player marks the next, wrapping around.
- Auto-generated the moment a round begins (`autoGenerateMarkers` in the
  start-round route), and fully visible/editable afterward at
  `/trips/[tripId]/rounds/[roundId]/markers` (organiser-only).

### Data model

`round_markers (round_id, player_id, marker_player_id)` — one row per
player, directional (`marker_player_id` records `player_id`'s score, in
addition to their own). This is what makes a 3-player circular assignment
representable without forcing symmetry.

`score_entries` gained `capture_role` ('self' | 'marker'), and the unique
constraint widened from `(scorecard_id, hole_id)` to
`(scorecard_id, hole_id, capture_role)` — a player's self-entered score and
their marker's entry for them are two independent rows, never one
overwriting the other. `gross_score` is now nullable for a genuine pick-up
(previously it was forced to always store some number even when picked up).

### Stableford and handicaps

Unchanged calculation, but the input handicap is always the *scored
player's*, never the marker's — `getHandicapStrokesForHole` is called with
`scorecard.playing_handicap` for whichever scorecard is being written to,
regardless of who's entering the data. Darren recording Alex's score still
uses Alex's handicap and stroke allocation, because the marker capture is
written against Alex's `scorecard_id`, not Darren's.

### Permissions

Enforced in both places, not just the UI:
- DB: `score_entry_capture_allowed(scorecard_id, capture_role)` — mode-aware;
  self_and_marker mode checks `round_markers` for a marker-role write,
  `same_playing_group()` (unchanged) only applies in group_scorer mode.
- API: `/api/scores` mirrors the same logic server-side before writing
  anything, independent of RLS.
- `round_markers` itself: only organisers can write (RLS `FOR ALL` policy),
  players can only read — matches "a player may not change marker
  assignments."

### Offline dedupe

The Dexie queue key widened from `(scorecardId, holeId)` to
`(scorecardId, holeId, captureRole)` — a self entry and a marker entry for
the same hole are queued, retried, and deduped completely independently,
and never collide with each other. Existing queued rows (pre-marker model)
are backfilled to `capture_role: 'self'` via a Dexie v2 upgrade function.

### Resume behaviour

Resumes at the first hole where either the player's own score OR their
marker entry for their partner is missing — not hole 1. Computed from
server-hydrated data merged with anything still in the local offline queue,
same pattern as the existing hydration logic.

### Reconciliation

After hole 18 (or via "View Score Comparison" once all holes are done), a
comparison screen shows matched/mismatch/pending counts and lists each
mismatched hole with both values. **Known limitation:** you can only edit
*your own* side of a mismatch from this screen — correcting your marker's
entry for you requires the marker (or the organiser) to do it, since a
player isn't permitted to write into someone else's capture role for
themselves. This matches the permission model but is a narrower editing
experience than a full two-sided reconciliation UI would offer.

### Existing data — no recreation needed for previous rounds

`capture_role` defaults to `'self'` for every existing `score_entries` row
— they keep meaning exactly what they always meant (a single authoritative
capture), nothing is silently upgraded to "verified marker score." Rounds
already begun under the old model don't need any migration; only rounds
begun *after* migration 022 get marker assignments auto-seeded. A round
already in progress when this deploys will have no `round_markers` rows
until the organiser visits the marker review screen and clicks
"Auto-assign" for each group (or the organiser sets `score_capture_mode`
to `group_scorer` for that round if a full marker retrofit isn't wanted).

### Manual testing required (not run against a live app in this pass)

**Two-player group:** mutual marking, both enter both scores, matched and
mismatch detection, reconciliation edit flow.

**Four-player group:** two independent marker pairs, each player sees only
their own card + their assigned marker's card, no access to the other
pair's cards, organiser can view all pairs via the marker review screen.

**Three-player group:** circular assignment, each score gets one
independent marker capture, verify Alex/Darren/Sam wraps correctly.

**Offline:** enter both own and marker scores offline, refresh (unsynced
data should still show), reconnect, confirm no duplicate `score_entries`
rows, confirm comparison status updates once synced.

**Reconciliation:** all holes match; one mismatch; multiple mismatches;
marker score missing; self score missing; picked-up vs numeric mismatch;
corrected score recalculates Stableford correctly.

**Permissions:** a player cannot POST a marker-role entry for someone who
isn't their assigned partner (expect 403); a player cannot write a self-role
entry for anyone but themselves outside group_scorer mode; the assigned
marker can score their partner; the organiser can inspect/correct any
scorecard; a non-member gets denied.

---

## Fix: `individual` Mode Was Not Genuinely Distinct From `self_and_marker`

Review correctly caught a real bug: the permission logic (both the API
route and the DB function) branched only on `group_scorer` vs "everything
else," so `individual` mode fell into the same code path as
`self_and_marker` — a marker-role write would have been honoured in
`individual` mode if a `round_markers` row happened to exist for that
player, even though `individual` mode is supposed to have no marker concept
at all.

### Root cause

`score_entry_capture_allowed()` (migration 022) and `/api/scores`'s inline
branching both checked `capture_role === 'marker'` and looked up
`round_markers` unconditionally whenever the mode wasn't `group_scorer` —
never checking that the mode was specifically `self_and_marker` first.

### Fix

- New pure, tested module `src/lib/scoring/captureMode.ts` —
  `isCaptureAllowed({ mode, captureRole, isOwnCard, isOrganiser, ... })` is
  now the single source of truth on the TS side, with 15 tests covering all
  three modes explicitly, including "individual mode denies marker role
  even if isAssignedMarker is somehow true."
- `/api/scores` now calls this function instead of ad hoc branching, and
  structurally never even looks up `round_markers` for an `individual`-mode
  request.
- Migration `023_individual_mode_permission_fix.sql` fixes the DB-side
  function to match — `individual` mode now has its own explicit branch that
  never consults `round_markers`.
- `autoGenerateMarkers()` (start-round route) now only seeds marker
  assignments for `self_and_marker` mode — previously it skipped only
  `group_scorer`, so `individual` mode rounds were getting `round_markers`
  rows created for them, which is exactly backwards.
- `page.tsx` no longer even queries `round_markers` for `individual` mode —
  `markedScorecard` and `markedByName` are structurally `null` for that
  mode, not just filtered out downstream.
- `SelfMarkerScoreShell.tsx` gates every marker-related behaviour on a
  `requiresMarker = round.score_capture_mode === 'self_and_marker'` flag,
  checked at every point: which card renders, whether comparison status is
  computed, whether Confirm requires a partner score, resume logic, and
  whether the end-of-round reconciliation screen exists at all for that
  round.

### Confirmed behaviour (per the review's checklist)

1. **`individual` mode does not require `round_markers`.** ✅ — `page.tsx`
   never queries it for this mode; `autoGenerateMarkers` never seeds it.
2. **`individual` mode does not create marker captures.** ✅ — Card 2 never
   renders (`requiresMarker && markedScorecard`), and `markedScorecard` is
   always `null` for this mode regardless of any stray data.
3. **`individual` mode does not block submission awaiting marker data.** ✅
   — the reconciliation screen is only reachable when `requiresMarker` is
   true; Confirm only requires the player's own score.
4. **`individual` mode resumes based only on missing self scores.** ✅ — the
   resume calculation's `partnerDone` check short-circuits to `true`
   whenever `!requiresMarker`.
5. **RLS permits only the player or organiser to enter that player's
   score.** ✅ — migration 023's `score_entry_capture_allowed()`, `individual`
   branch: `capture_role = 'self' AND v_target_player = auth.uid()`, or
   organiser.
6. **The UI shows one scoring card, not two.** ✅ — Card 2's render
   condition includes `requiresMarker`.
7. **Existing `group_scorer` behaviour remains unchanged.** ✅ — its branch
   in both the pure function and the DB function is untouched from
   migration 022; `captureMode.test.ts` has explicit group_scorer coverage
   confirming this.

### Tests added for all three modes

`src/lib/scoring/captureMode.test.ts` — 15 tests: 5 for `self_and_marker`
(own-card self writes, assigned-marker writes, denial for the wrong marker,
denial when merely in the same group but not the assigned marker), 5 for
`individual` (own-card self writes, denial for others, **marker role always
denied even when `isAssignedMarker: true`**, denial even for same playing
group, organiser bypass), 4 for `group_scorer` (same-group self writes,
cross-group denial, marker role always denied regardless of flags, own-card
always allowed), plus 1 confirming the organiser bypass applies identically
across all three modes. **82/82 total domain tests passing** (67 + 15 new).

---

## Sprint 5C.1 — Live Leaderboard

First stage of Sprint 5C, per the staged rollout plan (5C.1 leaderboard →
5C.2 group progress/organiser dashboard → 5C.3 side competitions). Only
5C.1 is in this delivery.

### Bug fixed while building this

The leaderboard API already existed from earlier Sprint 5A scaffolding but
was never wired to any UI. It summed **every** `score_entries` row per
scorecard — before migration 022 (marker scoring), a scorecard could only
ever have one row per hole, so this was correct at the time. Since 022, a
scorecard can have both a `'self'` row and a `'marker'` row for the same
hole (the unique constraint widened to `(scorecard_id, hole_id,
capture_role)` specifically to allow that). Summing both would double-count
any hole currently mid-reconciliation. Fixed by filtering to
`capture_role = 'self'` only — the same convention `SelfMarkerScoreShell`
already uses for the player's own running total, not a new rule.

Also added `export const dynamic = 'force-dynamic'` — this route will now
be polled, and this is the exact same caching bug class found and fixed in
`my-scores`/`groups` earlier in this project.

### What's new

- `src/components/scoring/LiveLeaderboard.tsx` — polls the leaderboard API
  every 8s while `round.status === 'active'` (stops polling automatically
  once a round isn't live — no polling for finished rounds), plus
  `refetchOnWindowFocus`/`refetchOnReconnect`, matching the established
  live-refresh pattern exactly.
- Movement arrows (▲/▼/–) computed client-side by diffing each poll's
  positions against the previous one — no new state persisted anywhere,
  no new query key, just a comparison of two consecutive reads of the
  existing leaderboard output.
- New "Leaderboard" tab on the trip page, showing the active round's board,
  or the most recent round's final standings if none is currently live, or
  an empty state if no rounds exist yet.

### Manual test steps

1. With a round active and at least 2 players scoring, open the
   Leaderboard tab — confirm position, name, points, "Thru N", and medal
   emojis for top 3 all display correctly.
2. Confirm a score as one player, wait up to 8s (or refocus the browser
   tab) — confirm the leaderboard updates without a manual refresh.
3. Get two players' totals to cross over (the trailing player takes the
   lead) — confirm the movement arrows update to reflect the swap.
4. Mark a round complete (all holes for all players) — confirm polling
   stops (check Network tab: no further requests to the leaderboard
   endpoint) and the final standings remain correct.
5. Test with a self_and_marker round specifically — confirm a hole with
   both a self entry and a marker entry (before reconciliation) is **not**
   double-counted in that player's total.
6. Open the Leaderboard tab with no rounds created yet — confirm the empty
   state, not an error.

### Not in this delivery (5C.2 / 5C.3)

Group progress panel, organiser tournament dashboard, side competitions
(Nearest the Pin, Longest Drive, etc.), and the player "position/points
behind leader" quick-view are all separate, later stages per the staged
plan — not built in this pass.

### Update — tournament summary header added

The Leaderboard tab now opens with a summary card (round name, scoring
format, player count, currently-scoring count, finished count, and a live-
updating "Last updated Xs ago" line) above the standings list, per
feedback that the leaderboard should feel like "the home of the
tournament" rather than just a list. Reuses the same leaderboard API
response (added `scoring_format` to the existing query) — no new data
source. The "Last updated" text ticks forward every 10s independently of
polling, so it stays accurate even between refreshes.

---

## Navigation Architecture Update

Two distinct navigation layers now exist:

**Trip management** (top tabs, unchanged mechanism): Overview | Players |
Groups | Rounds — Leaderboard and Side Games removed from this row.

**Live event** (new persistent nav): Home | Leaderboard | Side Games |
Tournament (organiser only) | Chat.

### How it works

`src/app/(app)/trips/[tripId]/layout.tsx` is new — it wraps every route
nested under a trip, including the scoring pages under `rounds/[roundId]`,
which is why the bottom nav appears there automatically without those
scoring files needing to render it themselves. This layout does a
lightweight `trip_members` role check (same pattern already used in
`page.tsx`) to decide whether Tournament shows.

Leaderboard and Side Games, previously tabs inside `TripDetailClient`,
are now real routes: `trips/[tripId]/leaderboard`, `trips/[tripId]/
sidegames`. Two new placeholder routes: `trips/[tripId]/tournament`
(organiser-only, with a real server-side redirect guard for non-organisers
— not just a hidden nav link) and `trips/[tripId]/chat`.

### Manual test steps

1. Mobile viewport: confirm top tabs show only Overview/Players/Groups/
   Rounds, no wrapping or overflow.
2. Confirm the bottom nav appears on: trip Overview, Leaderboard,
   Side Games, Chat, and both active-scoring screens (self+marker and
   group_scorer modes) and the Score Comparison screen.
3. As a normal player, confirm Tournament is absent from the bottom nav
   AND that navigating directly to `/trips/{id}/tournament` redirects you
   away rather than showing the page.
4. As an organiser, confirm Tournament appears and the placeholder loads
   with no working buttons (by design — 5C.2 builds the real screen).
5. Confirm Confirm Score, the last leaderboard row, and Score Comparison's
   bottom controls are not obscured by the fixed bar — scroll to the very
   bottom of each screen.
6. Desktop viewport (≥768px): confirm the fixed bottom bar is gone and a
   horizontal nav row appears instead, with the same five (or four, for
   players) destinations, not duplicated anywhere else.
7. Confirm login/signup/reset-password/join/create-trip screens never show
   this nav (they sit outside the `trips/[tripId]/` route tree entirely,
   so this should hold structurally, not just by convention).
