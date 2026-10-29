'use client'

import AmbroseScorerContainer from './AmbroseScorerContainer'
import AmbroseLeaderboardContainer from './AmbroseLeaderboardContainer'
import { useTeamRound } from './useTeamRound'

// A player's Ambrose view for the selected round, mounted by the player round screen behind the feature flag: their own team's scorecard (if they are
// on a team) and the gross leaderboard. Renders nothing for a round that is not an Ambrose round, so the normal player screen is untouched.
export default function AmbrosePlayerSection({ roundId, roundLabel }: { roundId: string; roundLabel: string }) {
  const { state, viewerId } = useTeamRound(roundId)
  if (!state || !state.config) return null
  const onATeam = !!viewerId && state.members.some(m => m.player_id === viewerId)
  return (
    <div aria-label="Ambrose">
      {onATeam && <AmbroseScorerContainer roundId={roundId} />}
      {state.round.status !== 'upcoming' && <AmbroseLeaderboardContainer roundId={roundId} roundLabel={roundLabel} />}
    </div>
  )
}
