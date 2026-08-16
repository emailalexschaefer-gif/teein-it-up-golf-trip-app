'use client'

import React, { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { resolvePlayingHandicap, deriveBeginRoundHoles, deriveNineHoles } from '@/lib/scoring/defaultHoles'
import type { HoleTemplate, PlayingNine } from '@/lib/scoring/defaultHoles'
import { useScoringFocusStore } from '@/store/scoringFocusStore'

interface Player {
  member_id:  string  // trip_members.id — required by the members PATCH route, distinct from profile_id
  profile_id: string
  full_name:  string
  playing_handicap: number | null
  profile_handicap: number | null
}

interface Group {
  id:       string
  name:     string
  tee_time: string | null
  players:  Player[]
}

interface Props {
  tripId:    string
  roundId:   string
  roundName: string
  courseName: string | null
  holeCount: 9 | 18
  playDate:  string
  groups:    Group[]
  onClose:   () => void
  // Course Library v1 — the frozen, setup-time snapshot (migration 041).
  // When present, this is what pre-fills the hole review below, INSTEAD
  // of the generic getDefaultHoles() template — never a fresh read from
  // the library tables themselves, which is what makes an
  // already-configured round immune to a later library edit. Absent
  // entirely for a manually-configured round or any round created
  // before Course Library existed, in which case behaviour is
  // byte-identical to before this feature: the same generic template,
  // same manual review/edit flow.
  libraryHolesSnapshot?: { hole_number: number; par: number; stroke_index: number | null; distance: number | null }[] | null
  teeName?: string | null
}

type Stage = 'review' | 'holes' | 'confirm' | 'starting'

export default function BeginRoundModal({
  tripId, roundId, roundName, courseName, holeCount,
  playDate, groups, onClose, libraryHolesSnapshot, teeName,
}: Props) {
  const router = useRouter()
  const setScoringFocusActive = useScoringFocusStore(s => s.setActive)
  const [stage, setStage]   = useState<Stage>('review')
  const modalScrollRef = useRef<HTMLDivElement>(null)

  // ── Multi-round setup context (Round 2+) ──────────────────────────────────
  // Single fetch covers previous-round results, cumulative standings, and
  // a refreshable copy of current groups-with-players — refetched after
  // any handicap edit, Leaders Last, or manual group move, so Step 1
  // always reflects the latest state without depending on the parent
  // page's own data. localGroups starts from the static `groups` prop
  // (Round 1 renders immediately, unchanged from before) and is replaced
  // by the fetched version once it loads.
  interface StandingRow { playerId: string; playerName: string; totalPoints: number; position: number; roundsPlayed: number }
  interface SetupContextGroup { id: string; name: string; tee_time: string | null; players: Player[] }
  interface SetupContext {
    isFirstRound: boolean
    previousRound?: { id: string; name: string }
    previousRoundResults: StandingRow[] | null
    cumulativeStandings: StandingRow[]
    groups: SetupContextGroup[]
  }
  const [setupContext, setSetupContext] = useState<SetupContext | null>(null)
  const [setupContextLoading, setSetupContextLoading] = useState(true)
  const [setupContextError, setSetupContextError] = useState('')
  const localGroups: Group[] = setupContext?.groups ?? groups

  async function refetchSetupContext() {
    try {
      const res = await fetch(`/api/trips/${tripId}/rounds/${roundId}/setup-context`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        // TEMPORARY: surfaces the server's debug detail (if present) so
        // the actual failure is visible instead of only ever showing the
        // generic fallback -- the previous version threw before ever
        // reading the response body, discarding any diagnostic detail
        // the server sent. Remove the debug suffix once this path is
        // confirmed reliable.
        throw new Error(data.error ? `${data.error}${data.debug ? ` (${data.debug})` : ''}` : 'Failed to load setup context')
      }
      setSetupContext(data)
      setSetupContextError('')
    } catch (err) {
      setSetupContextError(
        err instanceof Error && err.message !== 'Failed to load setup context'
          ? err.message
          : 'Could not load previous results or current groups. Pull to refresh, or continue with what\u2019s shown below.'
      )
    } finally {
      setSetupContextLoading(false)
    }
  }

  useEffect(() => {
    refetchSetupContext()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally fetch-once-on-mount; refetchSetupContext is called explicitly after mutations elsewhere, not on every render
  }, [])

  // ── Handicap +/- and manual group changes (Round 2+) ──────────────────────
  // Both reuse the existing members PATCH route — no new endpoint for
  // either, per the explicit instruction. Optimistic: localGroups updates
  // immediately for a responsive feel, then rolls back to the pre-edit
  // value if the server call fails, with a visible error rather than
  // silently reverting. This only ever touches trip_members.playing_handicap/
  // group_id (the "current, adjustable" values) — never a scorecard, so a
  // completed Round 1's snapshot is structurally unreachable from here.
  const [mutationError, setMutationError] = useState('')
  const [pendingProfileId, setPendingProfileId] = useState<string | null>(null)

  function setLocalGroups(updater: (prev: Group[]) => Group[]) {
    setSetupContext(prev => prev ? { ...prev, groups: updater(prev.groups) } : prev)
  }

  async function handleHandicapAdjust(profileId: string, delta: 1 | -1) {
    setMutationError('')
    const previousGroups = localGroups
    const currentPlayer = localGroups.flatMap(g => g.players).find(p => p.profile_id === profileId)
    if (!currentPlayer) return
    const currentHcp = resolvePlayingHandicap(currentPlayer.playing_handicap, currentPlayer.profile_handicap) ?? 0
    const nextHcp = currentHcp + delta

    setLocalGroups(prev => prev.map(g => ({
      ...g,
      players: g.players.map(p => p.profile_id === profileId ? { ...p, playing_handicap: nextHcp } : p),
    })))

    try {
      // The PATCH route matches on trip_members.id, not profile_id — use
      // currentPlayer.member_id (see Player interface / setup-context route).
      const res = await fetch(`/api/trips/${tripId}/members/${currentPlayer.member_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playing_handicap: nextHcp }),
      })
      if (!res.ok) throw new Error()
    } catch {
      setLocalGroups(() => previousGroups) // roll back exactly to the pre-edit state
      setMutationError("Couldn't update that handicap. Please try again.")
    }
  }

  async function handleGroupChange(profileId: string, newGroupId: string) {
    setMutationError('')
    setPendingProfileId(profileId)
    const previousGroups = localGroups
    const player = localGroups.flatMap(g => g.players).find(p => p.profile_id === profileId)
    if (!player) { setPendingProfileId(null); return }

    setLocalGroups(prev => prev.map(g => ({
      ...g,
      players: g.id === newGroupId
        ? [...g.players.filter(p => p.profile_id !== profileId), player]
        : g.players.filter(p => p.profile_id !== profileId),
    })))

    try {
      // Same trip_members.id requirement as handleHandicapAdjust above.
      const res = await fetch(`/api/trips/${tripId}/members/${player.member_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group_id: newGroupId }),
      })
      if (!res.ok) throw new Error()
    } catch {
      setLocalGroups(() => previousGroups)
      setMutationError("Couldn't move that player. Please try again.")
    } finally {
      setPendingProfileId(null)
    }
  }

  const [applyingLeadersLast, setApplyingLeadersLast] = useState(false)
  async function handleLeadersLast() {
    setMutationError('')
    setApplyingLeadersLast(true)
    try {
      const res = await fetch(`/api/trips/${tripId}/rounds/${roundId}/leaders-last`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Leaders Last failed.')
      await refetchSetupContext() // refresh Step 1 immediately, per the explicit requirement
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : "Couldn't reseed groups. Please try again.")
    } finally {
      setApplyingLeadersLast(false)
    }
  }

  // Reset scroll position to the top whenever the active stage changes —
  // covers opening the modal (first stage), moving forward, and moving
  // backward. Without this, the modal could retain whatever scroll
  // position the previous stage was left at, opening the new stage
  // partway down instead of at its own heading/primary content.
  useEffect(() => {
    modalScrollRef.current?.scrollTo({ top: 0 })
  }, [stage])
  const [holes, setHoles]   = useState<HoleTemplate[]>(() => {
    // Fix Batch (course-data): exhaustive static tracing of the entire
    // wizard -> API -> DB -> this component chain found every link
    // structurally correct, and the absence of TeeSummaryCard's own
    // "hole-by-hole data hasn't been added" warning (both at original
    // selection time and when re-opening Edit Trip afterward) is strong
    // evidence the snapshot genuinely is being persisted with real data.
    // This dev-only log exists specifically to answer, from a real
    // browser session, the one question static reading can't: what does
    // this component actually receive at the moment it matters. Confirm
    // no code changes this pass are speculative about it.
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.log('[BeginRoundModal] mount', { holeCount, snapshotLength: libraryHolesSnapshot?.length ?? null, teeName, firstHole: libraryHolesSnapshot?.[0] ?? null })
    }
    return deriveBeginRoundHoles(libraryHolesSnapshot, holeCount)
  })
  // Playing Nine — only meaningful for 9-hole rounds; 18-hole rounds are
  // explicitly unaffected and never read this. Defaults to Front Nine
  // per the explicit requirement (Custom/To Be Confirmed can come later).
  const [playingNine, setPlayingNine] = useState<PlayingNine>('front')

  function handlePlayingNineChange(nine: PlayingNine) {
    setPlayingNine(nine)
    // Custom starts from the current holes as-is (whatever was already
    // there — Front/Back's own real snapshot data if one exists, per the
    // fix below, or the generic template otherwise) so the organiser
    // edits from a familiar starting point rather than a blank/reset
    // table. Front and Back genuinely reload their own data: real
    // library snapshot holes 1-9/10-18 when a snapshot exists (never
    // re-fetched — the exact frozen array this component was given),
    // falling back to the generic template only when there's truly
    // nothing real to show for that range. This was the actual defect
    // found during review: this used to call getDefaultHolesForNine()
    // unconditionally, silently discarding real course data the moment
    // Front/Back was tapped on a library-sourced round.
    if (nine !== 'custom') setHoles(deriveNineHoles(libraryHolesSnapshot, nine))
  }

  const [error, setError]   = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  // Validation
  const allPlayersHaveHandicap = localGroups.every(g =>
    g.players.every(p => resolvePlayingHandicap(p.playing_handicap, p.profile_handicap) !== null)
  )
  const allGroupsHavePlayers = localGroups.every(g => g.players.length > 0)
  const hasGroups = localGroups.length > 0
  const totalPlayers = localGroups.reduce((sum, g) => sum + g.players.length, 0)

  const canBegin = hasGroups && allGroupsHavePlayers && allPlayersHaveHandicap

  async function handleBegin() {
    setStarting(true); setError(null)
    let staySpinning = false
    try {
      const res = await fetch(`/api/trips/${tripId}/rounds/${roundId}/start`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ holes }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 404) {
          // The round genuinely doesn't exist anymore (deleted, or the id
          // this modal was opened with has gone stale). Retrying against a
          // dead id can't ever succeed — refresh the trip's data so the
          // Rounds tab re-renders with whatever rounds actually exist now,
          // and close the modal rather than leaving the user stuck on it.
          setError((data.error ?? 'This round no longer exists.') + ' Refreshing…')
          router.refresh()
          staySpinning = true // keep the disabled/spinner state until close, intentionally
          setTimeout(() => onClose(), 1500)
          return
        }
        setError(data.error ?? "We couldn't begin the round. Please try again.")
        setStage('confirm')
        return
      }
      // Success — navigate to the active round shell. Keep the spinner
      // state through the navigation rather than flipping it off right
      // before the page changes.
      staySpinning = true
      router.push(`/trips/${tripId}/rounds/${roundId}`)
      router.refresh()
    } catch {
      setError("We couldn't begin the round. Please try again.")
      setStage('confirm')
    } finally {
      // Guarantees 'starting' never gets stuck true after an error, on any
      // exit path — except the two cases above where staying disabled
      // during a close/navigation transition is the correct UX, not a bug.
      if (!staySpinning) setStarting(false)
    }
  }

  function updateHole(idx: number, field: 'hole_number' | 'par' | 'stroke_index', val: number) {
    setHoles((prev: HoleTemplate[]) => prev.map((h: HoleTemplate, i: number) => i === idx ? { ...h, [field]: val } : h))
  }

  const formattedDate = new Date(playDate + 'T00:00:00')
    .toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  // Reuses the existing scoring-focus mechanism (already hides AppNav/
  // TripBottomNav during active hole-by-hole scoring) rather than a new
  // one — the wizard needs exactly the same "hide app chrome, full
  // screen for one focused task" treatment.
  useEffect(() => {
    setScoringFocusActive(true)
    return () => setScoringFocusActive(false)
    // setScoringFocusActive is the `setActive` action from a Zustand
    // store (src/store/scoringFocusStore.ts) — Zustand guarantees action
    // references defined in the store creator are stable for the
    // store's lifetime (a module-level singleton here, not created per-
    // component), so including it below does not change when this
    // effect runs; it still only fires on mount/unmount, exactly as
    // before. This satisfies the lint rule honestly rather than
    // silencing it.
  }, [setScoringFocusActive])

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: '#f8f4eb',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {/* True full-screen presentation, not a bottom sheet — this is the
          actual fix for small-phone clipping. The previous maxHeight:
          calc(92vh...) cap plus rounded-corner bottom-sheet styling was
          what left content clipped and controls reachable only by
          fighting the modal's constrained height. The fixed-header/
          scrollable-body/fixed-footer structure below (already correct,
          already respecting safe-area-inset-bottom) is unchanged. */}
      <div style={{
        width: '100%', maxWidth: 560, height: '100%',
        background: '#f8f4eb',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header — fixed, never scrolls */}
        <div style={{
          flexShrink: 0,
          background: 'linear-gradient(135deg, #0f2d1c, #1a4731)',
          borderBottom: '2px solid #c9a84c',
          padding: '20px 20px 16px',
          paddingTop: 'calc(20px + env(safe-area-inset-top, 0px))',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <p style={{ fontFamily: 'var(--font-body)', color: 'rgba(245,230,184,0.6)', fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 3 }}>
                {stage === 'holes' ? 'Hole Setup' : 'Begin Round'}
              </p>
              <h2 style={{ fontFamily: 'var(--font-display)', color: '#ffffff', fontSize: 22, fontWeight: 800, margin: 0 }}>
                {roundName}
              </h2>
            </div>
            <button type="button" onClick={onClose} style={{
              background: 'rgba(255,255,255,0.1)', border: 'none',
              borderRadius: 8, padding: '6px 12px', cursor: 'pointer',
              fontFamily: 'var(--font-body)', color: 'rgba(245,230,184,0.7)', fontSize: 13,
            }}>✕</button>
          </div>
          {/* Stage progress dots — fixed with the header */}
          <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
            {(['review', 'holes', 'confirm'] as Stage[]).map(s => (
              <div key={s} style={{
                flex: 1, height: 3, borderRadius: 2,
                background: stage === s || (stage === 'starting' && s === 'confirm') || (s === 'review' && (stage === 'holes' || stage === 'confirm' || stage === 'starting')) || (s === 'holes' && (stage === 'confirm' || stage === 'starting'))
                  ? '#c9a84c' : 'rgba(201,168,76,0.25)',
                transition: 'background 0.2s',
              }} />
            ))}
          </div>
        </div>

        {/* Body — the ONLY scrollable region */}
        <div ref={modalScrollRef} style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>

          {/* ── Stage 1: Review ─────────────────────────────────────────── */}
          {stage === 'review' && (
            <>
              {/* Round info */}
              {(() => {
                const groupTimes = localGroups.map(g => g.tee_time).filter(Boolean).sort() as string[]
                const teeTimeDisplay = groupTimes.length === 0 ? 'TBC'
                  : groupTimes.length === 1 ? groupTimes[0]
                  : `${groupTimes[0]}–${groupTimes[groupTimes.length - 1]}`
                const detailRows = [
                  ['📅 Date', formattedDate],
                  ['⏱ First tee', teeTimeDisplay],
                  ['⛳ Holes', String(holeCount)],
                  ['🏆 Format', 'Stableford'],
                  ...(courseName ? [['📍 Course', courseName]] : []),
                ]
                return (
                  <div className="card p-4 mb-4" style={{ marginBottom: 14 }}>
                    <p className="s-label mb-2">Round Details</p>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      {detailRows.map(([label, val]) => (
                        <div key={label}>
                          <p style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: '#7a7260', fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 2 }}>{label}</p>
                          <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: '#1a1a16' }}>{val}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })()}

              {/* Previous round / event standings — Round 2+ only */}
              {setupContextLoading ? (
                <div className="card p-4 mb-4" style={{ marginBottom: 14 }}>
                  <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#7a7260' }}>Loading previous results…</p>
                </div>
              ) : setupContext && !setupContext.isFirstRound && setupContext.previousRoundResults && (
                <div className="card p-4 mb-4" style={{ marginBottom: 14 }}>
                  <p className="s-label mb-2">
                    {setupContext.cumulativeStandings.length > 0 && setupContext.previousRound
                      ? `${setupContext.previousRound.name} Results / Event Standings`
                      : 'Previous Round Results'}
                  </p>
                  {setupContext.cumulativeStandings
                    .slice() // cumulativeStandings is already position-ordered
                    .map(cum => {
                      const roundRow = setupContext.previousRoundResults!.find(r => r.playerId === cum.playerId)
                      return (
                        <div key={cum.playerId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0' }}>
                          <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#1a1a16' }}>
                            <strong style={{ color: '#a1791f' }}>{cum.position}.</strong> {cum.playerName}
                          </span>
                          <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#7a7260' }}>
                            {roundRow?.totalPoints ?? '—'} pts
                            <strong style={{ color: '#1a4731', marginLeft: 8 }}>Total {cum.totalPoints}</strong>
                          </span>
                        </div>
                      )
                    })}
                </div>
              )}

              {mutationError && <Warning>{mutationError}</Warning>}
              {setupContextError && <Warning>{setupContextError}</Warning>}

              {/* Groups & players */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <p className="s-label" style={{ marginBottom: 0 }}>Playing Groups</p>
                {/* Leaders Last — only meaningful once there's a previous
                    round to seed from, and organiser-optional per the
                    explicit "must not apply automatically" requirement. */}
                {setupContext && !setupContext.isFirstRound && hasGroups && (
                  <button
                    type="button"
                    onClick={handleLeadersLast}
                    disabled={applyingLeadersLast}
                    style={{
                      fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700,
                      color: '#a1791f', background: 'rgba(201,168,76,0.12)',
                      border: '1.5px solid rgba(201,168,76,0.4)', borderRadius: 8,
                      padding: '6px 12px', cursor: applyingLeadersLast ? 'default' : 'pointer',
                      opacity: applyingLeadersLast ? 0.6 : 1,
                    }}
                  >
                    {applyingLeadersLast ? 'Seeding…' : '🏆 Leaders Last'}
                  </button>
                )}
              </div>

              {!hasGroups && (
                <Warning>No playing groups have been set up. Return to the Groups tab to create groups and assign players.</Warning>
              )}

              {localGroups.map(g => {
                const missingHcp = g.players.filter(p => resolvePlayingHandicap(p.playing_handicap, p.profile_handicap) === null)
                return (
                  <div key={g.id} style={{
                    background: '#ffffff', border: '1.5px solid #d9c9a3',
                    borderRadius: 12, padding: '12px 14px', marginBottom: 10,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, color: '#1a4731' }}>{g.name}</span>
                      {g.tee_time && (
                        <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#c9a84c', fontWeight: 700, background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.3)', borderRadius: 6, padding: '2px 8px' }}>
                          ⏱ {g.tee_time}
                        </span>
                      )}
                    </div>
                    {g.players.length === 0 ? (
                      <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#b45309' }}>⚠ No players assigned to this group.</p>
                    ) : (
                      g.players.map(p => {
                        const hcp = resolvePlayingHandicap(p.playing_handicap, p.profile_handicap)
                        return (
                          <div key={p.profile_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 0', marginBottom: 4, gap: 8 }}>
                            <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#1a1a16', fontWeight: 500, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.full_name}</span>

                            {/* Inline +/- handicap controls — replaces the
                                passive HCP badge entirely, per the explicit
                                "no Edit button, no modal" requirement. Only
                                shown once setup context has loaded, so a
                                tap can never silently no-op against a null
                                context. */}
                            {setupContext && !setupContextLoading ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                                <button
                                  type="button"
                                  onClick={() => handleHandicapAdjust(p.profile_id, -1)}
                                  aria-label={`Decrease ${p.full_name}'s handicap`}
                                  style={{ width: 30, height: 30, borderRadius: 8, border: '1.5px solid #d9c9a3', background: '#faf6ed', color: '#1a4731', fontWeight: 800, fontSize: 15, cursor: 'pointer' }}
                                >−</button>
                                <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: hcp !== null ? '#7a7260' : '#b91c1c', fontWeight: 700, minWidth: 52, textAlign: 'center' }}>
                                  {hcp !== null ? `HCP ${hcp}` : '⚠ No HCP'}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleHandicapAdjust(p.profile_id, 1)}
                                  aria-label={`Increase ${p.full_name}'s handicap`}
                                  style={{ width: 30, height: 30, borderRadius: 8, border: '1.5px solid #d9c9a3', background: '#faf6ed', color: '#1a4731', fontWeight: 800, fontSize: 15, cursor: 'pointer' }}
                                >+</button>
                              </div>
                            ) : (
                              hcp !== null ? (
                                <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#7a7260', background: '#f2e8d0', borderRadius: 6, padding: '2px 8px', flexShrink: 0 }}>HCP {hcp}</span>
                              ) : (
                                <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#b91c1c', fontWeight: 600, flexShrink: 0 }}>⚠ No handicap</span>
                              )
                            )}

                            {/* Manual group move — a compact selector
                                rather than drag/drop, per the explicit
                                "mobile simplicity over fancy drag/drop"
                                instruction. Only shown once there's more
                                than one group to move between. */}
                            {localGroups.length > 1 && (
                              <select
                                value={g.id}
                                disabled={pendingProfileId === p.profile_id}
                                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => handleGroupChange(p.profile_id, e.target.value)}
                                style={{
                                  fontFamily: 'var(--font-body)', fontSize: 11, color: '#7a7260',
                                  background: '#faf6ed', border: '1.5px solid #d9c9a3', borderRadius: 6,
                                  padding: '3px 4px', flexShrink: 0, maxWidth: 72,
                                  opacity: pendingProfileId === p.profile_id ? 0.5 : 1,
                                }}
                              >
                                {localGroups.map(og => <option key={og.id} value={og.id}>{og.name}</option>)}
                              </select>
                            )}
                          </div>
                        )
                      })
                    )}
                    {missingHcp.length > 0 && (
                      <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#b45309', marginTop: 6 }}>
                        Confirm a playing handicap for {missingHcp.map(p => p.full_name).join(', ')} in the Players tab.
                      </p>
                    )}
                  </div>
                )
              })}
            </>
          )}

          {/* ── Stage 2: Holes ──────────────────────────────────────────── */}
          {stage === 'holes' && (
            <>
              {holeCount === 9 && (
                <div style={{ marginBottom: 14 }}>
                  <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700, color: '#7a5c00', letterSpacing: 0.5, marginBottom: 6, textTransform: 'uppercase' }}>
                    Playing Nine
                  </p>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {([
                      { key: 'front' as PlayingNine, label: 'Front Nine' },
                      { key: 'back' as PlayingNine, label: 'Back Nine' },
                      { key: 'custom' as PlayingNine, label: 'Custom' },
                    ]).map(opt => (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => handlePlayingNineChange(opt.key)}
                        style={{
                          flex: 1, padding: '8px 4px', borderRadius: 8,
                          background: playingNine === opt.key ? '#1a4731' : '#f8f4eb',
                          color: playingNine === opt.key ? '#e8c96a' : '#7a5c00',
                          border: playingNine === opt.key ? '1.5px solid #1a4731' : '1px solid #e8d98a',
                          fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ background: '#fdf8ee', border: '1px solid #e8d98a', borderRadius: 10, padding: '10px 14px', marginBottom: 14 }}>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#7a5c00' }}>
                  {holeCount === 9 && playingNine === 'back'
                    ? <><strong>Back Nine loaded (holes 10-18).</strong> Real course hole numbers are kept — review and adjust par and stroke index to match your course before continuing.</>
                    : holeCount === 9 && playingNine === 'custom'
                    ? <><strong>Custom nine.</strong> Edit hole numbers, pars, and stroke indexes freely to match whatever holes are actually being played.</>
                    : teeName && (!libraryHolesSnapshot || libraryHolesSnapshot.length === 0)
                    // Fix Batch (verification/course-data): this branch is
                    // new — previously any non-back/non-custom case fell
                    // straight to the generic "Default hole template
                    // loaded" message below, even when a library tee WAS
                    // selected (teeName present) and simply has no hole-
                    // level rows on file. That's a genuinely different,
                    // more diagnosable situation than never having chosen
                    // a course at all, and conflating the two made this
                    // exact repro (Flinders Black Tees selected, correct
                    // aggregate stats shown, but Hole Setup still generic)
                    // look identical to a plain manual round. The
                    // underlying fallback behaviour is unchanged — still
                    // the same safe generic template, never fabricated
                    // course data — only the explanation shown is more
                    // precise now.
                    ? <><strong>{teeName} has no hole-by-hole data on file yet.</strong> Showing a default template — review and adjust each hole&apos;s par and stroke index, or add hole data for this tee in Course Library Admin.</>
                    : <><strong>Default hole template loaded.</strong> Review and adjust each hole&apos;s par and stroke index to match your course before continuing.</>}
                </p>
              </div>

              {/* Hole table */}
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-body)', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#1a4731' }}>
                      {['Hole', 'Par', 'SI'].map(h => (
                        <th key={h} style={{ color: '#e8c96a', fontWeight: 700, padding: '8px 6px', textAlign: 'center', fontSize: 11, letterSpacing: 0.5 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {holes.map((hole: HoleTemplate, idx: number) => (
                      <tr key={idx} style={{ background: idx % 2 === 0 ? '#f8f4eb' : '#ffffff' }}>
                        <td style={{ padding: '4px 2px', textAlign: 'center' }}>
                          {holeCount === 9 && playingNine === 'custom' ? (
                            <select
                              value={hole.hole_number}
                              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updateHole(idx, 'hole_number', parseInt(e.target.value))}
                              style={{ border: '1px solid #d9c9a3', borderRadius: 6, padding: '4px 6px', background: '#fff', fontFamily: 'var(--font-body)', fontSize: 13, width: 56, textAlign: 'center', fontWeight: 700, color: '#1a4731' }}
                            >
                              {Array.from({ length: 18 }, (_, i) => i + 1).map(n => (
                                <option key={n} value={n}>{n}</option>
                              ))}
                            </select>
                          ) : (
                            <span style={{ fontWeight: 700, color: '#1a4731' }}>{hole.hole_number}</span>
                          )}
                        </td>
                        <td style={{ padding: '4px 2px', textAlign: 'center' }}>
                          <select
                            value={hole.par}
                            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updateHole(idx, 'par', parseInt(e.target.value))}
                            style={{ border: '1px solid #d9c9a3', borderRadius: 6, padding: '4px 6px', background: '#fff', fontFamily: 'var(--font-body)', fontSize: 13, width: 56, textAlign: 'center' }}
                          >
                            {[3, 4, 5, 6].map(p => <option key={p} value={p}>{p}</option>)}
                          </select>
                        </td>
                        <td style={{ padding: '4px 2px', textAlign: 'center' }}>
                          <select
                            value={hole.stroke_index}
                            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updateHole(idx, 'stroke_index', parseInt(e.target.value))}
                            style={{ border: '1px solid #d9c9a3', borderRadius: 6, padding: '4px 6px', background: '#fff', fontFamily: 'var(--font-body)', fontSize: 13, width: 56, textAlign: 'center' }}
                          >
                            {Array.from({ length: 18 }, (_, i) => i + 1).map(si => (
                              <option key={si} value={si}>{si}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ── Stage 3: Confirm ────────────────────────────────────────── */}
          {(stage === 'confirm' || stage === 'starting') && (
            <>
              <div style={{ background: '#f0fdf4', border: '1.5px solid #86efac', borderRadius: 12, padding: '14px 16px', marginBottom: 14 }}>
                <p style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: '#166534', marginBottom: 4 }}>Ready to begin</p>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#166534' }}>
                  {holeCount} holes · {totalPlayers} players · Stableford
                </p>
              </div>

              {/* Summary */}
              {localGroups.map(g => (
                <div key={g.id} style={{ marginBottom: 10 }}>
                  <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700, color: '#7a7260', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 4 }}>
                    {g.name}{g.tee_time ? ` · ⏱ ${g.tee_time}` : ''}
                  </p>
                  {g.players.map(p => {
                    const hcp = resolvePlayingHandicap(p.playing_handicap, p.profile_handicap)
                    return (
                      <div key={p.profile_id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #f2e8d0' }}>
                        <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#1a1a16' }}>{p.full_name}</span>
                        <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#7a7260', fontWeight: 600 }}>HCP {hcp}</span>
                      </div>
                    )
                  })}
                </div>
              ))}

              {error && <Warning>{error}</Warning>}
            </>
          )}
        </div>

        {/* Footer — fixed, never scrolls. Holds whichever stage's primary/
            secondary actions apply, so they're always visible regardless
            of how long the scrollable content above happens to be. */}
        <div style={{
          flexShrink: 0, padding: '14px 20px',
          paddingBottom: 'calc(14px + env(safe-area-inset-bottom, 0px))',
          borderTop: '1px solid #e8d9b8', background: '#f8f4eb',
        }}>
          {stage === 'review' && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => setStage('holes')} style={btnStyle('secondary')}>
                Review Holes →
              </button>
              <button type="button" onClick={onClose} style={btnStyle('ghost')}>Cancel</button>
            </div>
          )}

          {stage === 'holes' && (
            <>
              {!canBegin && (
                <Warning>
                  {!hasGroups ? 'No playing groups exist.' :
                    !allGroupsHavePlayers ? 'One or more groups have no players.' :
                    !allPlayersHaveHandicap ? 'One or more players are missing a handicap.' : ''}
                </Warning>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: !canBegin ? 10 : 0 }}>
                <button type="button" onClick={() => setStage('confirm')} disabled={!canBegin} style={btnStyle(canBegin ? 'primary' : 'disabled')}>
                  Review & Confirm →
                </button>
                <button type="button" onClick={() => setStage('review')} style={btnStyle('ghost')}>← Back</button>
              </div>
            </>
          )}

          {(stage === 'confirm' || stage === 'starting') && (
            <div style={{ display: 'flex', gap: 8, flexDirection: 'column' }}>
              <button
                type="button"
                onClick={starting ? undefined : handleBegin}
                disabled={starting}
                style={{ ...btnStyle(starting ? 'disabled' : 'gold'), cursor: starting ? 'not-allowed' : 'pointer' }}
              >
                {starting ? 'Beginning round…' : 'Confirm & Begin Round'}
              </button>
              <button type="button" onClick={() => setStage('holes')} style={btnStyle('ghost')} disabled={starting}>← Edit holes</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Warning({ children }: { children?: React.ReactNode }) {
  return (
    <div style={{
      background: '#fef9ec', border: '1px solid #f5c842',
      borderRadius: 10, padding: '10px 14px', marginTop: 10,
      fontFamily: 'var(--font-body)', fontSize: 12, color: '#7a5c00',
    }}>
      ⚠ {children}
    </div>
  )
}

function btnStyle(variant: 'primary' | 'secondary' | 'ghost' | 'gold' | 'disabled'): React.CSSProperties {
  const base: React.CSSProperties = {
    flex: 1, padding: '14px 18px', borderRadius: 10, border: 'none',
    fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700,
    cursor: variant === 'disabled' ? 'not-allowed' : 'pointer',
    transition: 'all 0.15s', textAlign: 'center',
  }
  if (variant === 'primary')   return { ...base, background: 'linear-gradient(135deg, #2d7a52, #1a4731)', color: '#ffffff', boxShadow: '0 3px 12px rgba(26,71,49,0.35)' }
  if (variant === 'gold')      return { ...base, background: 'linear-gradient(135deg, #c9a84c, #e8c96a, #c9a84c)', color: '#0f2d1c', boxShadow: '0 4px 16px rgba(201,168,76,0.45)' }
  if (variant === 'secondary') return { ...base, background: '#f2e8d0', color: '#1a4731', border: '1.5px solid #d9c9a3' }
  if (variant === 'disabled')  return { ...base, background: '#d9c9a3', color: '#7a7260', opacity: 0.7 }
  return { ...base, background: 'transparent', color: '#7a7260', fontWeight: 500 }
}
