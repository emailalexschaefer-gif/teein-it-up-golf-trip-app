'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getTeamState } from '@/lib/ambrose/teamApi'
import type { RawTeamState } from '@/lib/ambrose/teamState'

// Loads one round's team state and keeps it fresh. Keeps the last good state on screen if a refresh fails (so a scorer who loses signal still sees their card).
export function useTeamRound(roundId: string, pollMs = 10_000) {
  const [state, setState] = useState<RawTeamState | null>(null)
  const [viewerId, setViewerId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [authLapsed, setAuthLapsed] = useState(false)
  const alive = useRef(true)
  const refresh = useCallback(async () => {
    const r = await getTeamState((u, i) => fetch(u, i), roundId)
    if (!alive.current) return
    if (r.ok) { setState(r.state as RawTeamState); setViewerId(r.viewerId); setError(null); setAuthLapsed(false) }
    else { setError(r.message); if (r.kind === 'auth') setAuthLapsed(true) }
  }, [roundId])
  useEffect(() => { alive.current = true; void refresh(); const t = setInterval(() => { void refresh() }, pollMs); return () => { alive.current = false; clearInterval(t) } }, [refresh, pollMs])
  return { state, viewerId, error, authLapsed, refresh }
}
