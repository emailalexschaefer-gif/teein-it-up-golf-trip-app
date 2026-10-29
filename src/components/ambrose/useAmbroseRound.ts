'use client'
import { useQuery } from '@tanstack/react-query'
import { getTeamState } from '@/lib/ambrose/teamApi'
import { summariseTeamRound, type TeamRoundSummary } from '@/lib/ambrose/roundSummary'
import type { RawTeamState } from '@/lib/ambrose/teamState'

// Is the selected round an Ambrose round, and how complete is it (by TEAM)? Used by My HQ and My Golf to swap the individual-scorecard numbers and
// controls for the team ones. Disabled (no request) unless `enabled`; a 404 (flag off server-side), error or a round without Ambrose config = not Ambrose.
export function useAmbroseRound(roundId: string | null, enabled: boolean, status?: string): { isAmbrose: boolean; summary: TeamRoundSummary | null; loading: boolean } {
  const q = useQuery<RawTeamState | null>({
    queryKey: ['ambrose-round', roundId],
    queryFn: async () => { const r = await getTeamState((u, i) => fetch(u, i), roundId as string); return r.ok ? (r.state as RawTeamState) : null },
    enabled: enabled && !!roundId, refetchInterval: status === 'active' ? 8000 : false, staleTime: 0,
  })
  const state = q.data ?? null
  const isAmbrose = !!state?.config
  return { isAmbrose, summary: state && isAmbrose ? summariseTeamRound(state) : null, loading: enabled && !!roundId && q.isLoading }
}
