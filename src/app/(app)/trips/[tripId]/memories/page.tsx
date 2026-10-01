'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

interface Memory {
  momentId: string; roundId: string | null; holeNumber: number | null
  playerId: string; playerName: string | null; caption: string | null
  imagePath: string; imageUrl: string | null; audience: string
  createdAt: string; organiserFavourite: boolean
}
interface Round { id: string; name: string; courseName: string | null; playDate: string; status: string; holes: number }
interface SideGameWinner { sideCompId: string; roundId: string; label: string; holeNumber: number | null; winnerPlayerId: string | null; winnerName: string | null }
interface Manifest {
  event: { id: string; name: string; status: string }
  rounds: Round[]
  memories: Memory[]
  sideGameWinners: SideGameWinner[]
}

/**
 * Event Memories V1 (10 Sep) -- the organiser-facing gallery. Consumes
 * the Event Memory Manifest directly (no separate gallery API) --
 * one data source for the header counts, filter tabs, grid, and the
 * detail view's context, per Part 11's own "future consumers should
 * not each reconstruct the event" principle applying just as much to
 * this first consumer as to any later one.
 */
export default function EventMemoriesPage() {
  const params = useParams<{ tripId: string }>()
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [error, setError] = useState('')
  const [filterRoundId, setFilterRoundId] = useState<string | 'all'>('all')
  const [manageMode, setManageMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [detailMoment, setDetailMoment] = useState<Memory | null>(null)
  const [isOrganiser, setIsOrganiser] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch(`/api/trips/${params.tripId}/memory-manifest`).then(r => r.json()),
      fetch(`/api/trips/${params.tripId}/my-role`).then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([manifestBody, roleBody]) => {
      if (cancelled) return
      if (manifestBody.error) { setError(manifestBody.error); return }
      setManifest(manifestBody)
      setIsOrganiser(roleBody?.role === 'organiser')
    }).catch(() => { if (!cancelled) setError('Could not load Event Memories.') })
    return () => { cancelled = true }
  }, [params.tripId])

  const filtered = useMemo(() => {
    if (!manifest) return []
    if (filterRoundId === 'all') return manifest.memories
    return manifest.memories.filter(m => m.roundId === filterRoundId)
  }, [manifest, filterRoundId])

  async function toggleFavourite(momentId: string, next: boolean) {
    if (!manifest) return
    setManifest({ ...manifest, memories: manifest.memories.map(m => m.momentId === momentId ? { ...m, organiserFavourite: next } : m) })
    try {
      await fetch(`/api/trips/${params.tripId}/memories/${momentId}/favourite`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ favourite: next }),
      })
    } catch { /* optimistic update stands; a manual refresh will reconcile if this failed */ }
  }

  async function downloadOne(momentId: string) {
    const res = await fetch(`/api/trips/${params.tripId}/memories/${momentId}/download`)
    const body = await res.json().catch(() => ({}))
    if (body.url) window.open(body.url, '_blank')
  }

  function toggleSelected(id: string) {
    setSelected(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
  }

  if (error) return <div style={{ padding: 24, textAlign: 'center', fontFamily: 'var(--font-body)', color: '#9ca3af' }}>{error}</div>
  if (!manifest) return <div style={{ padding: 24, textAlign: 'center', fontFamily: 'var(--font-body)', color: '#9ca3af' }}>Loading…</div>

  const photoCount = manifest.memories.length
  const roundCount = manifest.rounds.length
  const isCompleted = manifest.event.status === 'completed'

  return (
    <div style={{ padding: '16px 16px 40px', maxWidth: 560, margin: '0 auto' }}>
      <Link href={`/trips/${params.tripId}/tournament`} style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#7a7260', textDecoration: 'none' }}>
        ← My HQ
      </Link>

      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 800, color: '#14532d', marginTop: 8, marginBottom: 2 }}>
        📸 Event Memories
      </h1>
      <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#374151', marginBottom: 4 }}>{manifest.event.name}</p>

      {photoCount === 0 ? (
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#9ca3af', marginTop: 20, textAlign: 'center' }}>
          No event photos yet.<br />Photos and Moments captured during the event will appear here.
        </p>
      ) : (
        <>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#9ca3af', marginBottom: 14 }}>
            {isCompleted
              ? `Your event captured ${photoCount} photo${photoCount === 1 ? '' : 's'} across ${roundCount} round${roundCount === 1 ? '' : 's'}.`
              : `${photoCount} memor${photoCount === 1 ? 'y' : 'ies'} captured so far.`}
          </p>

          {/* Filter tabs */}
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 12, paddingBottom: 2 }}>
            <button onClick={() => setFilterRoundId('all')} style={tabStyle(filterRoundId === 'all')}>All</button>
            {manifest.rounds.map((r, i) => (
              <button key={r.id} onClick={() => setFilterRoundId(r.id)} style={tabStyle(filterRoundId === r.id)}>R{i + 1}</button>
            ))}
          </div>

          {isOrganiser && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
              <button
                onClick={() => { setManageMode(!manageMode); setSelected(new Set()) }}
                style={{ fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, color: '#1a4731', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                {manageMode ? 'Done' : 'Manage'}
              </button>
            </div>
          )}

          {/* Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
            {filtered.map(m => (
              <div
                key={m.momentId}
                onClick={() => manageMode ? toggleSelected(m.momentId) : setDetailMoment(m)}
                style={{ position: 'relative', aspectRatio: '1', borderRadius: 8, overflow: 'hidden', cursor: 'pointer', background: '#f3f4f6' }}
              >
                {m.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.imageUrl} alt={m.caption ?? 'Event memory'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                )}
                {m.organiserFavourite && <span style={{ position: 'absolute', top: 4, right: 4, fontSize: 14 }}>⭐</span>}
                {manageMode && (
                  <div style={{ position: 'absolute', top: 4, left: 4 }}>
                    <input type="checkbox" checked={selected.has(m.momentId)} onChange={() => toggleSelected(m.momentId)} style={{ width: 20, height: 20, pointerEvents: 'none' }} />
                  </div>
                )}
              </div>
            ))}
          </div>

          {manageMode && selected.size > 0 && (
            <div style={{ position: 'sticky', bottom: 0, marginTop: 10, background: '#f8f4eb', border: '1.5px solid #d9c9a3', borderRadius: 12, padding: 10, display: 'flex', gap: 8 }}>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#374151', alignSelf: 'center' }}>{selected.size} selected</span>
              <button
                onClick={async () => { for (const id of selected) await toggleFavourite(id, true) }}
                style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: 'none', background: '#1a4731', color: '#fff', fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}
              >
                ⭐ Favourite
              </button>
            </div>
          )}
        </>
      )}

      {/* Detail lightbox */}
      {detailMoment && (
        <div onClick={() => setDetailMoment(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 50, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, overflow: 'hidden', maxWidth: 480, margin: '0 auto', width: '100%' }}>
            {detailMoment.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={detailMoment.imageUrl} alt={detailMoment.caption ?? ''} style={{ width: '100%', display: 'block' }} />
            )}
            <div style={{ padding: 14 }}>
              {detailMoment.caption && <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#374151', marginBottom: 6 }}>{detailMoment.caption}</p>}
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: '#9ca3af' }}>
                {detailMoment.playerName ?? 'Unknown'}
                {detailMoment.holeNumber ? ` · Hole ${detailMoment.holeNumber}` : ''}
                {detailMoment.roundId ? ` · ${manifest.rounds.find(r => r.id === detailMoment.roundId)?.name ?? ''}` : ''}
              </p>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                {isOrganiser && (
                  <button onClick={() => toggleFavourite(detailMoment.momentId, !detailMoment.organiserFavourite)} style={smallButtonStyle}>
                    {detailMoment.organiserFavourite ? '⭐ Favourited' : '☆ Favourite'}
                  </button>
                )}
                <button onClick={() => downloadOne(detailMoment.momentId)} style={smallButtonStyle}>⬇ Download</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function tabStyle(active: boolean): React.CSSProperties {
  return {
    flexShrink: 0, padding: '7px 14px', borderRadius: 20, border: active ? 'none' : '1.5px solid #d9c9a3',
    background: active ? '#1a4731' : '#fff', color: active ? '#fff' : '#374151',
    fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
  }
}
const smallButtonStyle: React.CSSProperties = {
  flex: 1, padding: '9px 0', borderRadius: 8, border: '1.5px solid #d9c9a3', background: '#fff',
  fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 700, color: '#374151', cursor: 'pointer',
}
