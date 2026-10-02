/**
 * Event Memories V1.1 Phase 2 (11 Sep) -- EVENT-SUMMARY.txt generator.
 * Pure function over the same extended manifest shape the export
 * builder uses -- no AI, no invented prose, no claim not directly
 * backed by a field this function was actually given. Per the
 * explicit "do not generate creative prose" / "do not claim champion/
 * final standings" instructions: this function has no access to
 * anything beyond its own typed inputs, so it cannot fabricate either
 * even if someone tried to extend it carelessly later.
 */

import type { ExportMemory, ExportResult } from './exportManifest'

export interface SummaryRound {
  id: string
  ordinal: number
  name: string
  courseName: string | null
  playDate: string | null
}

export interface SummarySideGameWinner {
  roundId: string
  label: string
  holeNumber: number | null
  winnerName: string | null
}

export interface SummaryEvent {
  name: string
  startDate: string | null
  endDate: string | null
  playerCount: number
}

/**
 * Builds the plain-text summary. filenameByMomentId must come from the
 * exact same ExportResult the ZIP itself used, so the summary's own
 * filenames always match what's actually in the package -- never a
 * second, independently derived naming pass that could drift.
 */
export interface SummaryChampionResult {
  champions: { playerId: string; playerName: string; totalPoints: number }[]
  hasTie: boolean
  standings: { playerId: string; playerName: string; totalPoints: number; position: number }[]
}

/**
 * championResult: Event Memories V1.3 (13 Sep) -- optional, read
 * verbatim from data.results.champion (eventMemoryData.ts), itself
 * sourced from the authoritative computeFinalResults(), never
 * recalculated here. Undefined/null for a live or incomplete event --
 * the "Champion: not available" line is the correct, honest output in
 * that case, not a placeholder to be filled in later.
 */
export function buildEventSummaryText(
  event: SummaryEvent,
  rounds: SummaryRound[],
  memories: ExportMemory[],
  sideGameWinners: SummarySideGameWinner[],
  exportResult: ExportResult,
  championResult?: SummaryChampionResult | null,
): string {
  const filenameByMomentId = new Map(
    exportResult.entries.filter(e => !e.isFavouriteDuplicate).map(e => [e.momentId, `${e.folderPath}/${e.filename}`])
  )

  const lines: string[] = []
  lines.push("TEEIN' IT UP -- EVENT MEMORY PACKAGE")
  lines.push('')
  lines.push('EVENT')
  lines.push(`Name: ${event.name}`)
  if (event.startDate || event.endDate) {
    lines.push(`Dates: ${event.startDate ?? '?'} to ${event.endDate ?? '?'}`)
  }
  const courses = [...new Set(rounds.map(r => r.courseName).filter((c): c is string => !!c))]
  if (courses.length > 0) lines.push(`Courses: ${courses.join(', ')}`)
  lines.push(`Players: ${event.playerCount}`)
  lines.push(`Rounds: ${rounds.length}`)
  lines.push(`Total Memories: ${exportResult.memoryCount}`)
  lines.push(`Favourite Memories: ${exportResult.favouriteCount}`)

  const eventLevelMemories = memories.filter(m => m.roundId === null).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  if (eventLevelMemories.length > 0) {
    lines.push('')
    lines.push('================================')
    lines.push('')
    lines.push('EVENT-LEVEL MEMORIES')
    lines.push('')
    for (const m of eventLevelMemories) lines.push(...memoryLines(m, filenameByMomentId))
  }

  for (const round of [...rounds].sort((a, b) => a.ordinal - b.ordinal)) {
    const roundMemories = memories
      .filter(m => m.roundId === round.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    lines.push('')
    lines.push('================================')
    lines.push('')
    lines.push(`ROUND ${round.ordinal}${round.name ? ` -- ${round.name}` : ''}`)
    if (round.courseName) lines.push(`Course: ${round.courseName}`)
    if (round.playDate) lines.push(`Date: ${round.playDate}`)

    const generalMemories = roundMemories.filter(m => m.sourceType !== 'SIDE_GAME')
    const sideGameMemories = roundMemories.filter(m => m.sourceType === 'SIDE_GAME')

    if (generalMemories.length > 0) {
      lines.push('')
      lines.push('MOMENTS')
      lines.push('')
      for (const m of generalMemories) lines.push(...memoryLines(m, filenameByMomentId))
    }

    if (sideGameMemories.length > 0) {
      lines.push('')
      lines.push('SIDE GAMES')
      lines.push('')
      const bySideGame = new Map<string, ExportMemory[]>()
      for (const m of sideGameMemories) {
        const key = m.sideCompName ?? 'Side Game'
        const list = bySideGame.get(key) ?? []
        list.push(m)
        bySideGame.set(key, list)
      }
      for (const [gameName, gameMemories] of bySideGame) {
        lines.push(gameName)
        const winner = sideGameWinners.find(w => w.roundId === round.id && w.label === gameName)
        if (winner) {
          lines.push(`Winner: ${winner.winnerName ?? '(unresolved)'}${winner.holeNumber ? ` -- Hole ${winner.holeNumber}` : ''}`)
        }
        for (const m of gameMemories) lines.push(...memoryLines(m, filenameByMomentId, '  '))
        lines.push('')
      }
    }

    if (generalMemories.length === 0 && sideGameMemories.length === 0) {
      lines.push('')
      lines.push('(No Memories captured for this round.)')
    }
  }

  lines.push('')
  lines.push('================================')
  lines.push('')
  lines.push('EVENT RESULT')
  lines.push('')
  if (championResult && championResult.champions.length > 0) {
    const names = championResult.champions.map(c => c.playerName).join(' & ')
    lines.push(`Champion: ${names}${championResult.hasTie ? ' (tie)' : ''}`)
    lines.push(`Winning Score: ${championResult.champions[0].totalPoints} points`)
    lines.push('')
    lines.push('FINAL STANDINGS')
    lines.push('')
    const sortedStandings = [...championResult.standings].sort((a, b) => a.position - b.position)
    sortedStandings.forEach(s => lines.push(`${s.position}. ${s.playerName} \u2014 ${s.totalPoints} points`))
  } else {
    lines.push('Champion: not available in this export.')
  }

  const favourites = memories.filter(m => m.organiserFavourite).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  if (favourites.length > 0) {
    lines.push('')
    lines.push('================================')
    lines.push('')
    lines.push('FAVOURITE HIGHLIGHTS')
    lines.push('')
    favourites.forEach((m, i) => {
      lines.push(`${i + 1}. ${filenameByMomentId.get(m.momentId) ?? '(filename unavailable)'}`)
      if (m.roundOrdinal !== null) lines.push(`   Round: ${m.roundOrdinal}`)
      if (m.holeNumber !== null) lines.push(`   Hole: ${m.holeNumber}`)
      if (m.playerName) lines.push(`   Player: ${m.playerName}`)
      if (m.sourceType === 'SIDE_GAME' && m.sideCompName) lines.push(`   Side Game: ${m.sideCompName}`)
      if (m.caption) lines.push(`   Caption: ${m.caption}`)
      lines.push('')
    })
  }

  return lines.join('\n')
}

function memoryLines(m: ExportMemory, filenameByMomentId: Map<string, string>, indent = ''): string[] {
  const time = m.createdAt.length >= 16 ? m.createdAt.slice(11, 16) : m.createdAt
  const holeText = m.holeNumber !== null ? ` -- Hole ${m.holeNumber}` : ''
  const out: string[] = []
  out.push(`${indent}${time}${holeText}`)
  if (m.playerName) out.push(`${indent}${m.playerName}`)
  out.push(`${indent}${m.sourceType === 'SIDE_GAME' ? `Side Game: ${m.sideCompName ?? ''}` : 'General Moment'}`)
  if (m.organiserFavourite) out.push(`${indent}Favourite: YES`)
  if (m.caption) out.push(`${indent}Caption: ${m.caption}`)
  out.push(`${indent}File: ${filenameByMomentId.get(m.momentId) ?? '(filename unavailable)'}`)
  out.push('')
  return out
}
