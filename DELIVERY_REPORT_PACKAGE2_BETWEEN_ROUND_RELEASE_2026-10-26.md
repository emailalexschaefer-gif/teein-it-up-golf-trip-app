# Package 2 — Between-Round Management, Handicap Release & Player Notifications (26 Oct 2026)

**Baseline:** the Package 1 final-fixes release (`release-share` + Package 1, 1428 tests). Package 3 and migration 100 are **not** merged. **Nothing is deployed and no migration has been applied anywhere.** This needs **one new additive migration, 101** (proposed below).

## 1. Audit: what already existed
| Area | Found | Gap |
|---|---|---|
| Per-round release | `rounds.setup_released` (mig 062), a Confirm & Release route, a player Starting Grid | Release only flipped a flag. Nothing was recorded about *what* was released. |
| Per-round tee times / starting holes | `round_group_tee_times`, `round_group_starting_holes` | Live tables: editable after release, with no notice to players. |
| Group membership | `trip_members.group_id` (live, event-wide) | Same: no snapshot. |
| Handicap overrides | `handicapOverrides` **React state** in the Begin Round window | Never saved before Start Round. |
| Round scorecard handicap | `scorecards.playing_handicap`, written at Start | Computed from whatever the window sent. |
| Notifications | `event_messages` (persistent, RLS-scoped announcements, shown in Event Chat) | Nothing posted on release; no in-lobby surface. No push infrastructure exists (no subscriptions or server push), so push was not built. |

## 2. Root cause of the Lappen problems (four causes, all confirmed in the code)
1. **Handicaps were never saved.** Darren's allocations lived only in the Begin Round window. Pressing Start Round the next day from a fresh window recomputed every handicap from the profile, so his allocations were lost.
2. **Players were shown the wrong handicap.** The Starting Grid displayed each player's *profile* handicap (`HCP 18`), never the round handicap Darren set.
3. **Round 2 never appeared in the lobby.** Between rounds the lobby focuses the round just completed (deliberately, to keep the results visible), and the grid was gated on *that* round's release flag, so a released Round 2 was invisible.
4. **No snapshot, no re-release, no notice.** Later edits silently changed what players saw, and nobody was told.

## 3. What was built (smallest safe change; existing screens reused)
- **Migration 101 (proposed, additive):** `round_arrangements` — one authoritative snapshot per round and player (group, tee time, starting hole, **playing handicap**); `round_release_log` audit trail; `rounds.release_revision` / `released_at`; and `release_round_arrangements()`, a single transaction that locks the round, rejects stale or duplicate requests, writes the snapshot, logs it and records the Event Chat message(s). All or nothing. No write policies; the function is executable by the service role only.
- **Confirm & Release** now stores the organiser's exact allocations. It still never starts the round, creates scorecards, or touches profile or event handicaps. Repeating it with nothing changed does nothing and sends nothing.
- **Re-release:** reopen Begin Round → edit groups / tee times / holes / handicaps → "Confirm & Re-release". The window shows the *released* handicaps on reopening, a state line ("Released to Players (version 2) — 1 player with changes not yet released"), and blocks Start Round while there are unreleased changes.
- **Start Round:** for released rounds it uses the snapshot handicaps exactly (the browser's values are ignored) and refuses to start if groups/tee times/holes no longer match what players were shown. Never-released rounds behave as before. The duplicated handicap calculation was replaced by one shared function.
- **Player lobby:** "Round 2 — Your Arrangements Are Ready" card: course, date, your group, tee time, starting hole, **playing handicap**, partners, "Released · Awaiting start", and an "Updated" badge after a re-release. It refreshes on return to the app and every 30 s; no reinstall or rejoin needed. Round 1's results stay below. Score entry is unchanged: scorecards only exist after Start Round.
- **Notifications:** first release → one event-wide announcement in Event Chat with your wording (round name inserted). Re-release → a short message **only to affected players** (own group, tee time, hole, handicap, or partners changed). Persistent, so offline players see it on return. No duplicate on refresh or repeat release.
- **My HQ at a glance:** the round card shows "Released to players — not started / Not released yet", the button reads "Review, Re-release or Start", and the schedule pill reads RELEASED.

## 4. Migration 101: prerequisites and compatibility
Prerequisites: 062 (setup_released), 025 (event_messages), 097 (cancelled status). Independent of migration 100: apply in either order. Additive only; re-runnable (applied twice in a scratch database with no errors); rollback is documented at the top of the file. Migrations 097–099 are not touched. **Apply 101 before deploying this build.** Without it, release returns a clear "needs migration 101" message rather than half-working, and Start Round and everything else keep working as before.

## 5. Verification
**Sandbox-verified:**
- Full regression suite **1446 pass / 0 fail** (1428 before + 18 new).
- `release_round_arrangements()` run on real **PostgreSQL 16**: 9 scenarios pass — initial release, duplicate/racing release rejected, re-release with targeted notifications and audit, completed round untouched, only upcoming rounds release, organiser-only (player and other-event organiser refused), cross-event rows refused with nothing written, handicap range enforced, withdrawn player removed. Test file: `supabase/tests/101_release_round_arrangements.test.sql`.
- Live-setup loader against a fake database: Lappen-style allocation vs profile, round-specific tee times, back-nine and shotgun starts, readiness blockers, event scoping, release → profile change → start staying consistent.
- Phone-size browser preview of the lobby card: correct values, no horizontal scroll, re-release updates it with an "Updated" badge, a reload keeps the allocation, no profile handicap shown.
- Source checks that release never starts a round or writes scorecards, that Start enforces the snapshot, and that the player endpoint is event-scoped.

**Not verified (needs your phone / a real database):**
- The new routes against real Supabase (only the SQL function and the logic around it were run). `next build` / `next lint` cannot run here.
- The Begin Round window and organiser round card rendering (changed, type-checked, pinned by source tests, but not opened in a browser).
- Scenarios 15 (shared-device and paper players) and 17 (9/18-hole behaviour): the snapshot covers every member regardless of scoring method and Start's paper/digital handling is unchanged, but there is no new test for them.
- Phone push: not built (no infrastructure exists).

**Judgement calls to confirm:**
- ~~I set a -10 to 60 range for allocations.~~ **WITHDRAWN (26 Oct, later): that was not an approved product rule and has been removed. See DELIVERY_REPORT_PACKAGE2_FINAL_CORRECTIONS_2026-10-26.md.**
- The Event Chat entry is text; "link directly" is delivered by the lobby card showing at the top of the lobby, not a tappable link inside the chat message.

## 6. Deployment (only when you approve)
1. Apply `supabase/migrations/101_round_arrangements_release.sql` in the Supabase SQL editor (production backup first, as usual).
2. Deploy this ZIP over the Package 1 final-fixes release. No new environment variables.
3. Rounds already released before this deploy have no snapshot: they keep working as before; press Confirm & Re-release once to take a snapshot.

## 7. Phone test checklist (organiser + one player phone)
1. Finish Round 1, open Round 2 → Begin Round. Assign groups, tee times; change one player's handicap with +/−.
2. Confirm & Release. The round card says "Released to players — not started". The player's Round 2 is still unscorable.
3. Player phone: the lobby shows the Round 2 card with the correct group, partners, tee time, hole and **your allocated handicap** (not the profile one). Event Chat shows the announcement once.
4. Pull to refresh / log in on another device: same handicap.
5. Move a player and change a handicap, press Start Round: it refuses and asks for a re-release. Re-release: only affected players get a message and an "Updated" badge.
6. Press Start Round: scorecards open with the released handicaps; Round 1 results unchanged.
