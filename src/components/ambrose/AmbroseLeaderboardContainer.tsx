'use client'
import { useMemo } from 'react'
import AmbroseLeaderboard from './AmbroseLeaderboard'
import { useTeamRound } from './useTeamRound'
import { deriveEntryViews, deriveLeaderboard } from '@/lib/ambrose/teamState'
import { card, body } from './styles'

// Gross leaderboard from ACCEPTED server records only. A score still waiting on someone's phone is not counted until the server has it.
export default function AmbroseLeaderboardContainer({ roundId, roundLabel }: { roundId: string; roundLabel: string }) {
  const { state, error } = useTeamRound(roundId)
  const lb = useMemo(() => (state ? deriveLeaderboard(deriveEntryViews(state), state.names) : null), [state])
  if (!lb) return <div style={card}><p role="status" style={body}>{error ?? 'Loading the leaderboard…'}</p></div>
  return <AmbroseLeaderboard ranked={lb.ranked} unranked={lb.unranked} roundLabel={roundLabel} netNote="Net results are switched off until the handicap rules are verified." />
}
