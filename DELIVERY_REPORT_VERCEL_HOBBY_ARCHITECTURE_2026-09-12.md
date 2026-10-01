# EVENT MEMORIES V1.1 -- VERCEL HOBBY ARCHITECTURE DECISION
## Report

**Methodology note, stated upfront:** the prior session's report on this
same question relied partly on general knowledge about Vercel limits,
which turned out to be meaningfully outdated. This time, every figure
below was verified directly against Vercel's own current documentation
via web search, not assumed from training data -- Vercel's limits have
genuinely changed (most importantly: Fluid Compute, which raises
Hobby's execution ceiling substantially, is now the platform's default,
not an opt-in feature from a 2025-era doc that no longer reflects
reality).

**Build/test caveat, unchanged from every prior round:** no network
access to this app's own infrastructure, no live database/Storage
connection, no way to npm install. Full test suite: **524/524 pass**
-- 291 pure-function scoring + 64 highlights + 8 analytics + 7 profile
+ 63 SQL-scanning migration tests + 91 trips.

---

## 1. CURRENT HOBBY CONSTRAINTS RELEVANT TO THIS WORKLOAD

Verified directly from Vercel's own documentation
(vercel.com/docs/functions/limitations, vercel.com/docs/fluid-compute,
and Vercel's own AI SDK troubleshooting guide,
ai-sdk.dev/docs/troubleshooting/timeout-on-vercel):

- Execution duration: Fluid Compute is now Vercel's default execution
  model across all plans, confirmed directly: "With Vercel's Fluid
  Compute, the default function duration is now 5 minutes (300
  seconds) across all plans... Hobby: Up to 300 seconds." A legacy,
  pre-Fluid-Compute regime also still exists for projects deployed
  before April 23, 2025 that have not moved to it (10s default / 60s
  maximum) -- but Fluid Compute is the current norm, not the
  exception, for an actively developed project.
- Memory: 2GB on Hobby (same as Pro/Enterprise's practical ceiling for
  this workload) -- not a binding constraint here, since streaming
  keeps memory use to roughly one photo at a time regardless.
- Response size: a non-streaming Function response is capped at 4.5MB
  on all plans -- far too small for a real export -- but Vercel's
  documentation confirms a streaming response is exempt from this cap,
  which is why the export route streams rather than buffers.
- Build-time validation: declaring maxDuration above what a project's
  actual regime permits causes a hard build failure, not a silent
  runtime cap -- confirmed from a real, documented case. This matters
  directly for item 8 below.

## 2. IS DIRECT STREAMING SAFE FOR 100+ PHOTOS?

Yes, with meaningful margin, based on the confirmed numbers above. At
the already-confirmed photo size (~200-500KB after client-side
resizing) and batched downloads (6 concurrent at a time, already
implemented), the real bottleneck is Storage network I/O, not CPU or
memory. A 100-150 photo export completing well within a 300-second
window is a reasonable, defensible expectation from these numbers --
though this remains reasoned from documented limits and measured photo
size, not an empirical load test (see item 8's honesty note).

## 3. RECOMMENDED ARCHITECTURE

Unchanged from the existing implementation: direct, streaming ZIP
generation within a single Vercel Function request, using archiver
piped through a TransformStream, with maxDuration raised to 300 (see
item 8) and batched Storage downloads already in place.

## 4. WHY THIS IS THE SIMPLEST RELIABLE OPTION

Per the brief's own explicit preference against unnecessary
complexity: this requires no new infrastructure component at all --
no job queue, no temporary Storage staging area, no polling endpoint.
It is also the architecture already built and tested going into this
session, which this new research now confirms is appropriately sized
for the confirmed constraints, rather than requiring a different
approach.

## 5. SUPABASE STORAGE CHANGES REQUIRED

None. The existing event-moments bucket and the existing .download()
access pattern (already used, confirmed read-only by a dedicated test
from the prior session) are sufficient -- no new bucket, no new
storage policy, no staging path.

## 6. EXPECTED USER EXPERIENCE WHILE THE PACKAGE IS BEING PREPARED

The organiser taps "Export Memories," chooses a scope, and the browser
begins downloading a file immediately as the server starts streaming
it -- there is no separate "preparing..." waiting screen or polling
step, since the response starts the moment the stream exists, before
the archive is complete. The existing UI's "Preparing export…" button
label covers the brief window between tapping the button and the
browser's own download indicator taking over. This matches the
brief's own "infrastructure should be invisible to the organiser"
requirement without needing to build a separate progress-reporting
mechanism.

## 7. COST/PLAN IMPLICATIONS

None identified that would require a plan change. Fluid Compute's
300-second ceiling is available on Hobby at no cost -- it is not a
Pro-tier feature. Execution time for an export (expected well under
300s per the reasoning in item 2) consumes Hobby's standard,
free-tier GB-hours allocation like any other function call; nothing
about this workload appears to approach Hobby's monthly GB-hour
ceiling based on realistic event-export frequency (an organiser
exporting once or a few times per event, not a high-frequency
operation). If a genuinely much larger event (300+ photos, well beyond
the brief's own stated scale target) is encountered in practice and
the 300s ceiling is reached, the brief's own recommended fallback
(staging the export outside the request lifecycle with a signed
download once ready) remains the documented next step -- not something
requiring a plan upgrade, since Hobby's Storage/Function primitives
are themselves sufficient for that architecture too.

## 8. IMPLEMENTATION PROCEEDED, SINCE THE ARCHITECTURE IS CONFIRMED SAFE

Per the brief's own "only then proceed" instruction: the architecture
is clearly safe based on the confirmed, current Vercel documentation
above, so one change was made to the already-existing export route --
maxDuration raised from the prior session's deliberately conservative
60 (chosen specifically because the regime was then unconfirmed) to
300, the confirmed Fluid Compute ceiling on Hobby. This is a safe
change to attempt even in the unlikely case the project turns out to
still be on the legacy regime: Vercel's own build-time validation
would reject an invalid value outright with a clear, loud deploy
error (confirmed in item 1), never a silent, dangerous runtime
surprise -- so this is verifiable at deploy time, not something that
could fail quietly in production. One existing test (from the prior
session, checking for the old conservative value) was updated to
match, and one new file-level comment was rewritten to document the
now-resolved reasoning, in place of the prior "two possible regimes,
can't determine which" uncertainty.

Stated plainly, not glossed over: this remains reasoned from
documented limits and the already-confirmed per-photo size, not an
empirical load test against a real 100+ photo event on the actual
deployed project. That test is still the real, final confirmation --
recommended as the next concrete step before relying on this for
Darren's trip.

---

## FILES CHANGED

- `src/app/api/trips/[tripId]/export/route.ts` (maxDuration 60 -> 300, file-level comment rewritten to reflect the now-confirmed Fluid Compute regime)
- `src/lib/scoring/eventMemoriesExportV1_1.test.ts` (one test updated to check for 300, matching the new confirmed value)

## MIGRATIONS

None.

## TESTS

**524/524 pass** -- 291 pure-function scoring + 64 highlights + 8
analytics + 7 profile + 63 SQL-scanning migration tests + 91 trips.
Confirmed via a fresh, complete run this session, including the one
test updated to match the maxDuration change.

## STILL REQUIRING LIVE VALIDATION

1. A real export of a genuinely large (100+ photo) event on the
   actual deployed project -- the single most important remaining
   step, and the one piece of this whole architecture decision that
   cannot be confirmed from documentation alone.
2. Confirm the deploy itself succeeds with maxDuration = 300 (the
   build-time check described in item 1/8 is the mechanism that would
   surface a problem immediately, if there is one).
3. Everything listed as outstanding in the prior Phase 2 report
   (archiver actually installing, the full Export All/Favourites/
   Round/Selected workflow on a real device) remains outstanding --
   this session's work is scoped specifically to the duration
   question the brief asked about.
