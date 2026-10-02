'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import type { EventMemoryData } from '@/lib/trips/eventMemoryData'
import { buildSlideshowDeck, rebuildDeckFromOrder, photoMomentIdsInOrder, type SlideshowSource, type SlideshowDeck } from '@/lib/trips/slideshowDeck'
import EventHighlightsPlayer from '@/components/memories/EventHighlightsPlayer'

// Event Memories V1.2 (12 Sep) -- the gallery's own Memory/Round/
// Manifest types used to be a locally-defined subset that had drifted
// out of sync with the real API response shape (missing sourceType,
// sideCompName, roundOrdinal, event dates) -- confirmed by comparing
// them directly against fetchEventMemoryData's actual output. Fixed
// by importing the real EventMemoryData type (type-only, erased at
// compile time, so no server code is bundled into this client
// component) instead of maintaining a second, drifting definition --
// exactly the "no competing data model" principle this feature's own
// brief asked for, applied to the frontend side too.
type Manifest = EventMemoryData
type Memory = EventMemoryData['memories'][number]

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
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [showExportMenu, setShowExportMenu] = useState(false)
  // Event Memories V1.2 (12 Sep) -- Event Highlights slideshow.
  // Deliberately session-only state (Phase 1 audit, point 9): no
  // persistence model was introduced; the curated order lives here
  // for the current viewing session and is rebuilt fresh from
  // scratch (via buildSlideshowDeck) each time "Produce Slideshow" is
  // chosen again.
  const [slideshowStep, setSlideshowStep] = useState<'closed' | 'chooseSource' | 'curate' | 'playing'>('closed')
  const [slideshowDeck, setSlideshowDeck] = useState<SlideshowDeck | null>(null)
  const [slideshowDuration, setSlideshowDuration] = useState<5 | 8 | 10>(8)

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

  async function exportMemories(scope: { kind: 'all' } | { kind: 'favourites' } | { kind: 'round'; roundId: string } | { kind: 'selected'; momentIds: string[] }) {
    setExporting(true)
    setExportError('')
    try {
      const res = await fetch(`/api/trips/${params.tripId}/export`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'Could not generate the export.')
      }
      const blob = await res.blob()
      const disposition = res.headers.get('Content-Disposition') ?? ''
      const filenameMatch = disposition.match(/filename="([^"]+)"/)
      const filename = filenameMatch ? filenameMatch[1] : 'Event-Memories.zip'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = filename
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Could not generate the export.')
    } finally {
      setExporting(false)
    }
  }

  function startSlideshow(source: SlideshowSource, selectedIds?: string[]) {
    if (!manifest) return
    const deck = buildSlideshowDeck(manifest, source, selectedIds)
    setSlideshowDeck(deck)
    setSlideshowStep('curate')
  }

  function reorderSlide(momentId: string, direction: -1 | 1) {
    if (!manifest || !slideshowDeck) return
    const ids = photoMomentIdsInOrder(slideshowDeck)
    const i = ids.indexOf(momentId)
    const j = i + direction
    if (i === -1 || j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    setSlideshowDeck(rebuildDeckFromOrder(manifest, ids))
  }

  function removeFromSlideshow(momentId: string) {
    if (!manifest || !slideshowDeck) return
    const ids = photoMomentIdsInOrder(slideshowDeck).filter(id => id !== momentId)
    setSlideshowDeck(rebuildDeckFromOrder(manifest, ids))
  }

  function addBackToSlideshow(momentId: string) {
    if (!manifest || !slideshowDeck) return
    const ids = [...photoMomentIdsInOrder(slideshowDeck), momentId]
    setSlideshowDeck(rebuildDeckFromOrder(manifest, ids))
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

          {isOrganiser && photoCount > 0 && (
            <button
              onClick={() => setSlideshowStep('chooseSource')}
              style={{
                width: '100%', padding: '10px 0', marginBottom: 10, borderRadius: 8, border: 'none',
                background: '#1a4731', color: '#fff', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}
            >
              ▶ Produce Slideshow
            </button>
          )}

          {isOrganiser && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8, position: 'relative' }}>
              <button
                onClick={() => setShowExportMenu(!showExportMenu)}
                disabled={exporting}
                style={{
                  flex: 1, padding: '9px 0', borderRadius: 8, border: '1.5px solid #d9c9a3', background: '#fff',
                  fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 700, color: '#1a4731',
                  cursor: exporting ? 'default' : 'pointer', opacity: exporting ? 0.6 : 1,
                }}
              >
                {exporting ? 'Preparing export…' : '⬇ Export Memories'}
              </button>
              <button
                onClick={() => { setManageMode(!manageMode); setSelected(new Set()) }}
                style={{ fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, color: '#1a4731', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                {manageMode ? 'Done' : 'Manage'}
              </button>

              {showExportMenu && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, zIndex: 10,
                  background: '#fff', border: '1px solid #eceae3', borderRadius: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', overflow: 'hidden',
                }}>
                  <button onClick={() => { setShowExportMenu(false); exportMemories({ kind: 'all' }) }} style={exportMenuItemStyle}>
                    All Event Memories
                  </button>
                  <button onClick={() => { setShowExportMenu(false); exportMemories({ kind: 'favourites' }) }} style={exportMenuItemStyle}>
                    ⭐ Favourites Only
                  </button>
                  {filterRoundId !== 'all' && (
                    <button onClick={() => { setShowExportMenu(false); exportMemories({ kind: 'round', roundId: filterRoundId }) }} style={exportMenuItemStyle}>
                      This Round
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {exportError && (
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: '#dc2626', marginBottom: 8 }}>{exportError}</p>
          )}

          {isOrganiser && (
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, color: '#9ca3af', marginBottom: 10 }}>
              ⭐ Favourite your best Memories to use them in Event Highlights and post-event exports.
            </p>
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
              <button
                onClick={() => exportMemories({ kind: 'selected', momentIds: [...selected] })}
                disabled={exporting}
                style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: '1.5px solid #1a4731', background: '#fff', color: '#1a4731', fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 700, cursor: exporting ? 'default' : 'pointer' }}
              >
                ⬇ Export Selected
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

      {/* Step 1 -- choose content source. */}
      {slideshowStep === 'chooseSource' && manifest && (
        <div onClick={() => setSlideshowStep('closed')} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 60, display: 'flex', alignItems: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: '16px 16px 0 0', padding: 20, width: '100%' }}>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 800, color: '#1a1a16', marginBottom: 12 }}>Produce Slideshow</p>
            <button onClick={() => startSlideshow('favourites')} style={sourceOptionStyle}>
              ⭐ Favourites <span style={{ color: '#9ca3af' }}>— {manifest.memories.filter(m => m.organiserFavourite).length} Memories</span>
            </button>
            <button onClick={() => startSlideshow('all')} style={sourceOptionStyle}>
              All Memories <span style={{ color: '#9ca3af' }}>— {manifest.memories.length} Memories</span>
            </button>
            {selected.size > 0 && (
              <button onClick={() => startSlideshow('selected', [...selected])} style={sourceOptionStyle}>
                Selected Memories <span style={{ color: '#9ca3af' }}>— {selected.size} Memories</span>
              </button>
            )}
            {manifest.memories.filter(m => m.organiserFavourite).length === 0 && (
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: '#9ca3af', marginTop: 6 }}>No Favourite Memories yet — choose All Memories, or favourite a few first.</p>
            )}
            <button onClick={() => setSlideshowStep('closed')} style={{ width: '100%', padding: '10px 0', marginTop: 10, border: 'none', background: 'none', fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#9ca3af', cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Step 2 -- lightweight curation: reorder / remove / add back, then preview or play. */}
      {slideshowStep === 'curate' && slideshowDeck && manifest && (
        <div style={{ position: 'fixed', inset: 0, background: '#fff', zIndex: 60, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: 16, borderBottom: '1px solid #eceae3', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button onClick={() => setSlideshowStep('closed')} style={{ border: 'none', background: 'none', fontFamily: 'var(--font-body)', fontSize: 13, color: '#374151', cursor: 'pointer' }}>Cancel</button>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, color: '#1a1a16' }}>{slideshowDeck.memoryCount} Memories</p>
            <button onClick={() => setSlideshowStep('playing')} style={{ border: 'none', background: '#1a4731', color: '#fff', borderRadius: 8, padding: '7px 14px', fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>▶ Play</button>
          </div>

          <div style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid #f3f4f1' }}>
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: '#9ca3af' }}>Duration per photo:</span>
            {([5, 8, 10] as const).map(d => (
              <button key={d} onClick={() => setSlideshowDuration(d)} style={{ padding: '4px 10px', borderRadius: 14, border: slideshowDuration === d ? 'none' : '1px solid #d9c9a3', background: slideshowDuration === d ? '#1a4731' : '#fff', color: slideshowDuration === d ? '#fff' : '#374151', fontFamily: 'var(--font-body)', fontSize: 11.5, cursor: 'pointer' }}>{d}s</button>
            ))}
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
            {photoMomentIdsInOrder(slideshowDeck).map((id, i, arr) => {
              const m = manifest.memories.find(mm => mm.momentId === id)
              if (!m) return null
              return (
                <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 8, borderRadius: 8, background: '#f8f4eb', marginBottom: 6 }}>
                  {m.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.imageUrl} alt="" style={{ width: 44, height: 44, borderRadius: 6, objectFit: 'cover' }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {[m.sideCompName, m.holeNumber ? `Hole ${m.holeNumber}` : null, m.playerName].filter(Boolean).join(' \u00b7 ') || 'Memory'}
                    </p>
                  </div>
                  <button onClick={() => reorderSlide(id, -1)} disabled={i === 0} style={curateIconButtonStyle(i === 0)}>↑</button>
                  <button onClick={() => reorderSlide(id, 1)} disabled={i === arr.length - 1} style={curateIconButtonStyle(i === arr.length - 1)}>↓</button>
                  <button onClick={() => removeFromSlideshow(id)} style={curateIconButtonStyle(false)}>✕</button>
                </div>
              )
            })}
            {slideshowDeck.memoryCount === 0 && (
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#9ca3af', textAlign: 'center', marginTop: 20 }}>No Memories in this slideshow yet.</p>
            )}
          </div>

          {(() => {
            const includedIds = new Set(photoMomentIdsInOrder(slideshowDeck))
            const excluded = manifest.memories.filter(m => !includedIds.has(m.momentId))
            if (excluded.length === 0) return null
            return (
              <div style={{ borderTop: '1px solid #eceae3', padding: 12, maxHeight: 140, overflowY: 'auto' }}>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#9ca3af', marginBottom: 6 }}>Add a Memory</p>
                <div style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
                  {excluded.map(m => (
                    <button key={m.momentId} onClick={() => addBackToSlideshow(m.momentId)} style={{ flexShrink: 0, border: 'none', padding: 0, background: 'none', cursor: 'pointer' }}>
                      {m.imageUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.imageUrl} alt="" style={{ width: 44, height: 44, borderRadius: 6, objectFit: 'cover', opacity: 0.6 }} />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )
          })()}
        </div>
      )}

      {/* Step 3 -- fullscreen playback. */}
      {slideshowStep === 'playing' && slideshowDeck && (
        <EventHighlightsPlayer
          slides={slideshowDeck.slides}
          durationSeconds={slideshowDuration}
          onExit={() => setSlideshowStep('curate')}
        />
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
const exportMenuItemStyle: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left', padding: '11px 14px', border: 'none', borderBottom: '1px solid #f3f4f1',
  background: '#fff', fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 600, color: '#374151', cursor: 'pointer',
}
const sourceOptionStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', width: '100%', padding: '13px 14px', marginBottom: 6, borderRadius: 10,
  border: '1.5px solid #d9c9a3', background: '#fff', fontFamily: 'var(--font-body)', fontSize: 13.5, fontWeight: 600, color: '#1a1a16', cursor: 'pointer',
}
function curateIconButtonStyle(disabled: boolean): React.CSSProperties {
  return { width: 28, height: 28, borderRadius: 6, border: 'none', background: disabled ? '#eceae3' : '#fff', color: disabled ? '#c4bfae' : '#374151', fontSize: 13, cursor: disabled ? 'default' : 'pointer' }
}
