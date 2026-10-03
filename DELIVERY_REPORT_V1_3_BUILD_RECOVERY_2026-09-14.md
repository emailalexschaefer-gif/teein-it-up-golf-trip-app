# V1.3 DEPLOYMENT RECOVERY -- BUILD FAILURE
## Report

The hard gate in your brief -- "don't package another deployment
until npm run build genuinely succeeds" -- is NOT satisfied by this
report, and I want to say that plainly before anything else. This
sandbox has no node_modules and no network access to install
dependencies. I cannot literally run npm run build here, which means
I cannot prove success the way you've asked me to. What follows is my
strongest, evidence-based diagnosis and the smallest fix for it -- not
a substitute for the real proof, which only running the actual build
can provide.

---

## 1. WHAT I RULED OUT, AND WHY (addressing your item 3)

Checked directly, not assumed: .eslintrc.json is
{"extends": ["next/core-web-vitals", "next/typescript"]} -- the
unmodified Next.js defaults, no custom rule severities, no
max-warnings flag anywhere in package.json's build script (it's
plain "next build"). Next.js's own default behaviour is to fail a
build on ESLint errors, not warnings. Nothing in this config
overrides that. The seven warnings you listed (<img> usage,
unused variables) are all warning-level rules under these defaults.
I'm confident these are not the root cause -- not because I ran
the build and watched them not matter, but because the configuration
that would need to exist to make them fatal simply isn't present
anywhere in this repository.

## 2. MY STRONGEST HYPOTHESIS, AND THE EVIDENCE FOR IT

The V1.3 session before this one set export const maxDuration = 300
in the new export route, based on research suggesting Vercel's Fluid
Compute (which permits 300s on Hobby) is now the platform default. At
the time, I flagged this explicitly as carrying a real, specific risk:
Vercel rejects an invalid maxDuration at build time if it exceeds
what the project's actual regime allows -- this is a Next.js route-
config validation, separate from ESLint and from TypeScript type-
checking (so typescript.ignoreBuildErrors: true, already set in this
project's next.config.js, would not suppress it). This also matches
your own observation: a build-time route validation of this kind
typically surfaces during a later phase of the build (page/route
collection) than the lint pass that produced the warnings you saw --
consistent with "something else may be immediately above this
section."

This is a hypothesis, not a confirmed fact -- I have not seen the
actual failing line in your build log. But it is the one change in
the entire V1.3 delivery that (a) is a genuine build-time check, not
just a style warning, (b) was explicitly flagged as this exact risk
when it was made, and (c) was made on an assumption (which Vercel
regime this project is on) that could not be verified from this
sandbox and still can't be.

## 3. THE FIX APPLIED

Reverted maxDuration from 300 back to 60 in
src/app/api/trips/[tripId]/export/route.ts -- the value explicitly
chosen in the prior session specifically because it's valid under
both possible Vercel regimes (the legacy ceiling is 60s maximum; 60
is also comfortably under Fluid Compute's 300s ceiling if that does
apply). This is the smallest possible change: one number, reverted to
what it was before the unconfirmed increase, with no other logic
touched. Updated the file's own comments and one matching test
assertion to reflect this, and nothing else.

No other change was made. No <img> tags were touched. No unused
variables were removed. Per your explicit instruction, nothing from
the later slideshow ideas (opening card, group-photo prompt, landscape
redesign) was added.

## 4. WHAT I CANNOT CONFIRM

- I cannot prove npm run build now exits 0. This is the central
  ask and I cannot deliver it from this environment.
- If this hypothesis is wrong, the real blocker is still in the
  log, and reverting maxDuration will not fix it -- the build will
  fail again, just as before.
- The seven warned files were not modified and were not re-examined
  for a different fatal issue beyond what you already described as
  "just warnings" -- I'm trusting your own read of those (and the
  absence of any warning-as-error config) rather than re-deriving it.

## 5. WHAT WOULD SETTLE THIS DEFINITIVELY

Please run npm run build locally or trigger a fresh Vercel deploy
with this one-line change applied.
- If it succeeds: this was very likely genuinely the cause, and
  that's the proof the hard gate needs -- at that point I'd want the
  full test suite re-run in a real Node environment too (not just this
  sandbox's syntax/logic-only checks) before calling V1.3 actually
  ready.
- If it still fails: please send the 30-50 lines of log you
  offered, specifically whatever appears immediately before the first
  warning block. I was not able to generate or inspect that log myself
  -- I need the real one to go further than a hypothesis.

## FILES CHANGED

- `src/app/api/trips/[tripId]/export/route.ts` (maxDuration 300 -> 60; comments corrected to match)
- `src/lib/scoring/eventMemoriesExportV1_1.test.ts` (one assertion updated to match the reverted value)

## TEST SUITE RESULT

576/576 pass -- 291 pure-function scoring + 64 highlights + 8
analytics + 7 profile + 63 SQL-scanning migration tests + 143 trips.
Identical count to the prior session, since this change touched a
runtime config value and its matching assertion, not any tested logic.
This confirms no regression in what these tests can see -- it does
not confirm the production build succeeds, which is the actual
open question here.
