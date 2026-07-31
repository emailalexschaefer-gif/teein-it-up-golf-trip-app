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

---

## Sprint 5C.2 — Tournament Control Centre

### New API
`GET /api/trips/[tripId]/rounds/[roundId]/tournament` — organiser-only
(403 for non-organisers). Not a duplicate of the leaderboard route: that
returns a ranked player list; this returns group-level operational state
(current hole per group, reconciliation mismatches, alerts) which is a
genuinely different question, built on the same underlying tables and the
same `capture_role='self'` convention the leaderboard already established.

### What's real vs. honestly limited
- **Health, Summary, Group Progress, Quick Actions, Live Stats (birdies/
  pars/bogeys/avg/best-hole/hardest-hole):** computed from real, current
  `scorecards`/`score_entries`/`holes` data. Nothing fabricated.
- **Timeline:** genuinely sourced from `score_entries.entered_at` — a real
  timestamp column confirmed to exist before building this (not assumed).
  Shows the 15 most recent confirmed self-entries, most recent first.
- **Alerts:** derived from *current* state (which groups have mismatches,
  which are waiting, which are stuck), not a true historical event log —
  there isn't one to query. Framed honestly as current status, not history.
- **Longest Drive / Nearest Pin stat cards:** explicitly show "Coming in
  Sprint 5D" rather than fabricated numbers, since Side Games isn't built.
- **Pause Round / Close Round / Finalise Results:** deliberately **not**
  included in Quick Actions — no handlers exist anywhere in the codebase
  for these (checked before building), and the brief was explicit not to
  create dead buttons.
- **"Review Reconciliation" as a distinct quick action:** also not
  included — no dedicated organiser-wide reconciliation screen exists to
  link to. Reconciliation issues are surfaced as Alerts instead.

### Step 1 — scoring polish
`SelfMarkerScoreShell.tsx`: "Marked by" text made smaller/lighter
(11px→10px, `#6b7280`→`#b0b6be`); gap beneath the score number increased
(2px→6px); Pick Up button moved closer to the score row (4px→2px gap) with
increased contrast (light-grey text→darker grey, transparent
background→light fill). Logic unchanged.

### Manual test steps
1. As organiser, open Tournament — confirm health banner, summary card
   with progress bar, group cards (tap to expand → player list with
   mismatch/waiting badges), alerts, timeline, quick actions, stats grid,
   and group map all render.
2. As a normal player, confirm Tournament is absent from the bottom nav,
   and navigating directly to `/trips/{id}/tournament` redirects to the
   trip Overview rather than showing content.
3. Create a deliberate self/marker mismatch on one hole — confirm it
   appears in that group's status badge, the expanded player row, and the
   Alerts list within one poll cycle (≤8s) or on window refocus.
4. Confirm polling stops once the round is no longer active (check Network
   tab — no further requests to the tournament endpoint).
5. Confirm the "Review Marker Assignments" and "View Leaderboard" quick
   actions navigate correctly.

---

## Sprint 5C.2 Addendum — Field-Tested UX Improvements

### 1. Round Start Notification
New `RoundStartBanner.tsx`, rendered in the shared trip layout so it can
appear on any live-event page except the scoring screen for that exact
round (redundant there). Reuses the **existing** `my-scores` endpoint to
show the current user's marker name — no new API. Dismissible per-round
via `sessionStorage` (won't nag every page load once dismissed, resets
naturally for the next round).

### 2. Bottom Navigation Reorder
New order: Home | Scorecard | Leaderboard | Side Games | Tournament
(organiser only) | Chat. "Scorecard" is new — links directly into the
active round if one exists (fetched once in the shared layout, passed down
to both nav components), or falls back to Home if no round is active yet.

### 3. Reduced Vertical Scrolling
`SelfMarkerScoreShell.tsx`: card margins/padding tightened throughout
(card `marginBottom` 16→10, internal padding 14→10, +/− buttons 54→48px,
score number 48→44px). Honest note: with both YOUR SCORE and YOUR MARKER
cards visible in self_and_marker mode, guaranteeing everything including
Confirm Score fits on one screen on every device isn't something I can
promise from here — this is a real, meaningful tightening, not a
guaranteed fit on all screen sizes.

### 4. Round Summary
The reconciliation screen ("Score Comparison") is now "Round Summary" —
shows **every** hole (not just mismatches) as a compact tappable row with
points and a status icon (✓ / 🔴 / 🟡), tap any row to jump straight
there. The TOTAL tile on both scoring cards is now itself a button that
opens this screen. The detailed self-vs-marker breakdown for holes that
actually need review is preserved below the compact list, not discarded —
tells you *why*, not just *which*. The "Round Summary" access button below
Confirm Score is no longer restricted to the last hole only.

### 5. Organiser Close Round
New endpoint: `POST /api/trips/[tripId]/rounds/[roundId]/close` —
confirmed no equivalent existed anywhere before writing it. Transitions
`active` → `completed`, organiser-only, with a **server-side** completion
guard (every scorecard has all holes self-scored, and in marker mode every
self-entered hole also has a marker entry) — not just a UI-level check, so
the round can't be closed early via a direct API call even if the button
were somehow bypassed. Tournament Control shows "🟢 Tournament Ready to
Close" + a Close Round button only when this same condition is already
true client-side (100% complete, zero outstanding reconciliations).

### Manual test steps
1. As organiser, start a round — confirm the banner appears for other
   players within one page load/poll, showing their correct marker name.
2. Dismiss the banner, reload — confirm it stays dismissed for that round.
3. Confirm Scorecard in the bottom nav jumps directly into the active
   round; with no active round, confirm it falls back to Home.
4. On the scoring screen, tap the TOTAL tile on either card — confirm
   Round Summary opens showing all holes, tap any row — confirm it jumps
   to that hole and closes the summary.
5. Create a mismatch, open Round Summary — confirm that hole shows 🔴 in
   the compact list AND still appears in the detailed "Needs review"
   section below with the actual score values.
6. Complete every hole for every player in a test round (matching in
   marker mode) — confirm Tournament Control shows "Ready to Close" and
   pressing Close Round succeeds; confirm attempting to close early via a
   direct API call is rejected with a 409, not just blocked by the UI.

---

## Sprint 5C Polish & Organiser Experience Update

### Root cause of the Round HQ loading blocker — found and fixed

The tournament API route's `scorecards` query embedded
`trip_members:player_id ( group_id )` as a PostgREST relationship join.
No foreign key exists from `scorecards.player_id` to `trip_members` — it
references `profiles` directly, and `trip_members` is a separate join
table keyed by `(trip_id, profile_id)`. This is the **exact same class of
bug** already found and fixed once earlier in this project (on the trip
detail page's scorecards query) — reintroduced here in a different file.
PostgREST throws a real error for a nonexistent embed, which surfaced as
"Couldn't load tournament data."

**Fix:** split into two separate queries (scorecards+profiles+
score_entries, and trip_members for group_id) and merge in JS — identical
pattern to the earlier fix, not a new approach.

**Also added, per the explicit requirements:**
- A real "No active round" state with an organiser action (link to
  Rounds), shown whenever there's no round with `status = 'active'` —
  replacing the previous silent fallback to showing a stale/completed
  round's data.
- A manual **Retry** button in `TournamentControl.tsx`, alongside React
  Query's existing automatic retry — both now present, not one or the
  other.

### Rename — Tournament Control → Round HQ

UI terminology only, no route/API changes: bottom nav label, page
heading, loading/error text, and the "no active round" explanation.
The route itself (`/trips/[tripId]/tournament`) is unchanged, per the
explicit "no route changes required" instruction.

### Round Summary redesign

Full scorecard table: Hole / Par / Gross / Points columns, OUT and IN
subtotal rows, TOTAL row, player name header. Status refined from 3
states to the requested 4 (🟢 matched / 🔴 mismatch / 🟡 awaiting
confirmation / ⚪ not scored — the previous version collapsed the last
two into one "waiting" state). A success message appears when every hole
is matched. All built from the same `rows`/`mySelf` data already computed
for reconciliation — no new score calculation added, `calculateStableford`
is still the only place points are computed.

### Hole header simplified

`SelfMarkerScoreShell.tsx`: "Round 1 — Hole 15 of 18" replaced with large
"HOLE 15" + smaller "Round 1" subtitle, per the requested hierarchy. Also
reduces banner height (padding 16/12→10/8), contributing to the compact-
screen goal.

### Manual test steps
1. As organiser, open Round HQ with an active round — confirm it loads
   real data (not an error) for the first time.
2. As organiser with **no** active round, confirm the "No active round"
   message and "Go to Rounds" action appear, not stale data or an error.
3. Temporarily break connectivity — confirm both the automatic retry and
   the manual Retry button work.
4. Confirm the bottom nav shows "Round HQ," not "Tournament."
5. Open Round Summary — confirm Hole/Par/Gross/Points columns, OUT/IN
   subtotals matching hand-calculated sums, and correct status icons for
   a matched hole, a deliberate mismatch, a half-entered hole, and an
   unplayed hole.
6. Confirm the hole header reads "HOLE 15" prominently with "Round 1" as
   a smaller subtitle.

---

## Sprint 5C Polish — My Events / My HQ / Moments / Avatars

### Terminology renames (UI text only, no route/API changes)
- Home page: added a "My Events" heading above the trip list. Hero
  ("Run your golf trip like a pro" / "No admin chaos. Just great
  experiences.") is **unchanged**, per the explicit instruction.
- Bottom nav "Round HQ" → "My HQ" (route `/tournament` unchanged).
- "Tournament running smoothly" → "Round running smoothly."
- "Tournament Ready to Close" → "Round Ready to Close."
- Loading/error text now says "My HQ," not "Tournament."
- Internal code identifiers (`TournamentControl`, `TournamentData`) were
  **not** renamed — that's a larger refactor touching every import site,
  out of scope for a "purely UI terminology" change.

### Moments — foundation only
Added a Moments section inside My HQ with the exact empty-state copy
specified ("No moments captured yet / Photos and highlights from this
round will appear here") and a clearly-labeled "Capture a Moment —
coming soon" pill, not a clickable/broken button. No upload wired up.

### Profile avatar upload — new, isolated infrastructure
- **New migration** `024_avatar_storage.sql`: creates a public `avatars`
  Supabase Storage bucket (5MB limit, JPEG/PNG/WEBP only) with RLS
  policies — public read (avatars are shown to other trip members), owner-
  only insert/update/delete scoped to their own `{user_id}/` folder.
  Does not touch any existing table.
- `ProfileForm.tsx`: "Upload photo" / "Change photo" / "Remove" controls
  added around the existing avatar display. Uploads directly from the
  browser to Supabase Storage (the same client already used for saving
  other profile fields), fixed filename per user with `upsert: true` so
  re-uploading replaces rather than accumulating orphaned files, and a
  cache-busting query param so the new image displays immediately.
  Initials fallback is fully preserved — untouched code path when no
  avatar is set.

### My Golf — documented, not built
`docs/MY_GOLF_ARCHITECTURE.md` — describes the future `moments` table
shape, its RLS direction, and how existing tables (scorecards, leaderboard
position, trip_groups) already map to what My Golf will eventually
aggregate. No `my_golf` route or table created.

### Manual test steps
1. Confirm the dashboard shows the hero unchanged, then a "My Events"
   heading above the trip list.
2. Confirm the bottom nav says "My HQ," and My HQ's health banner/ready-
   to-close text say "Round," not "Tournament."
3. Open My HQ — confirm the Moments section shows the empty state and a
   non-clickable "coming soon" pill.
4. On Profile, upload a photo — confirm it displays immediately (no page
   reload needed to see it), persists after a real page refresh, and that
   re-uploading replaces it rather than leaving the old one behind in
   storage. Confirm "Remove" reverts to the initials fallback.
5. Confirm uploading a non-image file or an oversized file shows a clear
   error, not a crash.

---

## Sprint Update — My HQ Experience Refinement

### What was actually built (not just renamed)

- **Event Health** — renamed from the health banner, now labeled and
  positioned as the very first thing the organiser sees. Same computation
  as before, just relabeled and given a proper heading.
- **The Story** — genuinely rebuilt, not just renamed. The previous
  Timeline was literally the 15 most recent confirmed scores (an activity
  log). The Story now shows only milestones, computed by chronologically
  replaying every real `entered_at` timestamp: lead changes (recalculating
  the full ranking after every entry and detecting when the #1 position
  changes hands), hole-in-ones (real `gross_score = 1`), score-review
  moments (approximated at the later of the two conflicting entries'
  timestamps — a real, reasoned approximation, not a guess), group
  finishes, and round completion. Verified with 3 standalone logic tests
  before shipping, including a case specifically checking that a player
  staying in the lead the whole time does NOT generate false "lead
  change" spam.
- **Today's Highlights** — new, post-round only. Winner + margin, real
  birdie/eagle/hole-in-one counts, and "biggest comeback" computed from
  the same rank-replay (each player's worst-ever rank vs their final
  rank). No Moments or Longest Drive references — that data doesn't
  exist yet, and fabricating placeholder numbers here would be exactly
  what the brief explicitly warns against.
- **Leaderboard Snapshot** — new. Top 5 only, computed locally from data
  already fetched for other purposes (not a second call to the
  leaderboard route), with a "View Full Leaderboard" link. Never
  duplicates the full board.
- **Side Games Snapshot** — new, but honestly a placeholder: no side-game
  data model exists yet, so this shows a real "not set up yet" state
  linking to Side Games, not fabricated statuses.
- **Live Statistics** — Pars/Bogeys swapped for Eagles/Hole-in-ones, per
  the brief's own example list ("Birdies, Eagles, Hole-in-ones, Average
  Stableford").
- **Quick Actions** — added "Edit Groups" (links to the trip page, where
  Groups already lives). "Publish Results" and "Message Players" were
  deliberately **not** added — no handlers exist for either (checked
  before deciding), and the brief is explicit about not building dead
  buttons. Close Round and Start Round flows already existed from an
  earlier pass and are unchanged.

### Manual test steps
1. Confirm "Event Health" is the first card, labeled correctly.
2. Confirm The Story shows milestones only — not a hole-by-hole log —
   during an active round with multiple players scoring.
3. Deliberately create a lead change (a trailing player's total overtakes
   the leader) — confirm exactly one "moves into first" entry appears,
   not a flood of position-shuffle noise.
4. Complete a round — confirm Today's Highlights appears with a real
   winner/margin and real birdie/eagle counts, and is absent before the
   round completes.
5. Confirm Leaderboard Snapshot shows exactly 5 rows (or fewer with a
   small player count) and "View Full Leaderboard" navigates correctly.
6. Confirm Side Games Snapshot shows the honest placeholder and links to
   Side Games.

---

## My HQ Refinement — Story Accuracy & Meaningful Milestones

### What was refined

**Lead-change detection.** The previous version replayed every entry in
raw chronological (`entered_at`) order and recalculated the full ranking
after each one — technically correct, but it compared players who had
played different numbers of holes, so a player who simply entered scores
faster could show as "leading" purely from entry timing, then get
"overtaken" the moment a slower player's delayed entries came in. Fixed
by comparing players only at recognized checkpoints (every 3rd hole, plus
the final hole), and only among players who have reached that exact
checkpoint. A lead-change milestone now only fires when two or more
players are being compared at genuinely the same stage of play — never
across players with a different number of holes completed.

**Biggest Leaderboard Climb** (renamed from "Biggest Comeback"). Same
fairness fix applied: worst-vs-final rank is now computed from checkpoint
ranks (same holes-played basis at each), not raw chronological-replay
ranks.

**Verified, and fixed one real double-counting bug in the process:**
- Hole-in-one: confirmed detected purely on `gross_score === 1`, never on
  Stableford points or any derived value.
- Eagle: confirmed calculated against each hole's actual `par` (works
  identically for Par 3/4/5 — the formula `gross - par <= -2` doesn't
  assume Par 5). While verifying this, found that a hole-in-one on a Par 3
  (`1 - 3 = -2`) was satisfying the eagle condition too, double-counting
  the same real event under two labels. Fixed: hole-in-ones are now
  checked first and excluded from the eagle/birdie/par/bogey count
  entirely, so each real event is represented by exactly one statistic.

### Testing
Wrote and ran 3 standalone logic tests before shipping, specifically
including the exact scenario described in the brief (a player ahead on
raw holes, another player's delayed entries pulling ahead) — confirmed
it now produces zero spurious lead-change entries, a genuine
checkpoint-to-checkpoint change is still correctly detected, and a player
far behind on holes played is never used in any comparison at all.

---

## My HQ Alerts & Organiser Notifications (Parts 1–2 of this sprint)

### Scope delivered this pass, and what was honestly deferred

Given the size of the full brief (6 parts), this pass delivered **Part 1
(actionable alerts) and Part 2 (notifications foundation)** with real
care. Parts 3–6 (premium scoring visual refinement, Playing Handicap
display, hole badges, compact scorecard strip, Moments camera icon) were
**not started** this pass — flagging honestly rather than delivering a
rushed, thin version of everything.

### Part 1 — Actionable alerts

The tournament API now captures per-hole mismatch detail instead of a
group-level summary string: player name, marker name (from the real
`round_markers` table — not guessed), hole number, both gross scores,
group, and a real timestamp. Event Health shows the rich single-issue
example format when there's exactly one outstanding mismatch ("TEST —
Hole 18 / Group 1 · Marker mismatch / Review now →"), and a "View
affected players →" jump-link when there are several. Alert cards show
"Review Score" (linking directly to that round's markers page — the most
specific existing destination, not a generic trip screen) and "Notify
Group."

### Part 2 — Notifications foundation

**New migration** `025_event_messages.sql`: one `event_messages` table,
RLS enforcing exactly the rules requested — only confirmed trip members
can read, and only messages actually addressed to them (event-wide, their
own group, or personally — a player cannot see another group's targeted
message); only organisers can send. Deliberately supports `announcement`,
`group_notification`, and `player_notification` message types now;
`chat_message` is reserved in the schema for a future open-chat pass, not
used yet.

**New API** `/api/trips/[tripId]/messages` (GET/POST) — deliberately uses
the *regular*, non-admin Supabase client, since RLS on this table is
exactly what should govern access here, not something to bypass.

**Chat page** now shows real messages (sender, recipient context,
timestamp, pinned indicator) instead of a placeholder, plus an
organiser-only "Send Event Announcement" composer.

**Notify Group flow**: from a mismatch alert, opens a composer
pre-populated with a suggested message (matching the brief's exact
example format), editable before sending, targeting the real group via
its actual `group_id` (not just the display name).

**Unread badge**: a small red dot on the Chat nav icon. Deliberately not
a new polling loop or a new read-receipts table — reuses the existing
messages endpoint with `refetchOnWindowFocus` only (no interval), and a
simple localStorage last-read timestamp per trip. A reasonable
simplification for a "validate the concept" pass, not the final
architecture for a real read-receipt system.

### Manual test steps
1. Create a deliberate marker mismatch — confirm Event Health shows the
   exact player/hole/group, and "Review now →" opens the correct round's
   markers page directly.
2. Confirm "Notify Group" pre-populates a sensible message, is editable,
   and actually sends — check it appears in the Chat tab for members of
   that specific group.
3. As a player in a *different* group, confirm you do NOT see a
   group-targeted message aimed at another group.
4. Send an event-wide announcement — confirm all trip members can see it.
5. Confirm the Chat nav icon shows an unread dot after a new message is
   sent, and that it clears after actually opening Chat.
6. Confirm a normal player cannot send a message (API returns 403; no
   send UI shown to them in the first place).

### Known incomplete item
There is a real duplicate-`</div>` bug I introduced and fixed within this
same pass while building the Event Health card — re-verified after the
fix: balance check, lenient `tsc`, and the full scoring-domain suite all
pass clean now. Documenting it here rather than hiding that a bug
happened mid-pass.

---

## Production Messaging Fix — event_messages Table Missing

### What I can and can't verify from here

**Cannot verify:** which Supabase project Vercel's production environment
variables actually point to, or run SQL against your live database — no
access to either from this sandbox. This has to be your manual step; see
below.

**Confirmed instead:** before writing anything, I checked this project's
*actual* schema rather than trusting the brief's example policies at face
value. `trip_members` uses `profile_id` (not `user_id`) and has no
`status` column; there's no separate `group_members` table (group
membership is `trip_members.group_id`). The brief's example SQL used
placeholder names that don't match this project — copying it verbatim
would have failed outright. My original `025_event_messages.sql` already
used the correct real schema; I didn't need to redesign the RLS logic,
only add what was genuinely missing.

### What was added

**`supabase/event_messages_deploy.sql`** — one complete, standalone,
idempotent script (not a new numbered migration, since it doesn't change
the design, just deploys/hardens the existing one). Combines the original
table + RLS (unchanged logic) with: explicit named constraints (was
inline/anonymous), two additional indexes on `recipient_group_id`/
`recipient_user_id`, and — most likely the actual fix for "Could not find
the table... in the schema cache" if the table already exists —
`NOTIFY pgrst, 'reload schema';`, plus verification queries at the end.

**API error handling** (`messages/route.ts`): found and fixed the actual
leak — the POST handler was interpolating the raw Supabase error directly
into the client response (`Could not send: ${error.message}`), which is
exactly how "Could not find the table 'public.event_messages'..." reached
the browser. Both GET and POST now log full detail (code, message,
details, hint) server-side only, with explicit PGRST205 (missing-table)
logging, and return only a generic, safe message to the client.

**Client error handling** (`EventMessages.tsx`): the message-list error
state now shows "Messages are temporarily unavailable." with a working
"Try Again" button instead of a bare, unhelpful line. The composer error
paths (both here and in `TournamentControl.tsx`'s Notify Group flow)
already only ever display whatever the server sends — now safe by
construction, since the server no longer sends raw errors.

**Diagnostic health check** (`src/lib/diagnostics/eventMessagesHealth.ts`):
moved out of the route file — Next.js route handlers only permit HTTP
method exports plus a small config allow-list (`dynamic`, `revalidate`,
etc.), and an arbitrary function export from `route.ts` risks a build
error, not just a lint warning. Kept as a standalone utility, for manual
use only, never called automatically.

### Manual deployment steps required (cannot be done from here)

1. In Vercel's dashboard, confirm `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` all
   point at the same project, and confirm which project that actually is.
2. Run `supabase/event_messages_deploy.sql` in that project's SQL editor.
3. Run the three verification queries at the bottom of that same file —
   confirm `to_regclass` returns `public.event_messages`, the column list
   matches, and exactly 3 policies exist.
4. Retest in the deployed app: organiser sends a group notification from
   a mismatch alert → affected group sees it in Chat → an unrelated
   group's player does not.

### Confirmed unchanged
Scoring engine, Stableford calculations, marker logic, reconciliation,
leaderboard rankings, group assignment, existing authentication — this
pass only touched the messaging table/API/client error handling. 82/82
scoring-domain tests still pass.

---

## Messaging Diagnostic Pass — No Speculative Fixes This Time

Per the explicit instruction, this pass adds diagnostics only — no new
schema changes, no new RLS, no guessed fix.

### One theory ruled out with actual code evidence, not a guess

The brief's strongest suspicion was that `trip_members.profile_id` might
not equal `auth.uid()`. Checked against `001_profiles.sql` directly:
`profiles.id` is `PRIMARY KEY REFERENCES auth.users(id)`, and the
`handle_new_user()` trigger inserts every profile with `id = NEW.id` (the
literal `auth.users.id`) at signup — so `profile_id = auth.uid()` is true
by construction for every user, not an assumption. This exact comparison
is also already what every other working RLS policy in this app relies on
(`profiles`' own policy is `USING (auth.uid() = id)`; every trip/group/
scoring policy compares `profile_id` to `auth.uid()` the same way). If
this were broken, scoring, groups, and the leaderboard would already be
failing for everyone — they aren't. This specific theory doesn't hold up
against the schema as it actually exists.

### New diagnostic endpoint

**`GET /api/diagnostics/event-messages?tripId=<a trip you organise>`** —
temporary, organiser-only (checked server-side against real trip
membership, not just hidden from nav). Returns exactly the structured
fields requested: project hostname (derived from the same env var the
real app uses — never the anon/service-role key itself), auth state,
profile ID, trip membership/organiser findings, and — the key piece — a
real test read against `event_messages` through the exact same client
path the production GET/POST routes use, reporting `tableReachable`,
`errorCode`, `errorMessage`, `errorDetails`, `errorHint`. This distinguishes
"table missing/not visible to PostgREST" (PGRST205) from "table exists
but RLS denies" (42501) from other failure modes, using live evidence
rather than another guess.

**Must be removed after diagnosis** — noted directly in the file's own
header comment as a reminder.

### Logging

Both GET and POST now log the exact fields requested — code, message,
details, hint, plus tripId/userId (GET) or
tripId/recipientType/recipientGroupId/recipientUserId/senderUserId
(POST) — matching the brief's specified shape precisely, so whatever
appears in Vercel's production logs after reproducing the error will be
the exact evidence needed for the next, targeted fix.

### What I did NOT do this pass, per the explicit instruction

Did not touch the migration, RLS policies, or the messaging feature
itself. Did not guess at a new root cause. The next step is genuinely
data-dependent: hit the diagnostic endpoint against the live deployment,
or check Vercel's logs after reproducing a failed send, and report back
the exact `errorCode`/`projectHost`/`tableReachable` values.

Confirmed unchanged: scoring, Stableford, marker, reconciliation,
leaderboard, permissions. 82/82 scoring-domain tests still pass.

---

## Messaging Read Fix — GET Query Rebuilt Without Embedded Relationships

### Root cause, confirmed against this project's actual schema

The GET handler's Supabase query used embedded relationship syntax
(`sender:sender_user_id ( full_name )`, `recipient_group:recipient_group_id
( name )`). Checked the actual table definition: `event_messages` has
**two separate foreign keys into `profiles`** — `sender_user_id` and
`recipient_user_id`. That's exactly the ambiguous-relationship scenario
PostgREST can fail to resolve, even when the embed syntax explicitly
names the column to disambiguate. This is the third time this specific
class of bug has shown up in this project (previously: the trip detail
page's scorecards query, and the tournament route's scorecards query) —
both of those were fixed the same way, by splitting into separate queries
and merging in application code, rather than relying on PostgREST's
relationship inference.

### The fix

GET now selects only direct `event_messages` columns — no embeds at all.
Sender name and group name are fetched via two separate, unambiguous
queries (`profiles` by id, `trip_groups` by id) and merged into the
response in application code. The response shape sent to the client is
**unchanged** (`sender: { full_name }`, `recipient_group: { name } | null`)
— `EventMessages.tsx` needed no changes to its data handling, only a
wording tweak to the empty-state text.

### Other items addressed from the same brief
- Zero rows from the base query now returns `{ messages: [] }` explicitly
  and immediately — never treated as an error.
- POST now logs `event message inserted` with id/tripId/recipientType/
  recipientGroupId after a successful insert, confirming the row exists
  independently of whatever GET does.
- Empty-state client text changed to "No messages yet. Organiser
  announcements and group notifications will appear here." — distinct
  from and never confused with the genuine-failure "Messages are
  temporarily unavailable." + Try Again state (already correct from the
  previous pass, verified still correctly separated).

### Manual test steps
1. Organiser sends a Group 1 notification — confirm POST succeeds (as
   before) and the organiser can now see it in Chat (this was the actual
   broken step).
2. A Group 1 player opens Chat — confirms the message is visible.
3. A player from a different group opens Chat — confirms it is NOT
   visible.
4. Send an event-wide announcement — confirm all members see it.
5. Open Chat for a trip/round with zero messages — confirm "No messages
   yet," not an error.
6. Confirm sender name and group name display correctly (proving the
   separate-query enrichment merged correctly).

Confirmed unchanged: table creation, POST insert logic, scoring,
Stableford, marker, reconciliation, leaderboard. 82/82 scoring-domain
tests still pass.

---

## Player Experience Pass — Parts 7, 5, 2 (Parts 1/3/4/6/8 not attempted this pass)

Given the scale of this brief (8 parts), this pass prioritized the items
with the clearest correctness/functional value: **Part 7 (a real bug),
Part 5 (a real broken feature), and Part 2 (small, contained)**. Parts
1, 3, 4, 6, and 8 (full scoring-screen visual refinement, compact
scorecard overview, Powerplay/side-game badges, Moments capture, and the
cross-device mobile review) were **not started**. Flagging honestly
rather than delivering thin, rushed versions of everything.

### Part 7 — My HQ contradiction, root-caused and fixed

Found the exact bug: `tournament/route.ts`'s group-status logic checked
`allFinished` *before* `anyMismatch` in an if/else-if chain, so a group
that had finished all holes but still had an unresolved mismatch
incorrectly showed as plain `'finished'` — which the UI renders as "all
scores matched." Fixed by checking `anyMismatch` first, and adding a
genuinely new status (`finished_needs_review`) distinct from both
`finished` and the in-progress `reconciliation` state, so the UI can say
exactly "Finished — review required" rather than either the wrong
all-matched message or the misleading in-progress wording. Updated the
alert generation, the Story's group-finished milestone (still fires —
finishing all holes is true regardless of reconciliation status), and
the client's status-label map accordingly.

**Tested properly, not just type-checked:** wrote 3 standalone logic
tests, including the exact contradiction scenario (finished + mismatch
together) — confirms it's never labeled plain "finished," a genuinely
resolved group still shows correctly, and an in-progress mismatch stays
distinct from a finished-but-unreviewed one.

Also aligned terminology per the brief's explicit request: "Reconciliation"
→ "Review Required" throughout status labels.

### Part 5 — Profile photo pipeline, repaired

**Root cause of "Bucket not found":** matches the exact recurring
"migration never applied to production" pattern already seen multiple
times in this project. Not a new class of bug.

**What changed:**
- Bucket renamed `avatars` → `profile-photos` per the explicit preference,
  in both the numbered migration and a new standalone
  `supabase/profile_photos_deploy.sql` (same pattern as the
  `event_messages_deploy.sql` fix) — idempotent, includes the storage
  schema-cache reload, and verification queries.
- **Forced-camera bug fixed:** the hidden file input had `capture="user"`,
  which forces mobile browsers straight to the camera. Removed entirely —
  omitting `capture` lets the OS show its native "Take Photo / Choose
  from Gallery / Cancel" picker, which is what the brief asked for
  without needing a custom-built picker UI.
- **Real image processing added:** every selected/captured photo is now
  processed through a canvas before upload — center-cropped to a square,
  resized to 512×512, compressed to JPEG (~0.85 quality). Drawing through
  `createImageBitmap`/canvas also normalizes EXIF orientation implicitly.
  **Honest scope limit:** this is an automatic center-crop, not an
  interactive reposition/zoom tool — that's a materially larger feature
  (drag/pinch gesture handling, a cropper UI) not attempted this pass.
- **Preview step added:** the processed image is shown in a modal with
  "Use Photo" / "Choose Another" / "Cancel" before any upload happens —
  nothing uploads until confirmed.
- **Precise error messages:** "Photo storage is not configured." (bucket
  missing), "Upload permission denied.", "Unsupported image type.",
  "Photo is too large.", "Upload failed. Please try again." — matching
  the exact list requested, with full technical detail only in
  `console.error`.

### Part 2 — Playing Handicap terminology

Checked the actual value being displayed in both scoring shells before
changing anything: `hcp = activeCard?.playing_handicap` — already the
real, applied scorecard value (not a profile default), computed earlier
this session via `resolvePlayingHandicap`/rounding. Only the **label**
was imprecise — `(HC 14)` and `Daily HCP 14` respectively. Both changed
to "Playing Handicap 14," matching the brief's recommended display and
made consistent between the two scoring shells. No value/calculation
changed.

### Manual test steps
1. Deliberately create a group where all players finish but one hole has
   an unresolved mismatch — confirm My HQ shows "Finished — Review
   Required," never "all scores matched."
2. Resolve the mismatch — confirm the group correctly returns to plain
   "Finished."
3. On mobile, tap "Upload photo" — confirm the native picker offers
   camera AND gallery, not camera only.
4. Select a photo — confirm a square preview appears before any upload,
   with working Use Photo / Choose Another / Cancel.
5. Confirm the uploaded photo displays immediately, persists after a
   real page reload, and appears correctly in the header/leaderboard/etc.
6. Confirm both scoring shells show "Playing Handicap N," not "HC N" or
   "Daily HCP N."

### Confirmed unchanged
Stableford formula, handicap allocation engine, marker assignment logic,
reconciliation resolution rules, leaderboard ranking, final-results
calculations, messaging GET/POST, messaging RLS, trip membership logic.
82/82 scoring-domain tests pass, plus 3/3 new status-priority logic
tests for the Part 7 fix.

---

## Player Experience Pass — Honest Status Across 8 Parts

Given the scale of this brief, here's exactly what's verified-complete
from prior work, what was added this pass, and what's genuinely deferred.

### Already correctly implemented (verified, not assumed)

**Part 7 — My HQ consistency:** checked this thoroughly rather than
re-fixing blindly. The API already has a distinct `finished_needs_review`
status (red, "Finished — Review Required"), separate from plain
`finished` (green, "all scores matched") — a group can never show both
simultaneously, since `finished` is only reached when there is genuinely
no mismatch. Event Health already checks `mismatchAlerts.length` before
any group-status-based gold/green determination, so an unresolved
mismatch anywhere always keeps Event Health red, regardless of other
groups' status. Searched the whole codebase for the inconsistent
terminology the brief warned about ("reconciliation outstanding", "score
error", "mismatch pending", "review issue") — zero matches, already clean.

**Part 5 (storage/bucket portion) — already fixed:** `profile_photos_
deploy.sql` already exists, already correctly named throughout (bucket +
all 4 RLS policies consistently say `profile-photos`, matching the actual
upload code in `ProfileForm.tsx` exactly), already includes the schema-
cache reload and verification queries. The file input no longer forces
`capture=` — omitting it lets the OS show its native Camera/Gallery/Files
chooser, which was the other explicit complaint.

### Added this pass

**Part 2 — stroke visibility:** "Playing Handicap {hcp}" was already
displayed correctly, but "Receives N stroke(s)" / "No stroke received"
was missing from the hole header in both scoring shells. Added to both,
reusing the `strokes`/`strokesReceived` values already computed by the
existing handicap-allocation logic — no new calculation.

### Not attempted this pass, honestly

**Part 1** (broader premium visual refinement beyond what's already
shipped from earlier sprints), **Part 3** (compact scorecard overview —
`ScoreSessionShell` already has a hole strip; `SelfMarkerScoreShell` does
not), **Part 4** (Powerplay/side-game badges — no underlying data model
exists for these yet, so real badges can't be built without fabricating
data), **Part 6** (Moments capture — camera icon per hole, upload flow).
Given how much of Parts 2/5/7 turned out to already be done, I prioritized
verifying those thoroughly (not just claiming they were fine) over
starting several more large, unverified pieces of new UI in the same pass.

### Confirmed unchanged
Stableford formula, handicap allocation engine, marker assignment,
reconciliation resolution rules, leaderboard ranking, messaging GET/POST/
RLS. 82/82 scoring-domain tests still pass.

---

## Sprint 5F — Premium Scoring Experience & UI Polish

Scope: `SelfMarkerScoreShell.tsx` only this pass (the marker-mode shell,
which was genuinely missing the compact strip that `ScoreSessionShell`
already had). Pure presentation — no scoring/handicap/marker/
reconciliation/leaderboard/My HQ/messaging logic touched.

### Part 1 — Premium hole header
Added "Current Total: N pts" (reuses `myRunningTotal`, already computed —
no new calculation). "Playing Handicap {hcp}" and "Receives N stroke(s)"
were already added in the previous pass. "Current Group" was **not**
added — this component doesn't currently receive group-name data as a
prop, and plumbing that through felt like more than a pure-presentation
change belonged doing in the same pass as everything else here; flagging
rather than fabricating a placeholder.

### Part 2 — Compact score strip (the explicitly highest-priority item)
Added Front 9 / Back 9 tiles to `SelfMarkerScoreShell` — current hole
highlighted, gross score shown per tile, tap to jump (reuses the exact
`setHoleIdx` function the existing header/swipe navigation already
calls — no new navigation rule), Front 9 completion banner with the real
total. Colors and layout deliberately match the pattern already
established and shipped in `ScoreSessionShell`'s strip, not a new visual
language. Uses `calculateStableford()` — the same function
`myRunningTotal` already calls — for the per-tile points, not a second
calculation.

### Part 4 — Score confirmation
Already existed from earlier work ("✓ Saved!" brief button-state flash).
Verified, not re-built.

### Part 5 — Special hole badges, genuinely inactive
Checked the actual `holes` table schema (migration 004) before adding
anything: no Powerplay or side-game columns exist. Added real, working
badge-rendering code (`HoleBadges`) keyed off optional fields
(`is_powerplay`, `side_game_type`) that the current holes query doesn't
select and the database doesn't have — so this renders nothing today,
by construction, not because of an added conditional flag. It will
activate automatically once those columns are added, without needing
this component touched again.

### Part 6 — Camera placeholder
A visually subtle, inert 📷 in the header (`opacity: 0.35`, no onClick,
`aria-hidden`, title "Moments — coming soon"). Confirmed no upload logic,
no state, no Moments implementation anywhere near it.

### Not attempted this pass
`ScoreSessionShell.tsx` already has its own compact strip and header
info from earlier work — this pass focused on bringing
`SelfMarkerScoreShell` up to the same standard rather than touching both.
Broader Part 3/7/8/9 polish (typography/spacing refinement across every
screen, full mobile-width review, landscape support) was not
systematically audited this pass.

### Confirmed unchanged
Stableford calculations, handicap engine, marker logic, reconciliation,
leaderboards, My HQ logic, messaging, database schema. 82/82
scoring-domain tests still pass — same test suite, same results, only
presentation code touched.

---

## Sprint 5G — Scoring Anchor & Final UX Refinement

### Implementation

Added to both `SelfMarkerScoreShell.tsx` and `ScoreSessionShell.tsx`:
a `scoringAnchorRef` (an empty marker `<div>`) placed immediately before
the score-entry section, and a `useEffect` depending only on `holeIdx`
that calls `scoringAnchorRef.current?.scrollIntoView({ behavior: 'smooth',
block: 'start' })` whenever it changes.

### Why this satisfies "only on hole change, never mid-interaction"

This isn't a rule I had to separately enforce — it falls out of how React
`useEffect` dependency arrays work. All four transition paths (Next,
Previous, hole-strip tap, auto-advance after save) already funnel through
the same `setHoleIdx()` call — verified this directly for auto-advance
before relying on it, rather than assuming. Score edits, toast
notifications, sync-status changes, and every other state update in
these components do not touch `holeIdx`, so they structurally cannot
retrigger this effect. A `hasHydratedRef` guard skips the very first
run, so simply opening the scoring page doesn't itself cause a scroll
jump before the golfer has done anything.

### Why no offset math was needed

Checked the actual scroll-container architecture before implementing:
in both shells, the hole header and compact score strip live *outside*
the single `overflowY: 'auto'` scrollable region — they're rendered in
the normal document flow above it, not as a sticky/fixed element
overlapping the scrollable content. That means there's no sticky header
to compensate for inside the scrollable area itself, so a plain
`block: 'start'` scroll correctly surfaces the score-entry section (hole
number, par, stroke index, playing handicap, strokes received, score
controls, and the Confirm button, which sits directly below it) without
needing measured-offset calculations. Flagging this architectural
dependency explicitly: if the header layout changes to become sticky
*inside* the scroll region in a future pass, this would need revisiting.

### Future Premium content readiness

The anchor is just an empty ref div in the existing DOM position —
adding content (Pro Tips, AI Caddie, course notes, etc.) above it later
means inserting JSX before this div; the anchor's behavior doesn't
change, because it's defined by "where the score-entry section is," not
a fixed layout position.

### Not implemented
Explicit keyboard-visibility detection (Part 3's "keyboard is visible"
exclusion) — out of scope for reasonable effort without device testing;
mitigated in practice since typing/interacting with score controls never
changes `holeIdx`, so the effect can't fire mid-interaction regardless.

### Confirmed unchanged
Stableford calculations, handicap allocation, marker logic,
reconciliation, leaderboards, My HQ, messaging, profile photo upload,
database schema, side-game logic — this pass added two refs and two
`useEffect` hooks, nothing else. 82/82 scoring-domain tests still pass,
same suite, same results.

---

## Sprint 5H — QA Fixes (Round 1)

### Priority 1 — Profile photo "storage not configured"
**Not a code bug — confirmed, not guessed.** The client already correctly
translates a raw Supabase "Bucket not found" error into the friendly
"Photo storage is not configured." message (verified in `ProfileForm.tsx`).
Seeing that exact message is direct proof the raw error genuinely was
"Bucket not found," which Supabase's Storage API only returns when the
bucket id doesn't exist in that project. Same deployment gap as the
`event_messages` saga — `profile_photos_deploy.sql` (already built,
already verified correct: bucket name and all 4 RLS policies consistently
say `profile-photos`, matching the upload code exactly) is the actual
fix. No code change made here since none was needed.

### Priority 2 — Scoring Anchor landing too low
Replaced `scrollIntoView({ block: 'start' })` with a measured `scrollTop`
calculation in both shells (`getBoundingClientRect()`-based, with an 8px
top buffer) — exactly the fallback strategy Sprint 5G's own brief
anticipated might be needed if `scrollIntoView` proved inconsistent.
More deterministic across browsers than relying on the browser's own
"align to nearest edge" heuristic.

### Priority 3 & 8 — Hole strip clipping on Android
Root cause: fixed pixel tile widths (34–38px) × 9 tiles + gaps exceeded
common Android content widths (~344px after padding on a 360px-wide
screen) — the math doesn't work out, not a rendering bug. Fixed by
switching to `flex: '1 1 0'` tiles that divide available width equally
across exactly 9 columns, in both shells' front-9 and back-9 strips —
guarantees all 9 always fit on any screen width without needing a
guessed pixel size or a scroll affordance, rather than picking a smaller
number that might still fail on some device.

### Priority 4 & 5 — Reconciliation navigation + anchor
Added `?hole=N` deep-link support to `SelfMarkerScoreShell` (reads the
URL param once `holes` data loads, jumps to that hole). "Review now" and
"Review Score" in My HQ now link to
`/trips/{tripId}/rounds/{roundId}?hole={the affected hole}` instead of
the markers page. Traced through the effect ordering carefully before
relying on it: the deep-link's `setHoleIdx()` call goes through the same
`[holeIdx]`-dependent effect the Scoring Anchor already uses, so landing
on the hole via deep-link automatically triggers the same repositioning
— no separate special-case code needed. One honest caveat: the organiser
can only actually *correct* the score if they're the player or marker
for that scorecard (existing permission model, deliberately unchanged,
per "do not change reconciliation rules") — this fix improves navigation
target, not who can edit what.

### Priority 6 — Immediate My HQ refresh
After a successful score confirmation, `SelfMarkerScoreShell` now calls
`queryClient.invalidateQueries()` on both the `tournament` and
`leaderboard` query keys, rather than waiting for the 8s poll. Honest
scope note: this helps within the same browser session (e.g. an
organiser-who-is-also-playing resolving their own mismatch, a supported
and common pattern in this app) — true cross-device instant push to a
*different* organiser's separate session would need a realtime
subscription, which is a materially bigger architectural change than
this pass's scope ("prefer existing React Query cache invalidation").
Round Summary corrections are automatically covered too, since editing a
score there re-enters the same `confirmScore()` function — no separate
handling needed.

### Priority 7 — Manual chat messages failing
Compared both call sites directly, line by line: `EventMessages.tsx`'s
composer and `TournamentControl.tsx`'s Notify Group flow send an
identical payload shape to the identical API route, differing only in
`recipientType` ('all' vs 'group') and the absence/presence of a group
id — both valid per the API's own validation and the database
constraints. **I could not find a code-level difference that would
explain one working and the other failing**, and per the explicit "do
not guess" instruction, I did not invent a fix without evidence. Added
message-length and a safe truncated content preview to the existing
server-side error logging, so the next reproduction will show whether
message content specifically is implicated. This needs a live
reproduction + Vercel log check to actually resolve, which I cannot do
from this sandbox.

### Confirmed unchanged
Stableford calculations, handicap allocation, marker logic,
reconciliation rules, leaderboards, messaging architecture, My HQ
architecture, database schema, side games, Moments, premium features.
82/82 scoring-domain tests still pass, same suite.
