// Structural guards for Package 4 / M2: things that must stay true for the security design and for V7 compatibility.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const walk = (d: string): string[] => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p] })

test('team-score routes use the signed-in user client, never the admin/service-role client', () => {
  const files = [...walk('src/app/api/team-scores'), ...walk('src/app/api/team-entries'), ...walk('src/app/api/team-teams')].filter(f => f.endsWith('route.ts'))
  assert.equal(files.length, 13)
  for (const f of files) {
    const s = readFileSync(f, 'utf8')
    assert.match(s, /from '@\/lib\/supabase\/server'/, f)
    assert.doesNotMatch(s, /supabase\/admin|service_role|SERVICE_ROLE|createAdminClient/i, f)
    assert.match(s, /handleTeamAction\('/, f)
    assert.match(s, /enabled: \(\) => ambroseEnabled\(\)/, `${f} must be gated by the Ambrose feature flag on the server`)
    assert.match(s, /tripAllowed: makeTripAllowed\(supabase as never\)/, `${f} must also apply the per-event production gate, using the signed-in user's client`)
  }
})
test('no team API or library file sends an actor / organiser flag to the database', () => {
  for (const f of walk('src/lib/ambrose').filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
    const s = readFileSync(f, 'utf8')
    assert.doesNotMatch(s, /p_actor|p_is_organiser|actor_is_organiser/, f)
  }
})
test('the individual score queue declaration is unchanged and the team queue is a separate additive Dexie version', () => {
  const s = readFileSync('src/lib/db/dexie.ts', 'utf8')
  assert.match(s, /version\(1\)\.stores\(\{\s*scoreQueue: 'clientId, syncStatus, scorecardId, holeId, enteredAt'/)
  assert.match(s, /version\(2\)\.stores\(\{\s*scoreQueue: 'clientId, syncStatus, scorecardId, holeId, captureRole, enteredAt'/)
  assert.match(s, /version\(3\)\.stores\(\{\s*teamScoreQueue: 'clientId, syncStatus, entryId, holeId, enteredAt',?\s*\}\)/)
  assert.equal((s.match(/version\(3\)\.stores\(\{[^}]*scoreQueue:/g) ?? []).filter(x => /\bscoreQueue:/.test(x.replace('teamScoreQueue', ''))).length, 0)
})
test('only the flagged mount points, close route and Dexie import the Ambrose libraries', () => {
  const offenders = walk('src').filter(f => /\.(ts|tsx)$/.test(f) && !f.startsWith('src/lib/ambrose') && !f.startsWith('src/components/ambrose') && !f.startsWith('src/app/api/team-'))
    .filter(f => /@\/lib\/ambrose\//.test(readFileSync(f, 'utf8')) && !f.endsWith('dexie.ts'))
  const ALLOWED = ['src/components/scoring/MyHQClient.tsx', 'src/components/scoring/MyRoundClient.tsx', 'src/app/api/trips/[tripId]/rounds/[roundId]/close/route.ts',
    'src/app/api/trips/[tripId]/rounds/[roundId]/start/route.ts', 'src/app/api/trips/[tripId]/rounds/[roundId]/release/route.ts', 'src/app/api/trips/[tripId]/rounds/[roundId]/setup-context/route.ts',
    'src/app/api/scores/route.ts', 'src/app/api/trips/[tripId]/rounds/[roundId]/scorecards/[scorecardId]/override/route.ts', 'src/app/api/trips/[tripId]/rounds/[roundId]/shared-device-score/route.ts']
  assert.deepEqual(offenders.filter(f => !ALLOWED.includes(f)), [])
  // the allowed files may use only the flag and the close verdict -- nothing else from the Ambrose libraries
  for (const f of offenders.filter(f => ALLOWED.includes(f))) {
    for (const m of readFileSync(f, 'utf8').matchAll(/@\/lib\/ambrose\/(\w+)/g)) assert.ok(['featureFlag', 'closeGate', 'handicapPolicy', 'legacyScoreGuard'].includes(m[1]), `${f} imports lib/ambrose/${m[1]}`)
  }
})
test('the Ambrose screens are mounted ONLY at the two flagged My HQ / player-round mount points, each behind the feature flag', () => {
  const importers = walk('src').filter(f => /\.(ts|tsx)$/.test(f) && !f.startsWith('src/components/ambrose'))
    .filter(f => /components\/ambrose\//.test(readFileSync(f, 'utf8')) && !f.endsWith('m2Guards.test.ts'))
  assert.deepEqual(importers.sort(), ['src/components/scoring/MyHQClient.tsx', 'src/components/scoring/MyRoundClient.tsx'])
  for (const f of importers) {
    const s = readFileSync(f, 'utf8')
    assert.match(s, /const AMBROSE_ON = ambroseEnabledForTrip\(tripId\)/, `${f} must gate the Ambrose mount per event`)
    // every use of an Ambrose section element must sit behind the flag expression
    for (const m of s.matchAll(/<Ambrose\w+/g)) {
      const before = s.slice(Math.max(0, (m.index ?? 0) - 400), m.index)
      assert.match(before, /AMBROSE_ON|ambroseEnabled\(\)|isAmbroseRound/, `${f}: ${m[0]} is not behind the flag`)
    }
  }
})
test('the read-only team-state route uses the user client, is GET-only and never the admin client', () => {
  const s = readFileSync('src/app/api/team-state/route.ts', 'utf8')
  assert.match(s, /from '@\/lib\/supabase\/server'/); assert.doesNotMatch(s, /supabase\/admin|service_role|SERVICE_ROLE|createAdminClient/i)
  assert.match(s, /enabled: \(\) => ambroseEnabled\(\)/); assert.match(s, /tripAllowed: \(tripId\) => ambroseEnabledForTrip\(tripId\)/); assert.match(s, /handleTeamStateRead\(/); assert.match(s, /export async function GET/); assert.doesNotMatch(s, /export async function (POST|PUT|PATCH|DELETE)/)
  assert.doesNotMatch(s, /\.(insert|update|upsert|delete)\(/)
  const rpcs = [...s.matchAll(/\.rpc\('([a-z_]+)'/g)].map(m => m[1]); assert.deepEqual([...new Set(rpcs)], ['team_entry_completion'])   // the one read-only (STABLE, SECURITY INVOKER) function
  assert.equal((s.match(/\.rpc\(/g) ?? []).length, rpcs.length)
})

test('the Close Round route keeps the individual-scorecard rule for every non-Ambrose round and only branches behind the flag', () => {
  const s = readFileSync('src/app/api/trips/[tripId]/rounds/[roundId]/close/route.ts', 'utf8')
  assert.match(s, /if \(ambroseEnabledForTrip\(tripId\)\) \{/)
  assert.match(s, /let isAmbrose = false/)
  assert.match(s, /checkRoundCompletion\(/)            // the original rule is still there
  assert.match(s, /organiser can close a round/)       // same authority check, untouched
  assert.equal((s.match(/isAmbrose = true/g) ?? []).length, 1)
})

test('the handicap relaxation is format-scoped: every other round still requires handicaps in Release, Begin Round and the Begin Round screen', () => {
  const base = 'src/app/api/trips/[tripId]/rounds/[roundId]/'
  const start = readFileSync(base + 'start/route.ts', 'utf8')
  assert.match(start, /const missingHcp = hcpOptional \? \[\] : assignedMembers\.filter\(/)           // only skipped when the policy says so
  assert.match(start, /Every player must have a playing handicap before the round can begin/)          // original rule and wording intact
  const release = readFileSync(base + 'release/route.ts', 'utf8')
  assert.equal((release.match(/handicapsOptionalForRound\(admin, roundId, ambroseEnabledForTrip\(tripId\)\)/g) ?? []).length, 2)
  const live = readFileSync('src/lib/rounds/liveArrangements.ts', 'utf8')
  assert.match(live, /resolved === null && opts\?\.handicapsOptional \? 0 : resolved/)
  assert.match(live, /Every player needs a playing handicap\./)                                         // original problem text intact
  const modal = readFileSync('src/components/scoring/BeginRoundModal.tsx', 'utf8')
  assert.match(modal, /setupContext\?\.handicapsOptional === true \|\| localGroups\.every\(/)
})

test('"is this an Ambrose round" can only become true when the flag is on (the hook is disabled otherwise)', () => {
  const hq = readFileSync('src/components/scoring/MyHQClient.tsx', 'utf8')
  assert.match(hq, /useAmbroseRound\(selected\?\.id \?\? null, AMBROSE_ON && /)
  const hook = readFileSync('src/components/ambrose/useAmbroseRound.ts', 'utf8')
  assert.match(hook, /enabled: enabled && !!roundId/)
})

test('every individual score-write route refuses Ambrose rounds (and the guard is the flagged, no-op-by-default helper)', () => {
  for (const f of ['src/app/api/scores/route.ts', 'src/app/api/trips/[tripId]/rounds/[roundId]/scorecards/[scorecardId]/override/route.ts', 'src/app/api/trips/[tripId]/rounds/[roundId]/shared-device-score/route.ts']) {
    const s = readFileSync(f, 'utf8').split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')   // code only, not comments
    assert.match(s, /ambroseLegacyScoreBlock\(/, f)
    const w = s.search(/\.(insert|upsert|update)\(|\.rpc\(/)   // first data access after the checks
    assert.ok(w === -1 || s.indexOf('ambroseLegacyScoreBlock(') < w, `${f}: the Ambrose check must come before any write`)
  }
  // no OTHER route writes score_entries directly
  const writers = walk('src/app/api').filter(f => f.endsWith('route.ts')).filter(f => /from\('score_entries'\)[\s\S]{0,200}\.(insert|upsert|update|delete)\(/.test(readFileSync(f, 'utf8')))
  assert.deepEqual(writers.sort(), ['src/app/api/scores/route.ts'])
})

test('production safety: only the flag module and the trip gate read the Ambrose / environment switches; setup start/release/context are per-event', () => {
  const allowed = new Set(['src/lib/ambrose/featureFlag.ts'])
  for (const f of walk('src').filter(f => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f))) {
    const code = readFileSync(f, 'utf8').split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
    if (/NEXT_PUBLIC_AMBROSE_|NEXT_PUBLIC_APP_ENV/.test(code)) assert.ok(allowed.has(f), `${f} reads an Ambrose/environment switch directly; use featureFlag.ts`)
  }
  for (const r of ['start', 'release', 'setup-context']) {
    const code = readFileSync(`src/app/api/trips/[tripId]/rounds/[roundId]/${r}/route.ts`, 'utf8')
    assert.doesNotMatch(code, /handicapsOptionalForRound\(admin, roundId\)/, `${r} must pass the per-event flag`)
  }
})
