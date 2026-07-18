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
