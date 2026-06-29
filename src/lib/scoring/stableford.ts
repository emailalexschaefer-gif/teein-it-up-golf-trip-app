export interface StablefordInput {
  grossScore: number
  par: number
  strokeIndex: number
  playingHandicap: number
}

export function calculateStableford(input: StablefordInput): number {
  const { grossScore, par, strokeIndex, playingHandicap } = input
  const fullStrokes  = Math.floor(playingHandicap / 18)
  const extraStroke  = strokeIndex <= (playingHandicap % 18) ? 1 : 0
  const netScore     = grossScore - (fullStrokes + extraStroke)
  return Math.min(5, Math.max(0, 2 - (netScore - par)))
}
