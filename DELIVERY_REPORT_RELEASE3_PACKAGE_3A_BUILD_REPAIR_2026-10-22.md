# Teein' It Up — Release 3A Build-Repair Patch

**Date:** 22 Oct 2026 · **Status:** packaged for redeployment, **not deployed**. **Still not build-verified** (see caveats).

## Cause
Vercel failed `npm run build` on ESLint `@typescript-eslint/no-explicit-any` in `src/lib/trips/tripLayoutData.test.ts` (4 errors, lines 45, 48, 49, 50 of the shipped file). My test used `: any` annotations, and my earlier lint approximation wrongly treated a single `eslint-disable-next-line` (which only covers the line directly beneath it) as covering the whole block. That was my check's blind spot, and I should have caught it.

## Fix (no rules disabled, no checks bypassed)
- `src/lib/trips/tripLayoutData.ts` — the loader no longer takes an untyped Supabase client. It takes four **typed fetcher callbacks** (`getUser`, `getMembership`, `getPractice`, `getActiveRound`) with explicit result types. Timeouts, fallbacks, ordering (user first, then the three lookups together) are unchanged. The two `any` types and their disable comments are removed.
- `src/app/(app)/trips/[tripId]/layout.tsx` — builds the four fetchers from the real Supabase client (the same four queries as before) and passes them in. Behaviour identical; the performance change (3 lookups in parallel after the user check) is preserved.
- `src/lib/trips/tripLayoutData.test.ts` — rewritten with typed fakes; no `any`, no disable comments. Same 9 tests, same coverage (including the equivalence check against the legacy sequential logic for every outcome combination).
- `src/lib/perf/harness/runRoute.ts` — removed two further `any` usages (and their disable comments) in the test harness: `globalThis`/`Date` stub now typed (`unknown` + `DateConstructor`).
- `src/lib/perf/harness/fakeDb.ts` — removed two unused underscore-prefixed parameters that the typescript-eslint default would flag.

## Exact files changed in this patch (5)
1. `src/lib/trips/tripLayoutData.ts`
2. `src/lib/trips/tripLayoutData.test.ts`
3. `src/app/(app)/trips/[tripId]/layout.tsx`
4. `src/lib/perf/harness/runRoute.ts`
5. `src/lib/perf/harness/fakeDb.ts`

Nothing else changed. No scoring, reconciliation, offline sync, route logic, polling or other functionality was touched. All other 3A optimisations are untouched.

## Whole-package lint sweep
I wrote a stricter checker (TypeScript compiler API) and ran it over **all 25 files** 3A modified or added: explicit `any`, unused locals/imports/params/catch bindings (including underscore-prefixed ones, which the typescript-eslint default flags), `let` that should be `const`, `{}` types, `Function` type, `require`, namespaces, `@ts-ignore`, unused expressions, and any `eslint-disable`.
- No remaining `any` or unused-variable issues in code I wrote.
- The only remaining hits are **pre-existing, unchanged code that already built in Phase A**: `admin: any` with its disable comment in `my-scores` and `tournament`, `_req` route parameters, used catch bindings, and existing disable comments in `SideGamesClient.tsx` and `PendingVerificationCard.tsx` (counts identical to the Phase A baseline), plus the `'use client'` directive (a false positive of my checker).
- React-hooks rules check and syntax check clean.

## Test results
- Full suite: **1196 / 1196 pass** (working tree and fresh extract of the ZIP).
- Strict TypeScript check on the changed pure modules and their tests: 0 diagnostics.

## Remaining build caveats (honest)
- **I still cannot run the real `next lint`, `tsc` or `next build`.** The registry is unreachable from this sandbox (DNS fails) and the real `typescript-eslint` plugin and `eslint-config-next` are not installed anywhere here (only a bare ESLint without the TypeScript parser). So this remains **not build-verified**; my stricter checker is an approximation of the rules, not the rules themselves. The Vercel build is still the real gate.
- If it fails again, please paste the log and I will fix it the same way.
- Process improvement: the stricter checker above is what I will use going forward, rather than the earlier approximation.
