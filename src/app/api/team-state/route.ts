import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { handleTeamStateRead, type RawTeamState } from '@/lib/ambrose/teamState'
import { ambroseEnabled, ambroseEnabledForTrip } from '@/lib/ambrose/featureFlag'

// Package 4 / M2 -- READ one round's team state. Uses the signed-in user's own client so row-level security decides what is visible
// (a non-member sees "not found", never someone else's data). Reads only; every write goes through the team action routes.
export async function GET(request: Request) {
  const supabase = await createClient()
  const roundId = new URL(request.url).searchParams.get('round_id')
  const result = await handleTeamStateRead(roundId, {
    enabled: () => ambroseEnabled(),
    tripAllowed: (tripId) => ambroseEnabledForTrip(tripId),
    getUser: async () => { const { data: { user }, error } = await supabase.auth.getUser(); return error || !user ? null : { id: user.id } },
    load: async (id): Promise<RawTeamState | null> => {
      const round = await supabase.from('rounds').select('id, trip_id, status, setup_released').eq('id', id).maybeSingle()
      if (round.error) throw round.error
      if (!round.data) return null
      const [holes, config, entries, members, teams] = await Promise.all([
        supabase.from('holes').select('id, hole_number, par').eq('round_id', id),
        supabase.from('round_competition_config').select('format, team_size, handicap_method, min_drives_per_player, setup_reopened_at').eq('round_id', id).maybeSingle(),
        supabase.from('round_team_entries').select('id, team_id, entry_name, nominated_scorer_id, scorer_confirmed_at, handicap_locked_at, team_handicap, status, drive_requirement_waived_at, group_id').eq('round_id', id),
        supabase.from('round_team_members').select('entry_id, player_id, position').eq('round_id', id),
        supabase.from('competition_teams').select('id, name').eq('trip_id', round.data.trip_id as string).eq('status', 'active'),
      ])
      for (const r of [holes, config, entries, members, teams]) if (r.error) throw r.error
      const entryIds = (entries.data ?? []).map(e => e.id as string)
      const [scores, flags] = entryIds.length === 0 ? [{ data: [], error: null }, { data: [], error: null }] : await Promise.all([
        supabase.from('team_score_entries').select('entry_id, hole_id, gross_score, is_no_return, nr_treatment, revision, admin_overridden, drive_player_id').in('entry_id', entryIds),
        supabase.from('team_score_flags').select('id, entry_id, hole_id, status').in('entry_id', entryIds),
      ])
      if (scores.error) throw scores.error
      if (flags.error) throw flags.error
      const completions = await Promise.all(entryIds.map(async eid => {
        const c = await supabase.rpc('team_entry_completion', { p_entry_id: eid })
        if (c.error) throw c.error
        return [eid, c.data] as const
      }))
      const playerIds = [...new Set((members.data ?? []).map(m => m.player_id as string))]
      const names: Record<string, string> = {}
      if (playerIds.length > 0) {
        const prof = await supabase.from('profiles').select('id, full_name').in('id', playerIds)
        if (prof.error) throw prof.error
        for (const p of prof.data ?? []) names[p.id as string] = (p.full_name as string) ?? 'Player'
      }
      return { round: round.data as RawTeamState['round'], holes: (holes.data ?? []) as RawTeamState['holes'], config: (config.data ?? null) as RawTeamState['config'],
        entries: (entries.data ?? []) as RawTeamState['entries'], teams: (teams.data ?? []) as RawTeamState['teams'], members: (members.data ?? []) as RawTeamState['members'],
        scores: (scores.data ?? []) as RawTeamState['scores'], sqlCompletion: Object.fromEntries(completions) as RawTeamState['sqlCompletion'], flags: (flags.data ?? []) as RawTeamState['flags'], names }
    },
  })
  return NextResponse.json(result.body, { status: result.status, headers: { 'Cache-Control': 'no-store' } })
}
