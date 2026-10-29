// Package 4 / M2 -- optional selected-drive tracking. PURE. When minDrivesPerPlayer is null nothing here is used and no UI step appears.
export interface DriveRow { playerId: string; name: string; used: number; required: number; met: boolean }

export function driveProgress(rosterPlayers: { playerId: string; name: string }[], drivePlayerIds: (string | null | undefined)[], minDrivesPerPlayer: number | null): DriveRow[] | null {
  if (minDrivesPerPlayer === null) return null
  return rosterPlayers.map(p => {
    const used = drivePlayerIds.filter(id => id === p.playerId).length
    return { playerId: p.playerId, name: p.name, used, required: minDrivesPerPlayer, met: used >= minDrivesPerPlayer }
  })
}

/** Can the minimum still be met with the holes left? (a gentle on-course warning, never a penalty or a block) */
export function driveRiskMessage(rows: DriveRow[] | null, holesRemaining: number): string | null {
  if (!rows) return null
  const needed = rows.reduce((a, r) => a + Math.max(0, r.required - r.used), 0)
  if (needed === 0) return null
  return needed > holesRemaining
    ? `Minimum drives can no longer be met by the end of the round (${needed} needed, ${holesRemaining} hole${holesRemaining === 1 ? '' : 's'} left). The organiser can resolve this.`
    : `${needed} more drive${needed === 1 ? '' : 's'} needed from ${rows.filter(r => !r.met).map(r => r.name).join(', ')}.`
}

export function drivesByPlayerCount(drivePlayerIds: (string | null | undefined)[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const id of drivePlayerIds) if (id) m.set(id, (m.get(id) ?? 0) + 1)
  return m
}
