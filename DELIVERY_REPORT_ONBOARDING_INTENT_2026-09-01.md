# CRUCIAL MVP ONBOARDING UPDATE — PLAYER / ORGANISER / BOTH INTENT
## Delivery Report — 1 Sep 2026

**Build/test caveat, unchanged from every prior round:** no network
access — `npm run build` was not run, and there is no live Postgres
connection to execute the new migration. All files touched
syntax-check with **zero errors**. Full test suite: **407/407 pass**
(274 pure-function scoring + 5 SQL-scanning + 59 highlights + 8
analytics + 7 new profile + 54 trips).

---

## 8. INVESTIGATION FINDINGS (reported first, per the explicit instruction)

**Did Player/Organiser/Both exist anywhere previously?** No. Read
every migration touching `profiles` (001, 012, 014, 015, 026, 039) —
the only role-like field is `app_role` (`'member'`/`'admin'`,
migration 039), which is an **application permission** (admin-panel
access), not user intent. Confirmed distinct and left completely
untouched — selecting "Organiser" changes nothing about `app_role` or
any trip-level permission.

**Current profile/schema fields relevant to this:** `profiles` has no
existing preferences/segmentation structure of any kind to reuse.
Nothing appropriate existed — this migration adds two genuinely new
columns, following the project's existing plain-column convention
(matching `handicap_status`'s own `TEXT` + `CHECK` pattern) rather than
introducing a JSONB blob this project has never used elsewhere.

**Best persistence location:** `profiles.user_intent` (nullable
`TEXT`, `CHECK IN ('player','organiser','both')`) +
`profiles.organiser_types` (nullable `TEXT[]`, app-layer validated, not
DB-enum-constrained, since "Other" and future categories shouldn't
need a migration to add).

**Effect on password signup:** none. Not modified at all.

**Effect on magic-link signup:** **Important correction to the brief's
own premise, worth flagging directly** — magic link is not currently a
reachable signup path in the UI. An earlier round's own code comment
confirms it: "Magic Link removed from user-facing UX entirely... Not
deleting underlying auth support... removing this component's own UI
path to it doesn't touch that service at all." The underlying Supabase
capability still exists, but no button/form in this app currently
triggers it. I have not built anything specific to a magic-link UI
path, since there isn't one to build for — but the actual fix (below)
is structured so it would automatically cover magic link too, the
moment it's ever re-enabled, without needing separate work then.

**Effect on invitation/event join:** none to the join flow itself.
`JoinForm.tsx`'s signup branch uses a hard `window.location.href`
navigation straight to `/api/auth/do-join` — this cannot be
client-side intercepted without risky changes to that flow, so I
deliberately did not touch it. See "the fix" below for how the
question still reaches these users regardless.

**Treatment of existing users:** completely unaffected — see the
15-minute recency window below.

---

## THE FIX — architecture, and why

**Deliberately did not modify `SignupForm.tsx`, `JoinForm.tsx`, or
`LoginForm.tsx` at all** — per the explicit "do not redesign
authentication or destabilise the currently working signup flows"
instruction. Instead, added one additive, centralised gate in
`(app)/layout.tsx` — the single layout that already wraps every
authenticated route in this app, extending its existing profile query
(already fetching `full_name, avatar_url`) rather than adding a second
query.

**The gate fires only when both are true:**
1. `profiles.user_intent IS NULL` — never yet answered.
2. `profiles.created_at` is within the last 15 minutes.

This is what makes "reach every current and future signup path
(including one currently invite-only, and one currently unreachable)"
and "never disrupt existing users" both true simultaneously, from one
piece of code: any account older than 15 minutes is structurally
exempt forever, regardless of how it was created; any account signing
up right now — via password signup, via the invite-join flow, or via
magic link if it's ever restored — gets asked exactly once, the moment
they first land on any real page of the app. If someone closes the tab
before answering, the gate simply stops applying once the window
passes — never an indefinite nag on a later login.

`/onboarding/intent` is a standalone route, deliberately outside this
same layout group, so the redirect can never loop back onto itself.

**Item 4 — existing users' safe, optional path:** added a small
"How do you use Teein' It Up?" section to the existing Profile page
(`IntentSection.tsx`), extending that page's existing query by two
columns. Purely voluntary, always editable, never a gate. This is the
"safe way to progressively capture this later" the brief explicitly
asked for.

**One tap submits (Player), matching "do not turn signup into a long
survey":** the primary question has no Submit button — tapping
Player/Organiser/Both is the action. Organiser/Both reveals the
lightweight multi-select follow-up as a genuinely optional second
screen (a "Skip this bit" fallback if nothing's selected), since the
primary, valuable signal is already saved by that point.

---

## 5. DARREN EVENT REQUIREMENT

Satisfied by the gate's own design, not by special-casing the join
flow: a brand-new player who signs up through an invite link lands
somewhere inside the `(app)` route group the moment `do-join` finishes
(their new trip's Lobby, or a fallback), which is exactly where the
gate fires. They see the question before anything else, regardless of
which specific page `do-join` happened to redirect them to.

## 6/7. FUTURE PRODUCT USE / ADMIN-ANALYTICS READINESS

**Confirmed queryable now, without building a dashboard** (per the
explicit "do not build a large analytics dashboard unless... trivial"
instruction) — the exact question this update was built to answer:

```sql
-- "How many players from Darren's event identified as Organiser or Both?"
SELECT p.user_intent, COUNT(*)
FROM trip_members tm
JOIN profiles p ON p.id = tm.profile_id
WHERE tm.trip_id = '<darrens-trip-id>'
GROUP BY p.user_intent;
```

No new join table or stored linkage was needed — `trip_members`
already ties every player to the trip they joined through, and
`user_intent` lives on their own profile row. The two KPIs from your
message follow directly:

- **Organiser density** = `COUNT(user_intent IN ('organiser','both')) / COUNT(*)` for a given trip's `trip_members`.
- **Organiser activation** = of that cohort, what fraction later appear as `trips.organiser_id` on any trip — again, no new schema, just a second query against existing tables.

No recommendation system, no product-journey personalisation (Create
an Event vs. Social Golf steering) was built — per the explicit "do
not build... in this task" instruction, this round captures and
persists the signal correctly; using it to steer the product is future
work.

---

## FILES CHANGED

- `supabase/migrations/073_profile_user_intent.sql` (new)
- `src/app/(app)/layout.tsx` (the gate, extending the existing query)
- `src/app/onboarding/intent/page.tsx` (new)
- `src/app/onboarding/intent/IntentQuestionForm.tsx` (new)
- `src/app/api/me/intent/route.ts` (new)
- `src/lib/profile/userIntent.ts` (new, extracted validation)
- `src/lib/profile/userIntent.test.ts` (new, 7 tests)
- `src/components/profile/IntentSection.tsx` (new)
- `src/app/(app)/profile/page.tsx` (extended existing query, mounted `IntentSection`)
- `src/lib/analytics/trackEvent.ts` (added `onboarding_intent_captured`)

**Explicitly not touched:** `SignupForm.tsx`, `JoinForm.tsx`,
`LoginForm.tsx`, `do-join`, `/api/join`, `app_role`, any trip-level
role/permission logic.

## MIGRATIONS REQUIRED

`073_profile_user_intent.sql` — after the three already-pending
migrations (070, 071, 072), correctly numbered, none renumbered or
overwritten. **Not yet run against a live database.**

## FOCUSED TESTS ADDED

7 new tests (`userIntent.test.ts`) covering the one genuine piece of
branching logic in this feature: intent validation (rejects anything
outside the exact three values, explicitly including a case checking
it can never be confused with `app_role`'s own values) and
organiser-type sanitisation (unknown values dropped rather than
rejecting the whole request; "Other" confirmed as a genuine first-class
option; `player` always resolves the follow-up to `null` regardless of
what was sent). Wired into the real API route, not a disconnected
mirror.

## FULL TEST SUITE RESULT

**407/407 pass** — 274 pure-function scoring + 5 SQL-scanning + 59
highlights + 8 analytics + 7 new profile + 54 trips.

## REGRESSION PROTECTION — CONFIRMED BY INSPECTION

- Signup, magic link, password auth, invitation acceptance, event
  joining, player profile creation, handicap capture — zero code
  touched in any of these paths.
- Digital/Paper scoring, existing trip roles/permissions — zero code
  touched; `user_intent` has no foreign key or logic connection to
  `trip_members.role`, `trips.organiser_id`, or the shared-device
  architecture at all.

## WHAT STILL NEEDS REAL-DEVICE / LIVE-DATABASE VERIFICATION

1. Migration 073 has never run — apply it, then confirm a genuinely
   fresh signup (password, direct) is redirected to
   `/onboarding/intent` and returns to `/dashboard` after answering.
2. Confirm the invite-join path specifically: sign up via a fresh
   invite link, confirm the gate fires after `do-join` completes.
3. Confirm an **existing** account (created before this deploy, or
   simply more than 15 minutes old) is never redirected, on any page,
   ever — the core "no disruption" guarantee.
4. Confirm the Profile page's new section saves and reloads correctly.
5. Run the two example KPI queries above against real data once at
   least one real signup has gone through the new flow.

## RECOMMENDED PRODUCTION MIGRATION ORDER

1. `070_begin_round_writes_group_id.sql`
2. `071_fix_side_comp_verifier_group_scoping.sql`
3. `072_enable_rls_side_comps_pre_sprint9_backup.sql`
4. `073_profile_user_intent.sql`
