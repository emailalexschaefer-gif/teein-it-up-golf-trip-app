# Recovery Baseline — recovery-nine-hole-stable

This codebase is the exact, verified contents of
`teeinitup-playing-nine-selector.zip` (the last package delivered
before Social Golf work began), used as the authoritative recovery
baseline per the explicit recovery instructions.

## Provenance

- Source package: `teeinitup-playing-nine-selector.zip`
- Confirmed as the correct pre-Social-Golf package by delivery order —
  the next package delivered after this one was
  `teeinitup-social-golf-mvp.zip`, roughly three hours later.

## Verified present in this baseline

- Front / Back / Custom Playing Nine selector in Hole Setup
  (`BeginRoundModal.tsx` — 10 references to Playing Nine)
- Stroke Index dropdown offering 1-18 for 9-hole rounds
- Round-start validation using uniqueness checks (`siValid`,
  `holeNumbersValid`), not the earlier "must be consecutive 1-to-N" bug
- Back Nine default template with real hole numbers 10-18
  (`DEFAULT_9_BACK_HOLES` in `defaultHoles.ts`)
- Positional front/back-nine scoring fixes (`holes.indexOf(h)`, not
  `holes.slice(0, 9)`) in `ScoreSessionShell.tsx`

## Verified absent from this baseline

- No files matching `*social*` or `*season*` anywhere in the codebase
- No `roundResult.ts` / `roundResult.test.ts`
- No Social Golf event type migration
- No Season Summary endpoint or UI

## Baseline test count

**94/94 scoring-domain tests pass**, confirmed by running the full
suite directly against this extracted codebase (not assumed from a
prior session record). Test files present:
`captureMode.test.ts`, `comparison.test.ts`, `dailyHandicap.test.ts`,
`defaultHoles.test.ts`, `markerAssignment.test.ts`, `rounding.test.ts`,
`stableford.test.ts`, `strokeAllocation.test.ts`, `teamHandicap.test.ts`
— nine files, matching what this stage of the project should have, with
no Season Summary test file present.
