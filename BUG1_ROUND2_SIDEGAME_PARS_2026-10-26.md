# Bug #1 — Round 2 Side Game setup shows holes without pars

## What the code does (verified by reading it)
- The only Side Game hole picker is in the event wizard, `StepRounds.tsx`; it labels each option with `holeOptionLabel(h, round.library_holes_snapshot)`.
- Pars come **only** from the round's frozen course snapshot (`rounds.library_holes_snapshot`, set when a course + tee is chosen from the Course Library). A round with no snapshot shows plain "Hole 3" by design: a par is never guessed.
- A new round starts with no course. Round 2 gets pars only if its own course/tee is picked from the Course Library. Round 1's selection does not carry over to Round 2.
- Create and edit both persist and reload the snapshot (new-trip page, `PATCH /api/trips/[tripId]`, `TripDetailClient`), so I found no code path that drops it.

## Why it is not fixed
The likely cause is data: Round 2 has no snapshot (course typed manually, tee set without hole data, or tee not picked). Alternatives I can't rule out from here are a library tee with par rows missing. Inventing pars would break the product rule, and changing the picker would not help if the round has no par data. I have not guessed.

## Read-only check (replace the name)
```sql
SELECT r.name, r.course_name, r.tee_name, r.holes, r.starting_hole_number,
       jsonb_array_length(r.library_holes_snapshot) AS snapshot_holes
FROM rounds r JOIN trips t ON t.id = r.trip_id
WHERE t.name ILIKE '%YOUR EVENT NAME%' ORDER BY r.play_date, r.created_at;
```
- `snapshot_holes` NULL or 0 for Round 2: the round has no course data. Edit the event, pick Round 2's course and tee from the Course Library, save, then re-open Side Game setup.
- `snapshot_holes` is 9 or 18 but the picker shows no pars: that is a real code bug. Send me the row and a screenshot.
