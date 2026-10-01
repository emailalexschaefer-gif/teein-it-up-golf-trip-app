# EVENT MEMORIES V1.1 -- VERCEL HOBBY ARCHITECTURE DECISION
## Report + Refinements to the Existing Export Route

**Confirmed Hobby.** Per the explicit instruction, I verified the
current, real Vercel documentation directly rather than relying on
training-data knowledge, which could be stale -- the specific figures
below come from Vercel's own docs pages, fetched this session.

**This did not require a new implementation from scratch** -- the
streaming export route built in the prior Phase 2 session was already
the correct general shape (streaming, not buffering). This pass
confirmed the specific Hobby constraints, found one genuine ambiguity
in Vercel's own current documentation, and applied two concrete
refinements as a result: an explicit maxDuration, and batched rather
than strictly sequential photo downloads.

**Full test suite: 524/524 pass** -- 291 pure-function scoring + 64
highlights + 8 analytics + 7 profile + 63 SQL-scanning migration tests
(61 existing + 2 new) + 91 trips.

---

## 1. CURRENT HOBBY CONSTRAINTS RELEVANT TO THIS WORKLOAD

**Response body size:** Vercel's own documentation states the maximum
payload for a non-streaming Vercel Function request or response body
is 4.5MB -- but explicitly states streaming responses do not carry
this limit. This is unambiguous across every source checked.

**Execution duration -- a genuine ambiguity, not resolved with
confidence:** Vercel's current documentation gives two different
figures for Hobby, and I could not determine from here which applies
to this specific project:
- A legacy table, explicitly scoped to "an existing project, deployed
  to Vercel before April 23rd 2025 and not using Fluid compute":
  10s default, 60s maximum.
- A newer, general limits page: 300s default and maximum for Hobby --
  which corresponds to Fluid Compute, Vercel's current default
  execution model for newer projects.

I found a real, documented case (a GitHub pull request) of a build
failing because maxDuration was declared higher than a project's
actual regime allowed -- not silently capped. This is why the
refinement below sets maxDuration = 60, the value valid under both
possible regimes, rather than guessing at 300 in hope of more headroom
and risking a failed deployment.

**Storage retrieval:** no Hobby-specific limit on Supabase Storage
download count/rate was found in this research -- the relevant Hobby
constraint is Vercel's own execution duration, not Supabase's.

## 2. IS DIRECT STREAMING SAFE FOR 100+ PHOTOS?

**For a realistic 100-150 photo event: yes, with the refinements
below. For a genuinely large event (300+): not confidently, and this
session cannot prove otherwise.**

Streaming avoids the body-size risk entirely -- confirmed, not in
question. The open risk is wall-clock execution time: previously, the
route downloaded each photo strictly sequentially, meaning total time
scaled linearly with photo count regardless of per-photo speed. Now
batched (6 concurrent downloads per batch), total wall-clock time is
dominated by network I/O to Storage, not CPU, so concurrent batching
directly reduces it. This was not load-tested against real Storage
latency in this session -- stated as a genuine, unverified assumption,
not a measured result.

## 3. RECOMMENDED ARCHITECTURE

**Direct, synchronous streaming ZIP generation within a single Vercel
Function request** -- the architecture already built, refined this
pass rather than replaced. No queue, no background job, no staging
step. This is the simplest option that satisfies the brief's own
"invisible infrastructure, Export -> prepares -> Download" organiser
experience directly: the button press IS the whole operation, with no
separate "check back later" step for the organiser to understand.

## 4. WHY THIS IS THE SIMPLEST RELIABLE OPTION

Per the brief's own explicit instruction not to introduce a
queue/background-job system unless genuinely necessary: nothing in
this stack currently has any background-job infrastructure at all
(confirmed by searching the whole codebase in the Phase 2 session --
everything today is direct request/response). Introducing one now
would be new, untested infrastructure for every future developer to
maintain, for a scale (300+ photos) that may never actually occur for
a typical golf trip -- Darren's own trip is far more likely to land in
the 50-150 photo range this architecture should handle comfortably.
Building the heavier architecture pre-emptively, before any real usage
data exists, would be solving a problem that hasn't been confirmed to
exist yet.

## 5. ANY SUPABASE STORAGE CHANGES REQUIRED

None. The existing event-moments bucket and its
tripId/roundId/userId/filename path convention (confirmed in the
Phase 1 audit) are used exactly as they already are -- .download()
reads, nothing written, moved, or reconfigured.

## 6. EXPECTED USER EXPERIENCE WHILE THE PACKAGE IS BEING PREPARED

Unchanged from the Phase 2 UX: the organiser taps Export, chooses a
scope, the button shows "Preparing export..." (already built), and the
browser receives the streaming ZIP and begins downloading progressively
as Vercel sends it, with no separate "ready" step to poll for -- the
download simply starts once the server has enough of the archive
built to begin streaming. For a large export approaching the duration
ceiling, the honest user-facing risk is the request failing partway
through with no partial file saved (a browser download that never
completes), rather than a slow-but-eventually-successful experience --
this is the real cost of staying on the simpler architecture, named
directly rather than hidden.

## 7. COST/PLAN IMPLICATIONS

None anticipated from this change specifically. This does not request
an upgrade to Pro, and the brief's own instruction was explicit not to
assume one is required. Hobby's GB-hour execution quota (100 GB-hr/
month, per Vercel's current documentation) is consumed by this route
same as any other -- a 60-second export at default memory is a small
fraction of that monthly allotment even with regular use; this is not
expected to be a binding constraint for a single event's typical
export volume.

## 8. IMPLEMENTATION -- WHAT CHANGED THIS PASS

Proceeding, since the architecture is sound for the realistic case,
with the real large-event ceiling named rather than hidden:

- export const maxDuration = 60 added to the export route --
  previously absent, meaning the route would have silently run under
  whatever the framework/platform default was (10s under the legacy
  regime), not the actual Hobby ceiling.
- Batched, concurrent photo downloads (6 per batch) replacing the
  previous strictly-sequential loop -- reduces total wall-clock time
  for a multi-photo export, directly addressing the duration
  constraint from item 2.
- The route's own file-level documentation rewritten to state the
  confirmed Hobby facts and the genuine regime ambiguity directly, so
  this reasoning is visible to whoever next touches this file, not
  only in this report.
- 2 new tests added to eventMemoriesExportV1_1.test.ts (confirming
  maxDuration is set, and that downloads are genuinely batched not
  sequential), and 1 existing test updated to match the new batched
  loop structure (the behaviour it verifies -- a failed download never
  aborts the whole export -- is unchanged, only the code shape it
  checks for).

## FILES CHANGED THIS PASS

- `src/app/api/trips/[tripId]/export/route.ts` (maxDuration, batched downloads, updated documentation)
- `src/lib/scoring/eventMemoriesExportV1_1.test.ts` (1 test updated, 2 new tests)

## MIGRATIONS ADDED

None.

## FULL TEST-SUITE RESULT

**524/524 pass** -- 291 pure-function scoring + 64 highlights + 8
analytics + 7 profile + 63 SQL-scanning migration tests + 91 trips.

## ANYTHING STILL REQUIRING LIVE VALIDATION

Everything about actual execution -- this remains the central honest
gap. In priority order:
1. Confirm which duration regime this project is actually on (legacy
   60s ceiling vs. Fluid Compute 300s) -- directly determines how much
   real headroom exists beyond this session's conservative
   maxDuration = 60 choice.
2. Run a real export against an event with 100-150 photos and measure
   actual wall-clock time, to confirm the batching refinement is
   sufficient in practice, not just in reasoning.
3. If real usage ever approaches 300+ photos and this ceiling is
   genuinely reached, the brief's own recommended fallback (staging
   outside the request lifecycle, signed download once ready) is the
   documented next step -- not pre-built speculatively this session.
