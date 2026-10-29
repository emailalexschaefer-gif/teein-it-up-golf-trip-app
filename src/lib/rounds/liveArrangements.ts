// Package 2 -- server-side loader: what the organiser's CURRENT (live) setup would release for a round.
// Reads the same tables the existing Begin Round / Starting Grid code already uses; adds nothing new.
import type { createAdminClient } from '@/lib/supabase/admin'
import { resolveRoundHandicap, type ArrangementRow } from '@/lib/rounds/arrangements'

type Admin = ReturnType<typeof createAdminClient>

export interface LiveRound { id: string; name: string; status: string; start_type: string | null; starting_hole_number: number | null; slope_rating: number | null }
export interface LiveResult {
  rows: ArrangementRow[]
  /** What would block a release (empty = ready). Never papered over with defaults. */
  problems: string[]
  readiness: { playersAssigned: number; playersTotal: number; groupsComplete: number; groupsTotal: number; handicapsConfirmed: number; teeTimesSet: number; startingHolesComplete: boolean }
  names: Record<string, string>
}

export async function loadLiveArrangements(admin: Admin, tripId: string, round: LiveRound, handicapAllocations?: Record<string, number>, opts?: { handicapsOptional?: boolean }): Promise<LiveResult> {
  const [tripRes, membersRes, groupsRes, roundTeeRes, startingHolesRes] = await Promise.all([
    admin.from('trips').select('organiser_is_playing').eq('id', tripId).maybeSingle(),
    admin.from('trip_members').select('profile_id, role, group_id, playing_handicap, profiles:profile_id(handicap, full_name)').eq('trip_id', tripId),
    admin.from('trip_groups').select('id, name, tee_time').eq('trip_id', tripId),
    admin.from('round_group_tee_times').select('group_id, tee_time').eq('round_id', round.id),
    admin.from('round_group_starting_holes').select('group_id, starting_hole').eq('round_id', round.id),
  ])
  const organiserIsPlaying = tripRes.data?.organiser_is_playing ?? false
  type M = { profile_id: string; role: string; group_id: string | null; playing_handicap: number | null; profiles: { handicap: number | null; full_name: string } | null }
  const members = ((membersRes.data ?? []) as unknown as M[]).filter(m => m.role === 'player' || (m.role === 'organiser' && organiserIsPlaying))
  const groups = (groupsRes.data ?? []) as { id: string; name: string; tee_time: string | null }[]
  const groupById = new Map(groups.map(g => [g.id, g]))
  // Same hierarchy the Starting Grid always used: a round-specific tee time wins, else the group's own.
  const roundTee = new Map(((roundTeeRes.data ?? []) as { group_id: string; tee_time: string | null }[]).map(r => [r.group_id, r.tee_time]))
  const holeByGroup = new Map(((startingHolesRes.data ?? []) as { group_id: string; starting_hole: number }[]).map(r => [r.group_id, r.starting_hole]))
  const isShotgun = round.start_type === 'shotgun'
  const teeFor = (gid: string) => roundTee.get(gid) ?? groupById.get(gid)?.tee_time ?? null
  const holeFor = (gid: string) => isShotgun ? (holeByGroup.get(gid) ?? null) : (round.starting_hole_number === 10 ? 10 : 1)

  const problems: string[] = []
  const rows: ArrangementRow[] = []
  const names: Record<string, string> = {}
  let handicapsConfirmed = 0
  for (const m of members) {
    names[m.profile_id] = m.profiles?.full_name ?? 'Player'
    // Gross-only Ambrose (opts.handicapsOptional, decided server-side by lib/ambrose/handicapPolicy): a missing handicap is stored as 0 (unused), as Begin Round already does.
    const resolved = resolveRoundHandicap({ override: handicapAllocations?.[m.profile_id], tripHandicap: m.playing_handicap, profileHandicap: m.profiles?.handicap, slopeRating: round.slope_rating })
    const hcp = resolved === null && opts?.handicapsOptional ? 0 : resolved
    if (hcp !== null) handicapsConfirmed++
    if (!m.group_id || !groupById.has(m.group_id) || hcp === null) continue
    rows.push({ player_id: m.profile_id, group_id: m.group_id, group_name: groupById.get(m.group_id)!.name ?? null, tee_time: teeFor(m.group_id), starting_hole: holeFor(m.group_id), playing_handicap: hcp })
  }
  const groupIdsWithPlayers = new Set(members.filter(m => m.group_id).map(m => m.group_id as string))
  const readiness = {
    playersAssigned: members.filter(m => m.group_id != null).length, playersTotal: members.length,
    groupsComplete: groups.filter(g => groupIdsWithPlayers.has(g.id)).length, groupsTotal: groups.length,
    handicapsConfirmed, teeTimesSet: groups.filter(g => teeFor(g.id)).length,
    startingHolesComplete: !isShotgun || groups.every(g => holeByGroup.has(g.id)),
  }
  if (readiness.playersTotal === 0) problems.push('No players to release.')
  if (readiness.playersAssigned !== readiness.playersTotal) problems.push('Every player must be assigned to a group.')
  if (readiness.groupsTotal === 0 || readiness.groupsComplete !== readiness.groupsTotal) problems.push('Every group needs at least one player.')
  if (readiness.handicapsConfirmed !== readiness.playersTotal) problems.push('Every player needs a playing handicap.')
  if (readiness.teeTimesSet !== readiness.groupsTotal) problems.push('Every group needs a tee time.')
  if (!readiness.startingHolesComplete) problems.push('Every group needs a starting hole for a shotgun start.')
  return { rows, problems, readiness, names }
}
