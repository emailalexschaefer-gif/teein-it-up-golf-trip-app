import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Consolidated Test + Fix brief (1 Sep), item 1 regression hardening —
 * "shared-device Side Game verifier scoping," highest priority.
 *
 * No live Postgres connection exists in this sandbox, so
 * resolve_side_comp_verifier()'s actual runtime behaviour cannot be
 * executed here — see sharedDeviceScoring.test.ts's
 * resolveSideCompVerifierCandidate tests for the pure-TypeScript
 * specification of the intended algorithm. This test instead verifies
 * the actual thing that broke, directly in the deployed SQL text: the
 * function's final fallback tier used to select "any other scorecard
 * in the entire round" — no group scoping at all. This asserts the
 * deployed function's final fallback query joins trip_members and
 * filters by the claimant's own group, and that a shared-device check
 * exists ahead of it — so a future edit can't silently regress back to
 * round-wide scoping without this test failing.
 */

function findLatestVerifierMigration(): { filename: string; body: string } {
  const migrationsDir = join(process.cwd(), 'supabase/migrations')
  const files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()
  let latest: { filename: string; body: string } | null = null

  for (const filename of files) {
    const content = readFileSync(join(migrationsDir, filename), 'utf-8')
    if (!/CREATE OR REPLACE FUNCTION public\.resolve_side_comp_verifier\s*\(/i.test(content)) continue
    latest = { filename, body: content }
  }

  if (!latest) throw new Error('No migration defining resolve_side_comp_verifier() was found.')
  return latest
}

test('resolve_side_comp_verifier() checks for a shared-device partner before falling through to organiser/cross-group resolution', () => {
  const { filename, body } = findLatestVerifierMigration()
  assert.match(
    body, /IF v_shared_device_partner IS NOT NULL/i,
    `${filename}: no shared-device partner check found — a Paper claimant (who never has a round_markers row) would fall straight through to the fallbacks this migration was meant to fix`,
  )
  // Searches for the check's actual USE (the IF guard), not the bare
  // variable name — which would false-positive on its own DECLARE
  // statement, always textually first regardless of real execution
  // order.
  const sharedDeviceCheckIndex = body.search(/IF v_shared_device_partner IS NOT NULL/i)
  const organiserFallbackIndex = body.search(/organiser_fallback/i)
  assert.ok(
    sharedDeviceCheckIndex >= 0 && organiserFallbackIndex >= 0 && sharedDeviceCheckIndex < organiserFallbackIndex,
    `${filename}: the shared-device check must appear BEFORE the organiser fallback in the function body — ordering is the actual fix, not just presence`,
  )
})

test('resolve_side_comp_verifier()\u2019s final "any other scorecard" fallback is scoped to the claimant\u2019s own group, not the whole round', () => {
  const { filename, body } = findLatestVerifierMigration()
  // The final fallback block: the last SELECT ... INTO v_other_player
  // before the closing self_verified_fallback return.
  const fallbackMatch = body.match(/SELECT sc\.player_id INTO v_other_player[\s\S]*?ORDER BY sc\.player_id LIMIT 1;/i)
  assert.ok(fallbackMatch, `${filename}: could not locate the final "any other scorecard" fallback query`)
  const fallbackBlock = fallbackMatch![0]

  assert.match(
    fallbackBlock, /JOIN public\.trip_members/i,
    `${filename}: the final fallback no longer joins trip_members at all — this is exactly the unscoped, whole-round query the original bug had`,
  )
  assert.match(
    fallbackBlock, /tm\.group_id\s*=\s*v_claimant_group/i,
    `${filename}: the final fallback does not filter by the claimant's own group_id — a claim could still resolve to a different group's player, reproducing the original bug`,
  )
})

test('resolve_side_comp_verifier()\u2019s genuine round_markers check (Tier 1) is unchanged and still runs first', () => {
  const { filename, body } = findLatestVerifierMigration()
  // Searching for the bare variable name would false-positive on its
  // own DECLARE statement, which always appears textually before any
  // logic runs regardless of actual execution order — this instead
  // searches for the variable's actual USE in the shared-device check
  // (the IF guard that returns it), which genuinely only appears at
  // the point that logic runs.
  const markerCheckIndex = body.search(/FROM public\.round_markers/i)
  const sharedDeviceUseIndex = body.search(/IF v_shared_device_partner IS NOT NULL/i)
  assert.ok(
    markerCheckIndex >= 0 && sharedDeviceUseIndex >= 0 && markerCheckIndex < sharedDeviceUseIndex,
    `${filename}: the round_markers check must still run before the shared-device check's own logic — a genuine marker relationship must never be skipped`,
  )
})
