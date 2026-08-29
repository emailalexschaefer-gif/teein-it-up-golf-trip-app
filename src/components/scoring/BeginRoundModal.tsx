'use client'

import React, { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { resolvePlayingHandicap, deriveBeginRoundHoles, deriveNineHoles } from '@/lib/scoring/defaultHoles'
import type { HoleTemplate, PlayingNine } from '@/lib/scoring/defaultHoles'
import { calculateDailyHandicap } from '@/lib/scoring/dailyHandicap'
import { useScoringFocusStore } from '@/store/scoringFocusStore'
import BrandLogo from '@/components/brand/BrandLogo'

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
  // Starting Tee — round-level, persisted at round setup time (see
  // holeSequence.ts / migration 067). Defaults to 1 so any caller not
  // yet updated to pass this behaves exactly as before.
  startingHoleNumber?: 1 | 10
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
  // Priority 1 — Daily Handicap. The frozen slope rating for this
  // round's selected tee set (rounds.slope_rating, Course Library
  // migration 041) — absent for a manually-configured round, in which
  // case Daily Handicap calculation falls back to the existing
  // unadjusted resolvePlayingHandicap value, unchanged from before.
  slopeRating?: number | null
}

type Stage = 'review' | 'holes' | 'confirm' | 'starting' | 'released' | 'launching'

export default function BeginRoundModal({
  tripId, roundId, roundName, courseName, holeCount, startingHoleNumber = 1,
  playDate, groups, onClose, libraryHolesSnapshot, teeName, slopeRating,
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
  // Offline Player Support — round-specific scoring method per player,
  // fetched separately from setupContext/localGroups (which come from
  // an existing, unrelated data path this pass deliberately doesn't
  // restructure). Absence of an entry is correctly read as 'digital',
  // matching the scoring-method route's own GET contract and the
  // scorecards.scoring_method column's own DEFAULT.
  const [scoringMethods, setScoringMethods] = useState<Record<string, 'digital' | 'paper'>>({})
  const [savingScoringMethodFor, setSavingScoringMethodFor] = useState<string | null>(null)
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

  async function refetchScoringMethods() {
    try {
      const res = await fetch(`/api/trips/${tripId}/rounds/${roundId}/scoring-method`)
      if (!res.ok) return
      const body = await res.json().catch(() => ({}))
      setScoringMethods(body.methods ?? {})
    } catch { /* ignore — every player is correctly treated as 'digital' by default anyway */ }
  }

  async function toggleScoringMethod(playerId: string) {
    const next = (scoringMethods[playerId] ?? 'digital') === 'digital' ? 'paper' : 'digital'
    setSavingScoringMethodFor(playerId)
    // Optimistic — the badge/toggle should feel instant while forming
    // groups, matching "visually obvious while forming groups" as a
    // real-time property, not one that waits on a round trip.
    setScoringMethods(prev => ({ ...prev, [playerId]: next }))
    try {
      const res = await fetch(`/api/trips/${tripId}/rounds/${roundId}/scoring-method`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, scoringMethod: next }),
      })
      if (!res.ok) {
        // Revert on genuine failure — an organiser silently seeing a
        // badge that didn't actually persist would be worse than a
        // visible failure to flip it.
        setScoringMethods(prev => ({ ...prev, [playerId]: next === 'paper' ? 'digital' : 'paper' }))
      }
    } catch {
      setScoringMethods(prev => ({ ...prev, [playerId]: next === 'paper' ? 'digital' : 'paper' }))
    } finally {
      setSavingScoringMethodFor(null)
    }
  }

  useEffect(() => {
    refetchSetupContext()
    void refetchScoringMethods()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally fetch-once-on-mount; refetchSetupContext is called explicitly after mutations elsewhere, not on every render
  }, [])

  // ── Handicap +/- (Priority 1 — Daily Handicap) ────────────────────────────
  // Reworked: previously this PATCHed trip_members.playing_handicap
  // directly, meaning an organiser's pre-round adjustment permanently
  // changed the golfer's profile-level handicap for every future round
  // too — exactly what "organiser adjustment must affect that round
  // only" rules out. Now purely local state
  // (roundHandicapOverrides, profile_id -> final adjusted value),
  // initialised from the calculated Daily Handicap (GA Handicap x this
  // round's own tee-set Slope Rating / 113 — calculateDailyHandicap,
  // src/lib/scoring/dailyHandicap.ts, previously fully built and tested
  // but never wired in because slope_rating had nowhere to live until
  // Course Library added it to rounds/course_tee_sets) where the round
  // has a library-sourced slope rating, falling back to the existing
  // resolvePlayingHandicap (no slope adjustment) exactly as before when
  // it doesn't — manual course setup is unaffected. Submitted only once,
  // at Start Round, as an explicit override map — nothing is written to
  // trip_members from this screen anymore.
  const [mutationError, setMutationError] = useState('')
  const [pendingProfileId, setPendingProfileId] = useState<string | null>(null)
  const [handicapOverrides, setHandicapOverrides] = useState<Record<string, number>>({})
  // Add-on 2 — Handicap Basis. Default 'daily' preserves this app's
  // existing, already-implicit behaviour exactly (dailyHandicapFor was
  // already the sole baseline for every player before this feature —
  // see baseRoundHandicap below, unchanged in its 'daily' branch). This
  // toggle adds 'exact' as a genuine alternative starting point, not a
  // second handicap formula — 'exact' simply calls the same
  // resolvePlayingHandicap this file already uses elsewhere, with no
  // slope adjustment.
  const [handicapBasis, setHandicapBasis] = useState<'exact' | 'daily'>('daily')

  // Priority 3 — round-specific tee times. groupTeeTimes holds what's
  // actually saved for THIS round (round_group_tee_times, fetched
  // fresh on mount); teeTimeDrafts holds in-progress edits before they're
  // saved, so a half-typed value never gets treated as final. Nothing
  // here reads or writes trip_groups.tee_time — that field's only
  // remaining role (Leaders Last's own group-ordering key) is untouched
  // by this feature, per explicit instruction to preserve it.
  const [groupTeeTimes, setGroupTeeTimes] = useState<Record<string, string | null>>({})
  const [teeTimeDrafts, setTeeTimeDrafts] = useState<Record<string, string>>({})
  const [savingTeeTimeFor, setSavingTeeTimeFor] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    fetch(`/api/trips/${tripId}/rounds/${roundId}/group-tee-times`)
      .then(res => res.ok ? res.json() : null)
      .then(body => {
        if (cancelled || !body) return
        const map: Record<string, string | null> = {}
        for (const row of (body.teeTimes ?? []) as { group_id: string; tee_time: string | null }[]) map[row.group_id] = row.tee_time
        setGroupTeeTimes(map)
      })
      .catch(() => { /* leaves groupTeeTimes empty — the UI shows "TBC" for every group rather than guessing */ })
    return () => { cancelled = true }
  }, [tripId, roundId])

  async function saveGroupTeeTime(groupId: string) {
    const value = teeTimeDrafts[groupId]?.trim() || null
    setSavingTeeTimeFor(groupId)
    try {
      const res = await fetch(`/api/trips/${tripId}/rounds/${roundId}/group-tee-times`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ groupId, teeTime: value }),
      })
      if (res.ok) {
        setGroupTeeTimes(prev => ({ ...prev, [groupId]: value }))
        setTeeTimeDrafts(prev => { const next = { ...prev }; delete next[groupId]; return next })
      }
    } catch { /* draft stays visible so the organiser can retry, rather than silently reverting */ }
    setSavingTeeTimeFor(null)
  }

  // Shotgun Start. startType is a round-level property (rounds.start_type,
  // migration 055) — 'standard' preserves every existing behaviour
  // exactly; only 'shotgun' activates the per-group starting-hole
  // assignment below, mirroring groupTeeTimes' own fetch-draft-save
  // pattern rather than inventing a new one. startingHoleDrafts holds
  // in-progress selections before saving, same reasoning as
  // teeTimeDrafts.
  const [startType, setStartType] = useState<'standard' | 'shotgun'>('standard')
  const [startingHoles, setStartingHoles] = useState<Record<string, number | null>>({})
  const [startingHoleDrafts, setStartingHoleDrafts] = useState<Record<string, number>>({})
  const [savingStartingHoleFor, setSavingStartingHoleFor] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    fetch(`/api/trips/${tripId}/rounds/${roundId}/starting-holes`)
      .then(res => res.ok ? res.json() : null)
      .then(body => {
        if (cancelled || !body) return
        setStartType(body.startType === 'shotgun' ? 'shotgun' : 'standard')
        const map: Record<string, number | null> = {}
        for (const row of (body.startingHoles ?? []) as { group_id: string; starting_hole: number }[]) map[row.group_id] = row.starting_hole
        setStartingHoles(map)
      })
      .catch(() => { /* leaves startType at its default 'standard' — never silently claims shotgun when it can't confirm it */ })
    return () => { cancelled = true }
  }, [tripId, roundId])

  async function setRoundStartType(next: 'standard' | 'shotgun') {
    setStartType(next) // optimistic — this is a low-stakes toggle, not worth a loading state
    try {
      await fetch(`/api/trips/${tripId}/rounds/${roundId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ start_type: next }),
      })
    } catch { /* the value is re-fetched fresh on every mount, so a failed save here just reverts next time this modal opens — no silent inconsistency persists */ }
  }

  async function saveStartingHole(groupId: string) {
    const value = startingHoleDrafts[groupId]
    if (value === undefined) return
    setSavingStartingHoleFor(groupId)
    try {
      const res = await fetch(`/api/trips/${tripId}/rounds/${roundId}/starting-holes`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ groupId, startingHole: value }),
      })
      if (res.ok) {
        setStartingHoles(prev => ({ ...prev, [groupId]: value }))
        setStartingHoleDrafts(prev => { const next = { ...prev }; delete next[groupId]; return next })
      }
    } catch { /* draft stays visible so the organiser can retry */ }
    setSavingStartingHoleFor(null)
  }

  function dailyHandicapFor(gaHandicap: number | null): number | null {
    if (gaHandicap === null) return null
    if (slopeRating != null) {
      try {
        return calculateDailyHandicap({ gaHandicap, slopeRating })
      } catch { /* falls through to the unadjusted value below on any calculation error */ }
    }
    return resolvePlayingHandicap(gaHandicap, null)
  }

  function baseRoundHandicap(p: { profile_id: string; playing_handicap: number | null; profile_handicap: number | null }): number | null {
    const ga = resolvePlayingHandicap(p.playing_handicap, p.profile_handicap)
    // Add-on 2 — 'exact' returns the unadjusted GA handicap directly
    // (the same resolvePlayingHandicap value this file's own missingHcp
    // check, readiness gate, etc. already all use), 'daily' keeps the
    // exact same calculateDailyHandicap path this function already had
    // before this toggle existed. Neither branch is new arithmetic.
    return handicapBasis === 'exact' ? ga : dailyHandicapFor(ga)
  }

  function currentRoundHandicap(p: { profile_id: string; playing_handicap: number | null; profile_handicap: number | null }): number | null {
    if (p.profile_id in handicapOverrides) return handicapOverrides[p.profile_id]
    return baseRoundHandicap(p)
  }

  function setLocalGroups(updater: (prev: Group[]) => Group[]) {
    setSetupContext(prev => prev ? { ...prev, groups: updater(prev.groups) } : prev)
  }

  function handleHandicapAdjust(profileId: string, delta: 1 | -1) {
    setMutationError('')
    const currentPlayer = localGroups.flatMap(g => g.players).find(p => p.profile_id === profileId)
    if (!currentPlayer) return
    const current = currentRoundHandicap(currentPlayer) ?? 0
    setHandicapOverrides(prev => ({ ...prev, [profileId]: current + delta }))
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
    return deriveBeginRoundHoles(libraryHolesSnapshot, holeCount, startingHoleNumber)
  })
  // Playing Nine — meaningful for 9-hole rounds (front/back/custom, as
  // before). For an 18-hole round, this stays unread and unused exactly
  // as before Starting Tee existed — an 18-hole/10th-tee round's play
  // order (10-18, 1-9) is fully determined by deriveBeginRoundHoles
  // above already having built `holes` in the correct sequence; there
  // is no separate "which nine" choice to make for it here, since it
  // plays every hole either way. Initialised FROM startingHoleNumber
  // (already decided at round setup, before this modal ever opens)
  // rather than always defaulting to 'front' — so a 9-hole/10th-tee
  // round opens this modal already correctly showing Back, not
  // silently reverting to Front until the organiser notices and
  // re-selects it.
  const [playingNine, setPlayingNine] = useState<PlayingNine>(startingHoleNumber === 10 ? 'back' : 'front')

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
  const allGroupsHaveTeeTimes = localGroups.every(g => g.tee_time)
  const allStartingHolesSet = startType !== 'shotgun' || localGroups.every(g => startingHoles[g.id] != null)

  // Item 8 — readiness summary, driven by the exact same checks that
  // already gate the button below (not a second, parallel readiness
  // model) — this just also surfaces them as individual line items.
  const readinessItems = [
    { label: `${totalPlayers} player${totalPlayers === 1 ? '' : 's'} assigned`, ok: hasGroups && allGroupsHavePlayers },
    { label: `${localGroups.length} group${localGroups.length === 1 ? '' : 's'} complete`, ok: hasGroups && allGroupsHavePlayers },
    { label: 'Handicaps confirmed', ok: allPlayersHaveHandicap },
    { label: 'Tee times set', ok: allGroupsHaveTeeTimes },
    { label: startType === 'shotgun' ? 'Shotgun Start selected' : 'Standard Start selected', ok: true },
    ...(startType === 'shotgun' ? [{ label: 'Starting holes confirmed', ok: allStartingHolesSet }] : []),
  ]

  const canBegin = hasGroups && allGroupsHavePlayers && allPlayersHaveHandicap && allGroupsHaveTeeTimes && allStartingHolesSet

  // Item 7 — Begin Round simplification. Valid library data means every
  // hole in this round's frozen snapshot actually has a par and stroke
  // index set (a partially-populated tee set — e.g. Flinders' still-
  // unresolved distance total — can still be genuinely valid here,
  // since par/SI are what the organiser actually needs to skip the
  // editor for; distance is a bonus, not a gate). Manual/generic-
  // template rounds have no snapshot at all and correctly always fall
  // through to the existing full editor, unchanged.
  const hasValidLibraryData = !!libraryHolesSnapshot && libraryHolesSnapshot.length === holeCount
    && libraryHolesSnapshot.every(h => h.par != null && h.stroke_index != null)

  async function handleRelease() {
    setStarting(true); setError(null)
    try {
      const res = await fetch(`/api/trips/${tripId}/rounds/${roundId}/release`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? "We couldn't release this round. Please try again.")
        setStage('confirm')
        return
      }
      // Package 2 — deliberately does NOT navigate away or call
      // begin_round()/start here. Release only publishes the Starting
      // Grid to players; the round stays 'upcoming' until the organiser
      // separately taps Start Round. This is the one architectural
      // change Package 2 is actually about — previously this single
      // button did both at once.
      setStage('released')
    } catch {
      setError("We couldn't release this round. Please try again.")
      setStage('confirm')
    } finally {
      setStarting(false)
    }
  }

  async function handleStartRound() {
    setStage('launching'); setError(null)
    let staySpinning = false
    try {
      const res = await fetch(`/api/trips/${tripId}/rounds/${roundId}/start`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        // Add-on 2 — sends the FULL resolved handicap for every player
        // (currentRoundHandicap, basis-aware), not just the sparse
        // manual-adjustment entries in handicapOverrides state. The
        // /start endpoint's own logic (unchanged) always recomputes
        // calculateDailyHandicap for any player NOT present in this
        // map — sending only the delta-style overrides would make the
        // Exact HCP basis completely inert for every player Darren
        // didn't personally nudge with +/-, since the server has no
        // other way to learn which basis was chosen. Every player now
        // has an explicit resolved value here, so the server's
        // existing "override present -> use it, else compute Daily"
        // branch naturally honours whichever basis the client
        // resolved to, without the server needing to know about
        // handicapBasis as a separate concept at all.
        body: JSON.stringify({
          holes,
          handicapOverrides: Object.fromEntries(
            localGroups.flatMap(g => g.players).map(p => [p.profile_id, currentRoundHandicap(p) ?? 0])
          ),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 404) {
          setError((data.error ?? 'This round no longer exists.') + ' Refreshing…')
          router.refresh()
          staySpinning = true
          setTimeout(() => onClose(), 1500)
          return
        }
        setError(data.error ?? "We couldn't start the round. Please try again.")
        setStage('released')
        return
      }
      staySpinning = true
      router.push(`/trips/${tripId}/rounds/${roundId}`)
      router.refresh()
    } catch {
      setError("We couldn't start the round. Please try again.")
      setStage('released')
    } finally {
      if (!staySpinning) setStage('released')
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

  // Release 2, item 7 — Start Round polish. A dedicated render branch
  // for the final ready state, bypassing the shared administrative
  // header/stage-progress-dots entirely — this is the moment the event
  // goes live, not another setup step, so it gets its own celebratory
  // full-screen treatment rather than reusing the "Begin Round" chrome
  // every earlier stage shares. Deliberately does NOT touch
  // handleStartRound/handleRelease or any start-round API/lifecycle/
  // validation — same handlers, same behaviour, only the presentation
  // around them changed. BrandLogo is the existing shared logo
  // component already used on login/landing/headers elsewhere in the
  // app — no new image asset.
  if (stage === 'released' || stage === 'launching') {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'linear-gradient(180deg, #0f2d1c, #1a4731)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '24px 24px calc(24px + env(safe-area-inset-bottom, 0px))',
        paddingTop: 'calc(24px + env(safe-area-inset-top, 0px))',
        textAlign: 'center',
      }}>
        <button
          type="button" onClick={onClose}
          style={{
            position: 'absolute', top: 'calc(16px + env(safe-area-inset-top, 0px))', right: 16,
            background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 8, padding: '6px 12px',
            fontFamily: 'var(--font-body)', color: 'rgba(245,230,184,0.7)', fontSize: 13, cursor: 'pointer',
          }}
        >
          ✕
        </button>

        <div style={{ marginBottom: 28 }}>
          <BrandLogo variant="icon" size={64} />
        </div>

        <p style={{ fontFamily: 'var(--font-body)', color: 'rgba(245,230,184,0.65)', fontSize: 12, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8 }}>
          Ready to Tee Off?
        </p>
        <h1 style={{ fontFamily: 'var(--font-display)', color: '#fff', fontSize: 26, fontWeight: 800, margin: '0 0 4px' }}>
          {roundName}
        </h1>
        {courseName && (
          <p style={{ fontFamily: 'var(--font-body)', color: 'rgba(245,230,184,0.75)', fontSize: 14, margin: '0 0 24px' }}>
            {courseName}
          </p>
        )}

        <div style={{
          background: 'rgba(22,163,74,0.15)', border: '1px solid rgba(187,247,208,0.4)', borderRadius: 10,
          padding: '10px 18px', marginBottom: 28,
        }}>
          <span style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, color: '#bbf7d0' }}>
            ✓ Round Ready — Released to Players
          </span>
        </div>

        <div style={{ width: '100%', maxWidth: 340, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button
            type="button"
            onClick={stage === 'launching' ? undefined : handleStartRound}
            disabled={stage === 'launching'}
            style={{
              padding: '16px 18px', borderRadius: 12, border: 'none',
              background: stage === 'launching' ? '#6b7563' : 'linear-gradient(135deg,#2d7a52,#16a34a)',
              color: '#fff', fontFamily: 'var(--font-body)', fontWeight: 800, fontSize: 16,
              cursor: stage === 'launching' ? 'not-allowed' : 'pointer',
              boxShadow: stage === 'launching' ? 'none' : '0 4px 16px rgba(22,163,74,0.35)',
            }}
          >
            {stage === 'launching' ? 'Starting round…' : '▶ Start Round'}
          </button>
          <button
            type="button" onClick={() => setStage('confirm')} disabled={stage === 'launching'}
            style={{
              padding: '12px 18px', borderRadius: 10, border: '1px solid rgba(245,230,184,0.3)',
              background: 'transparent', color: 'rgba(245,230,184,0.8)',
              fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13.5,
              cursor: stage === 'launching' ? 'not-allowed' : 'pointer',
            }}
          >
            Edit Round Setup
          </button>
        </div>
      </div>
    )
  }

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
                const groupTimes = localGroups.map(g => groupTeeTimes[g.id]).filter(Boolean).sort() as string[]
                const teeTimeDisplay = groupTimes.length === 0 ? 'TBC'
                  : groupTimes.length === 1 ? groupTimes[0]
                  : `${groupTimes[0]}–${groupTimes[groupTimes.length - 1]}`
                const detailRows = [
                  ['📅 Date', formattedDate],
                  ['⏱ First tee', teeTimeDisplay],
                  ['⛳ Holes', String(holeCount)],
                  ['🏆 Format', 'Stableford'],
                  ...(courseName ? [['📍 Course', courseName]] : []),
                  ...(teeName ? [['⛳ Tees', teeName]] : []),
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

              {/* Shotgun Start — round-level toggle. Standard remains
                  the default and preserves existing behaviour exactly;
                  selecting Shotgun reveals the per-group starting-hole
                  selectors below, nothing else changes here. */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                {(['standard', 'shotgun'] as const).map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => void setRoundStartType(t)}
                    style={{
                      flex: 1, padding: '9px 0', borderRadius: 8, fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                      background: startType === t ? '#1a4731' : '#f3f4f6',
                      color: startType === t ? '#fff' : '#374151',
                      border: startType === t ? 'none' : '1px solid #d1d5db',
                    }}
                  >
                    {t === 'standard' ? 'Standard Start' : 'Shotgun Start'}
                  </button>
                ))}
              </div>

              {/* Add-on 2 — Handicap Basis. Visually consistent with the
                  Standard/Shotgun control immediately above (same
                  segmented-button pattern, same sizing), placed directly
                  below it per the explicit instruction. Switching basis
                  deliberately clears every manual +/- override (item
                  12's "selecting a basis establishes a new starting
                  point; individual +/- changes happen afterward") —
                  otherwise a stale override from the previous basis
                  would silently survive and mask the new baseline. */}
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700, color: '#7a7260', marginBottom: 6, letterSpacing: 0.3 }}>
                HANDICAP BASIS
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                {(['exact', 'daily'] as const).map(basis => (
                  <button
                    key={basis}
                    type="button"
                    onClick={() => { setHandicapBasis(basis); setHandicapOverrides({}) }}
                    style={{
                      flex: 1, padding: '9px 0', borderRadius: 8, fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                      background: handicapBasis === basis ? '#1a4731' : '#f3f4f6',
                      color: handicapBasis === basis ? '#fff' : '#374151',
                      border: handicapBasis === basis ? 'none' : '1px solid #d1d5db',
                    }}
                  >
                    {basis === 'exact' ? 'Exact HCP' : 'Daily HCP'}
                  </button>
                ))}
              </div>
              {handicapBasis === 'daily' && slopeRating == null && (
                <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#a1791f', marginTop: -6, marginBottom: 12 }}>
                  No slope rating found for this round&apos;s course/tee — Daily HCP is showing unadjusted values. Set up the course via the Course Library to enable the slope calculation.
                </p>
              )}

              {localGroups.map(g => {
                const missingHcp = g.players.filter(p => resolvePlayingHandicap(p.playing_handicap, p.profile_handicap) === null)
                // Offline Player Support, item 3 — informational only,
                // computed from the same scoringMethods state the
                // toggle/badge above already reads, never a separate
                // source of truth. Never moves players between groups —
                // this is purely a hint string.
                const paperCount = g.players.filter(p => (scoringMethods[p.profile_id] ?? 'digital') === 'paper').length
                return (
                  <div key={g.id} style={{
                    background: '#ffffff', border: '1.5px solid #d9c9a3',
                    borderRadius: 12, padding: '12px 14px', marginBottom: 10,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
                      <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, color: '#1a4731' }}>{g.name}</span>
                      {/* Priority 3 — this round's own tee time, editable
                          directly here rather than a passive badge.
                          Reads/writes round_group_tee_times only —
                          editing this can never touch another round's
                          saved value, since each row is keyed by
                          (round_id, group_id). Unset shows as "TBC",
                          never silently inherited from a prior round. */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                        <input
                          type="time"
                          value={teeTimeDrafts[g.id] ?? groupTeeTimes[g.id] ?? ''}
                          onChange={e => setTeeTimeDrafts(prev => ({ ...prev, [g.id]: e.target.value }))}
                          style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: '#7a5c00', border: '1px solid rgba(201,168,76,0.4)', borderRadius: 6, padding: '2px 6px', width: 88 }}
                        />
                        {g.id in teeTimeDrafts && teeTimeDrafts[g.id] !== (groupTeeTimes[g.id] ?? '') && (
                          <button
                            type="button"
                            onClick={() => void saveGroupTeeTime(g.id)}
                            disabled={savingTeeTimeFor === g.id}
                            style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 700, color: '#fff', background: '#1a4731', border: 'none', borderRadius: 5, padding: '3px 7px', cursor: 'pointer' }}
                          >
                            {savingTeeTimeFor === g.id ? '…' : 'Save'}
                          </button>
                        )}
                      </div>
                    </div>
                    {/* Shotgun Start — only shown when this round is
                        actually configured as shotgun. Only holes that
                        exist in this round's own configuration
                        (holeCount) are offered, per "use only holes
                        that actually exist in the configured round." */}
                    {startType === 'shotgun' && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                        <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#7a5c00', fontWeight: 700 }}>Start hole:</span>
                        <select
                          value={startingHoleDrafts[g.id] ?? startingHoles[g.id] ?? ''}
                          onChange={e => setStartingHoleDrafts(prev => ({ ...prev, [g.id]: Number(e.target.value) }))}
                          style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: '#1a4731', border: '1px solid rgba(201,168,76,0.4)', borderRadius: 6, padding: '2px 6px' }}
                        >
                          <option value="" disabled>Select…</option>
                          {Array.from({ length: holeCount }, (_, i) => i + 1).map(h => (
                            <option key={h} value={h}>Hole {h}</option>
                          ))}
                        </select>
                        {g.id in startingHoleDrafts && startingHoleDrafts[g.id] !== startingHoles[g.id] && (
                          <button
                            type="button"
                            onClick={() => void saveStartingHole(g.id)}
                            disabled={savingStartingHoleFor === g.id}
                            style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 700, color: '#fff', background: '#1a4731', border: 'none', borderRadius: 5, padding: '3px 7px', cursor: 'pointer' }}
                          >
                            {savingStartingHoleFor === g.id ? '…' : 'Save'}
                          </button>
                        )}
                      </div>
                    )}
                    {g.players.length === 0 ? (
                      <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#b45309' }}>⚠ No players assigned to this group.</p>
                    ) : (
                      g.players.map(p => {
                        const gaHcp = resolvePlayingHandicap(p.playing_handicap, p.profile_handicap)
                        const hcp = currentRoundHandicap(p)
                        const dailyDiffersFromGa = slopeRating != null && gaHcp !== null && hcp !== null && hcp !== gaHcp
                        return (
                          <div key={p.profile_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 0', marginBottom: 4, gap: 8, flexWrap: 'wrap' }}>
                            <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#1a1a16', fontWeight: 500, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.full_name}</span>

                            {/* Offline Player Support, items 1-2 — round-
                                specific scoring method toggle + badge,
                                visible right here on the group row while
                                the organiser is actively arranging the
                                Starting Grid, per the explicit "so he can
                                deliberately place paper players
                                together." A plain toggle button, not a
                                separate screen — flipping it immediately
                                shows/hides the ✏️ PAPER badge. */}
                            <button
                              type="button"
                              onClick={() => void toggleScoringMethod(p.profile_id)}
                              disabled={savingScoringMethodFor === p.profile_id}
                              style={{
                                fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 800, flexShrink: 0,
                                padding: '3px 8px', borderRadius: 6, cursor: 'pointer',
                                background: (scoringMethods[p.profile_id] ?? 'digital') === 'paper' ? '#fdf3d9' : '#f3f4f6',
                                border: `1px solid ${(scoringMethods[p.profile_id] ?? 'digital') === 'paper' ? '#e8c96a' : '#d1d5db'}`,
                                color: (scoringMethods[p.profile_id] ?? 'digital') === 'paper' ? '#a1791f' : '#6b7280',
                              }}
                            >
                              {(scoringMethods[p.profile_id] ?? 'digital') === 'paper' ? '✏️ PAPER' : '📱 Digital'}
                            </button>

                            {/* Inline +/- handicap controls — replaces the
                                passive HCP badge entirely, per the explicit
                                "no Edit button, no modal" requirement. Only
                                shown once setup context has loaded, so a
                                tap can never silently no-op against a null
                                context.
                                Priority 1 — the value shown/adjusted here
                                is now the calculated Daily Handicap (this
                                round's own tee-set slope rating applied),
                                not the raw GA Handicap directly. When the
                                two differ, the GA figure is shown small
                                alongside it so the organiser can see both
                                explicitly, per "clearly show GA/Exact
                                Handicap and calculated Daily/Playing
                                Handicap." +/- adjusts only the local
                                override for this round — nothing here
                                writes to trip_members anymore. */}
                            {setupContext && !setupContextLoading ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                                <button
                                  type="button"
                                  onClick={() => handleHandicapAdjust(p.profile_id, -1)}
                                  aria-label={`Decrease ${p.full_name}'s handicap`}
                                  style={{ width: 30, height: 30, borderRadius: 8, border: '1.5px solid #d9c9a3', background: '#faf6ed', color: '#1a4731', fontWeight: 800, fontSize: 15, cursor: 'pointer' }}
                                >−</button>
                                <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: hcp !== null ? '#7a7260' : '#b91c1c', fontWeight: 700, minWidth: 52, textAlign: 'center', lineHeight: 1.2 }}>
                                  {hcp !== null ? `HCP ${hcp}` : '⚠ No HCP'}
                                  {dailyDiffersFromGa && (
                                    <div style={{ fontSize: 9, fontWeight: 600, color: '#a1a89c' }}>GA {gaHcp}</div>
                                  )}
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
                    {paperCount === 1 && (
                      <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#a1791f', marginTop: 6 }}>
                        ✏️ 1 paper-scorecard player — another golfer should check/sign their physical card.
                      </p>
                    )}
                    {paperCount >= 2 && (
                      <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#a1791f', marginTop: 6 }}>
                        ✏️ {paperCount} paper-scorecard players — they can mark/check each other&apos;s physical cards.
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
                    const hcp = currentRoundHandicap(p)
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* Item 7 — when this round's course/tee already has valid
                  library data, the primary action skips straight to
                  Start Round (the 'confirm' stage) instead of forcing
                  the full par/SI editor every time. "Edit holes &
                  indexes" remains available as an explicit secondary
                  action for the genuine last-minute-change case, per
                  "Provide secondary: Edit holes & indexes". Rounds
                  without valid library data (manual setup, or created
                  before Course Library existed) are completely
                  unaffected — same single "Review Holes →" button as
                  before, unconditionally opening the editor. */}
              {hasValidLibraryData ? (
                <>
                  <button type="button" onClick={() => setStage('confirm')} style={btnStyle('primary')}>
                    Start Round →
                  </button>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" onClick={() => setStage('holes')} style={{ ...btnStyle('ghost'), flex: 1 }}>
                      Edit holes & indexes
                    </button>
                    <button type="button" onClick={onClose} style={{ ...btnStyle('ghost'), flex: 1 }}>Cancel</button>
                  </div>
                </>
              ) : (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" onClick={() => setStage('holes')} style={btnStyle('secondary')}>
                    Review Holes →
                  </button>
                  <button type="button" onClick={onClose} style={btnStyle('ghost')}>Cancel</button>
                </div>
              )}
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
              {/* Item 8 — readiness summary. Same checks driving canBegin
                  below, just also shown as individual line items so the
                  organiser can see exactly what's outstanding rather than
                  a single opaque disabled button. */}
              <div style={{ background: '#faf9f6', border: '1px solid #eceae3', borderRadius: 10, padding: '10px 12px', marginBottom: 4 }}>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 700, color: '#a1791f', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>
                  Round Readiness
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {readinessItems.map((item, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-body)', fontSize: 12, color: item.ok ? '#374151' : '#a1791f' }}>
                      <span>{item.ok ? '✅' : '⚠️'}</span>
                      <span>{item.label}{!item.ok && !item.label.includes('selected') ? ' — incomplete' : ''}</span>
                    </div>
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={starting ? undefined : handleRelease}
                disabled={starting}
                style={{ ...btnStyle(starting ? 'disabled' : 'gold'), cursor: starting ? 'not-allowed' : 'pointer' }}
              >
                {starting ? 'Releasing…' : 'Confirm & Release to Players'}
              </button>
              <button type="button" onClick={() => setStage('holes')} style={btnStyle('ghost')} disabled={starting}>← Edit holes</button>
            </div>
          )}

          {/* Package 2 — the released-but-not-live state. Release only
              publishes the Starting Grid (rounds.setup_released); it
              never touches rounds.status or creates scorecards.
              Starting the round remains the organiser's own separate,
              deliberate action, matching "it should not start the
              round" and "starting the round remains a deliberate
              action when players are physically ready to play."
              Release 2, item 7 — this stage now has its own dedicated
              celebratory render, returned early above, before this
              shared header/body wrapper is ever reached — this branch
              is intentionally unreachable code left removed below. */}
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
