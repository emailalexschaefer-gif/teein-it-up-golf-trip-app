# Share button + live link fix — findings and test report (2026-10-25)

Not deployed. No migration applied. Separate from Package 3 (built on v3).

## Findings
1. **Why the popup said "Your organiser hasn't turned on the public link yet."** That text renders only when the status API returns `isOrganiser: false`. Organiser identity is `trip_members.role = 'organiser'` for that event. So the signed-in account is not the organiser of that event in the database (most likely Darren created it and you joined as a player). I cannot see your database, so this is inferred from the code path, not confirmed.
2. **Activation lives** in the Share popup, organiser only (POST requires role organiser + `acknowledge: true`; players get 403). Unchanged.
3. **Real bug found and fixed:** `getActiveLink` discarded the Supabase error, so a missing `shared_leaderboards` table (migration 098 not applied) or any DB error looked like "no link", and players were told the organiser hadn't enabled it. Now it throws `ShareUnavailableError` (kind `migration` | `database`); GET/POST return `unavailable` with a clear message (organiser: migration 098 not applied; player: not available right now, PNG/PDF still work). The UI shows it as a red alert. The button only hides for 401/403/404.

## UI changes
- Header button label is now **Share** (gold, dark green text, three-circle icon, compact).
- Organiser, sharing off: Share → Enable Live Link → consent checkbox → Activate Live Link (disabled until ticked).
- Sharing on: Copy Live Link / Share… (organiser also has Turn off public link); PNG/PDF always present.
- Player, sharing off: "Only {organiser name} can enable it", PNG/PDF kept; no activation control.
- Players can copy/share the link once it exists.

## Tests
- Full suite: 1354 pass / 0 fail (v3 baseline 1351 + 3 new). Lint-style check on changed files: clean. Type check on changed files: 0 diagnostics.
- New tests: lookup error throws vs genuine no-link returns null; enable with missing table → 503 / `ShareUnavailableError`; organiser-only activation, organiser name, player wording, unavailable branch.
- Existing tests still cover token security, `resolveToken` (unauthenticated `/l/{token}` open) and revocation.
- Preview screenshots (Chromium, 390px mobile, stubbed API): player-off, player-on, organiser step 1/2, unavailable, header button.

## Not verified here
Real Supabase, whether migration 098 is applied in production, Samsung device, clipboard copy and native share sheet (device features), real fonts.
