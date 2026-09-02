# DARREN-READY ACCEPTANCE PASS — CONSOLIDATED CHECKLIST
## 2 Sep 2026

One document, one pass. Nothing below requires further code changes —
this is execution only. If everything here is clean, this build is
Darren-ready.

---

## STEP 1 — DEPLOY

- [ ] Deploy the application build that includes the onboarding-intent
      work (this session's final delivery).

## STEP 2 — MIGRATIONS, IN THIS EXACT ORDER

- [ ] `070_begin_round_writes_group_id.sql`
- [ ] `071_fix_side_comp_verifier_group_scoping.sql`
- [ ] `072_enable_rls_side_comps_pre_sprint9_backup.sql`
- [ ] `073_profile_user_intent.sql`

## STEP 3 — SECURITY CHECK

- [ ] Confirm the Supabase security advisor's `rls_disabled_in_public`
      warning has cleared after 072.

## STEP 4 — FRESH TEST DATA (non-negotiable)

- [ ] Create a **brand-new** event/round for this pass. **Do not reuse
      any round started before migration 070** — `scorecards.group_id`
      is a one-time snapshot taken at `begin_round()`; an old round's
      scorecards will never retroactively gain it, which would produce
      a false failure on the Group Makers & Breakers and shared-device
      verifier checks below, not a real one.

---

## STEP 5 — ONBOARDING CHECKS (run first, before the main test)

- [ ] **Brand-new signup** — a genuinely new account is asked "How do
      you see yourself using Teein' It Up?" (Player / Organiser / Both)
      before reaching anywhere else in the app, and the choice
      persists (visible on Profile afterward).
- [ ] **Existing account** — sign in with an account that already
      existed before this deploy. Confirm it goes straight into the
      app with **no onboarding gate at all**. This is the "no
      disruption" guarantee — if this fails, stop and report it before
      continuing.
- [ ] **Organiser or Both selected** — confirm the "What kind of golf
      do you organise?" multi-select follow-up appears, and that the
      selections persist (visible on Profile afterward, editable
      there).
- [ ] **New user → join → score** — the same brand-new account then
      joins the fresh test event via invite link and proceeds into
      live scoring normally. This is the specific check that migration
      073 hasn't regressed the invitation/join flow.

---

## STEP 6 — SIX-PLAYER / THREE-GROUP ACCEPTANCE TEST

**Setup**
- [ ] 6 players, 3 groups. Group 1: Digital + Digital. Group 2:
      Digital + Paper. Group 3: Digital + Paper (or another Digital
      pairing).
- [ ] Multi-round if practical.

**Pre-round**
- [ ] Players assigned correctly, Paper/Digital status correct
- [ ] Group names unique
- [ ] Tee times set in Group Setup appear correctly in Finalize Round
      **without** a manual round-specific override
- [ ] Starting holes correct, Finalize/Release works

**Start scoring**
- [ ] Digital players see their own + Paper partner's card
      immediately, no Paper login, **survives a 15+ second wait**
      (this is the specific test of the polling fix)

**Scoring**
- [ ] Own + Paper score entry, hole navigation, refresh, both a Hole 1
      and a Hole 10/back-nine start group

**Side Games**
- [ ] Digital claim, Paper claim on shared device, all four
      verification directions
- [ ] **Cross-group leader replacement** — Group 1 or 3 beats a Group
      2 result; confirm no stranded "Awaiting Playing Partner
      verification" claim in either group (the specific scenario
      migration 071 fixes)
- [ ] Correct competitor identity shown throughout (a Digital player
      entering a result for their Paper partner shows the Paper
      player's name, not the Digital player's)
- [ ] Photo + verified leader produces **one** combined Moment,
      including a claim → navigate away → come back → take photo
      sequence specifically (the exact scenario the Moment-linkage fix
      targets)

**Round Complete**
- [ ] Every scorecard completes, Paper scores count, leaderboard
      correct
- [ ] **Individual AND Group Makers/Breakers both appear** (only valid
      on this fresh round, per Step 4)

**Post-round / My Event Stories**
- [ ] Presentation renders cleanly, no duplicate Side Game stories
- [ ] Event Winner appears first (only when earned), then Side Game
      Wins, then Badges, in that order

**Multi-round, if run**
- [ ] Repeat Side Game verification in Round 2; confirm no Round 1
      verifier/group/claim state leaks into Round 2

---

## IF THIS ENTIRE PASS IS CLEAN

This build is Darren-ready. No further functionality changes before
the live rehearsal unless this pass exposes an actual blocker.

## IF SOMETHING FAILS

Note exactly which checklist item, and what you actually saw. That's
the one thing this whole pass can produce that a sandbox can't — a
real, reproducible data point to trace from, rather than another round
of static analysis.
