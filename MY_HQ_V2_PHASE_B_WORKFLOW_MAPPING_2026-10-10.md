# TEEIN' IT UP — MY HQ V2, PHASE B
## Proposed five-stage workflow derivation — for approval before Phase C (layout refactor)

**10 Oct 2026.** Per the Implementation Gate, this is the state mapping
to approve before I touch the actual page layout. Still no UI changes
in this pass — this is the derivation logic only, as a pure function
design, plus the exact fix for the Stage 4 gap per your Option-1
instructions.

## Stage 4 fix, exact design (per your refinements)

No migration. `published_round_highlights` already has everything
needed — the fix is entirely in when a row gets written and how two
existing call sites read it.

- **No row** → not reviewed.
- **Row, `highlights` non-empty** → reviewed, saved selections.
- **Row, `highlights: []`** → reviewed, intentionally selected nothing.

**Write side:** the existing `POST /published-highlights` route
already upserts correctly and already accepts an empty array (capped
at 12 items, no minimum) — no route change needed there. What's
missing is a UI action that calls it with `[]` on purpose. The
existing `MakersBreakers` component (opened from My HQ's Stage 4
button) gets one addition: an explicit **"Finish Review"** action
alongside its existing save — if the organiser has picked items,
Finish Review saves exactly what they picked (identical to today's
save, so this never touches the "avoid overwriting previously saved
selections" risk); if they've picked nothing (including the genuine
no-candidates empty state), Finish Review/"Skip" POSTs `highlights: []`
explicitly. **Merely opening the screen writes nothing** — the only
write path remains the existing POST, now also reachable from an
explicit Finish/Skip tap, never from a page-load or a cancel/back.

**Read side, the actual bug to fix:** `RoundHighlightsSection.tsx`
line 76 currently does
`if (!data?.publishedAt || data.highlights.length === 0) return null`
— this hides the section whenever highlights are empty, *regardless*
of whether a row exists. That line only needs to become
`if (!data?.publishedAt) return null` (and the component shows a short
"Reviewed — no highlights selected" line instead of hiding entirely
when `publishedAt` is set but `highlights.length === 0`). The
`GET /published-highlights` route itself already returns the real
`publishedAt` for an existing row even when `highlights` is empty —
confirmed in the audit — so no API change is needed, only this one
client-side condition.

**Stage 4 derivation:**
```
notStarted:  round.status !== 'completed'
current:     round.status === 'completed' && publishedHighlights.publishedAt === null
complete:    publishedHighlights.publishedAt !== null   // regardless of highlights.length
```

This survives refresh and works across devices for free — it's a real
database row read on every load, not local/session state.

## The other four stages

A single pure function, `deriveRoundWorkflow(round, tournament, publishedHighlights) -> Stage[]`, called once per selected round, feeding both the compact progress tracker and which contextual dashboard section shows. No stage's status is ever set by which buttons were clicked — each is read from the same authoritative fields the existing dashboard already fetches.

| Stage | notStarted | current (actionable now) | complete |
|---|---|---|---|
| 1. Start Round | — (always the floor state until active) | `round.status === 'upcoming'` | `round.status !== 'upcoming'` (i.e. `active` or `completed`) |
| 2. Manage Round | `round.status === 'upcoming'` | `round.status === 'active'` | `round.status === 'completed'` |
| 3. Close Round | `round.status !== 'active'` and not yet completed | `round.status === 'active' && completionPct === 100 && awaitingReconciliation === 0` (the existing Close Round button's own condition, reused verbatim) | `round.status === 'completed'` |
| 4. Select Makers & Breakers | `round.status !== 'completed'` | `round.status === 'completed' && publishedHighlights.publishedAt === null` | `publishedHighlights.publishedAt !== null` |
| 5. Review & Present | `round.status !== 'completed'` | `round.status === 'completed'` (always actionable once closed — a presentation is optional, so this stage has no "blocking" precondition on Stage 4) | no "complete" state — this is the terminal/celebratory stage; it stays "current" indefinitely once the round is closed, since playing a presentation is optional and never required (per your "do not imply the event is incomplete because a presentation hasn't been played") |

Notes on specific brief requirements this mapping satisfies:
- **Stage 2 is never marked complete merely because holes are 100%
  entered** — its completion is `round.status === 'completed'` only,
  which itself requires passing through Stage 3's close gate
  (`checkRoundCompletion`), not completion % directly.
- **Stage 3's actionable condition reuses the exact existing Close
  Round button logic** (`completionPct === 100 && awaitingReconciliation === 0`)
  — not a new calculation.
- **"Only one recommended primary action at a time"**: the derivation
  returns stages in order; the UI shows the first `current` stage's
  action as primary, everything before it as a collapsed "done" row,
  everything after as a collapsed "upcoming" row — never two
  simultaneous primary actions.
- **Refreshing never resets progress**: every input (`round.status`,
  `completionPct`, `awaitingReconciliation`, `publishedHighlights.publishedAt`)
  is a server value already fetched by the existing `/tournament` and
  (new read-path, no new route) `/published-highlights` endpoints —
  nothing here is component state.
- **Selecting another round changes the displayed workflow, never
  persisted lifecycle**: the function takes `round`/`tournament`/
  `publishedHighlights` as plain arguments; which round's data gets
  passed in is exactly today's existing `selectedRoundId` UI state in
  `MyHQClient`, unchanged — the derivation itself has no awareness of
  "selection," only of the one round it's given.

## Event-level progress (brief §4)

Separately, unchanged from existing authoritative data: "Event
Progress: N of M rounds closed" is `rounds.filter(r => r.status ===
'completed').length` / `rounds.length`, computed from the same
chronologically-sorted array `multiRound.ts` already produces. This is
explicitly **not** derived from Stage 4/5 — a round counts as closed
for this purpose the moment `status === 'completed'`, regardless of
whether its Makers & Breakers have been reviewed or its presentation
played, matching your "do not confuse round-workflow progress with
event completion" instruction directly.

## Still open, to confirm during the build rather than guess now

Stage 1's brief says "only enable Start Round when the existing
readiness rules permit it" — I haven't yet pinned down exactly which
existing check (if any) currently gates the Start Round action
server-side (the `start` route itself, or a client-side pre-check). I'll
confirm this precisely while building Stage 1 rather than assume one
exists or invent one; if none exists today beyond "round is upcoming,"
I'll say so plainly rather than silently add a new readiness check of
my own.

## Decision needed before Phase C

Does this mapping match what you had in mind, specifically:
- Stage 5 having no "complete" state (always `current` once the round
  is closed)?
- Event-level progress being independent of Stage 4/5?

If yes, I'll move to Phase C — the actual layout refactor (Event
Schedule → Guided Workflow → Contextual Tools → Results & Highlights →
Event Memories & Presentations → Administration) — plus Phase D
(terminology/duplication fixes) and the `PlayerHomeCard.tsx` chronology
fix flagged in the audit, then Phase E (tests + delivery report),
exactly as the brief's phase order lays out.
