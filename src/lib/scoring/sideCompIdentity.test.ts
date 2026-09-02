import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveCompetitorDisplayName, resolveSideCompMomentEntryId } from './sideCompIdentity'

// ── resolveCompetitorDisplayName — item 2 ────────────────────────────────────

test('resolveCompetitorDisplayName — Digital A submitting FOR Paper A resolves to Paper A, not Digital A (the exact reported bug)', () => {
  const name = resolveCompetitorDisplayName({
    selectedPlayerId: 'razzleDazzle',
    currentUserId: 'darren',
    groupMembers: [
      { id: 'darren', name: 'Darren Lappen' },
      { id: 'razzleDazzle', name: 'Razzle Dazzle' },
    ],
  })
  assert.equal(name, 'Razzle Dazzle')
  assert.notEqual(name, 'Darren Lappen')
})

test('resolveCompetitorDisplayName — a player submitting for themselves resolves to their own name', () => {
  const name = resolveCompetitorDisplayName({
    selectedPlayerId: 'alex',
    currentUserId: 'alex',
    groupMembers: [{ id: 'alex', name: 'Alex Schaefer' }],
  })
  assert.equal(name, 'Alex Schaefer')
})

test('resolveCompetitorDisplayName — falls back to "You" only when the selected id is genuinely the caller and no roster entry matched', () => {
  const name = resolveCompetitorDisplayName({
    selectedPlayerId: 'alex',
    currentUserId: 'alex',
    groupMembers: [],
  })
  assert.equal(name, 'You')
})

test('resolveCompetitorDisplayName — falls back to "Player" for an unresolvable competitor who is not the caller', () => {
  const name = resolveCompetitorDisplayName({
    selectedPlayerId: 'someoneElse',
    currentUserId: 'alex',
    groupMembers: [],
  })
  assert.equal(name, 'Player')
})

// ── resolveSideCompMomentEntryId — item 3 ────────────────────────────────────

test('resolveSideCompMomentEntryId — a fresh submission\u2019s entryId is used when present', () => {
  const id = resolveSideCompMomentEntryId({ lastResultEntryId: 'fresh-entry', restoredEntryId: null })
  assert.equal(id, 'fresh-entry')
})

test('resolveSideCompMomentEntryId — falls back to the restored entryId from a prior visit (the exact reported bug: this was previously dropped entirely)', () => {
  const id = resolveSideCompMomentEntryId({ lastResultEntryId: null, restoredEntryId: 'restored-entry' })
  assert.equal(id, 'restored-entry')
})

test('resolveSideCompMomentEntryId — a fresh submission takes priority over a stale restored id if both are somehow present', () => {
  const id = resolveSideCompMomentEntryId({ lastResultEntryId: 'fresh-entry', restoredEntryId: 'restored-entry' })
  assert.equal(id, 'fresh-entry')
})

test('resolveSideCompMomentEntryId — genuinely neither present resolves to null, not a fabricated id', () => {
  const id = resolveSideCompMomentEntryId({ lastResultEntryId: null, restoredEntryId: null })
  assert.equal(id, null)
})
