'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import type { EventMemoryData } from '@/lib/trips/eventMemoryData'
import {
  type SlideshowDeck,
  buildPresentationDeck, getAvailableSections, defaultPresentationConfig,
  type PresentationConfig, type PresentationScope, type RoundSectionConfig, type SectionAvailability,
} from '@/lib/trips/slideshowDeck'
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
  // V1.5 completion patch (15 Sep) -- Create Slideshow flow: Choose
  // Scope -> Choose Sections -> Review -> Play. Replaces the prior
  // single-step "Produce Slideshow" (source-only) flow -- the
  // underlying PresentationConfig/buildPresentationDeck engine is the
  // tested foundation from the previous session; this page wires it
  // into the organiser UI, per the explicit "do not create a second
  // slide-generation path" instruction -- there is exactly one call
  // to buildPresentationDeck, in the Play step below.
  const [slideshowStep, setSlideshowStep] = useState<'closed' | 'scope' | 'sections' | 'review' | 'playing'>('closed')
  const [presentationConfig, setPresentationConfig] = useState<PresentationConfig | null>(null)
  const [slideshowDeck, setSlideshowDeck] = useState<SlideshowDeck | null>(null)
  const [slideshowDuration, setSlideshowDuration] = useState<5 | 8 | 10>(8)
  // V1.4 completion patch (14 Sep) -- Group Photo picker. Persisted
  // server-side (trips.group_photo_moment_id, migration 087), unlike
  // the slideshow curation above -- feeds buildSlideshowDeck's own
  // groupPhotoMomentId parameter, which already existed but had no
  // UI able to populate it until this patch.
  const [showGroupPhotoPicker, setShowGroupPhotoPicker] = useState(false)
  const [settingGroupPhoto, setSettingGroupPhoto] = useState(false)
  // V1.6 (5 Oct) -- Champion Photo picker, mirroring Group Photo exactly.
  const [showChampionPhotoPicker, setShowChampionPhotoPicker] = useState(false)
  const [settingChampionPhoto, setSettingChampionPhoto] = useState(false)

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

  async function toggleBlooper(momentId: string, next: boolean) {
    if (!manifest) return
    setManifest({ ...manifest, memories: manifest.memories.map(m => m.momentId === momentId ? { ...m, isBlooper: next } : m) })
    try {
      await fetch(`/api/trips/${params.tripId}/memories/${momentId}/blooper`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blooper: next }),
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

  // Choose Scope -- the organiser taps a round or Full Event; this
  // seeds the config with defaultPresentationConfig (the tested
  // intelligent-defaults function) and moves straight to Choose
  // Sections, never dumping them into a raw Memory list first.
  function chooseScope(scope: PresentationScope) {
    if (!manifest) return
    setPresentationConfig(defaultPresentationConfig(manifest, scope))
    setSlideshowStep('sections')
  }

  // Updates one round's section config within the current
  // PresentationConfig, by roundId -- the single place every per-round
  // toggle in the Sections step writes through.
  function updateRoundSection(roundId: string, patch: Partial<RoundSectionConfig>) {
    setPresentationConfig(prev => prev && {
      ...prev,
      rounds: prev.rounds.map(r => r.roundId === roundId ? { ...r, ...patch } : r),
    })
  }

  function toggleBestMomentSelection(momentId: string) {
    setPresentationConfig(prev => {
      if (!prev) return prev
      const current = new Set(prev.selectedMomentIds ?? [])
      if (current.has(momentId)) current.delete(momentId); else current.add(momentId)
      return { ...prev, bestMomentsSource: 'selected', selectedMomentIds: [...current] }
    })
  }

  // Review -> Play. The single call site for buildPresentationDeck in
  // this entire page -- per the explicit "do not create a second
  // slide-generation path" instruction.
  function playPresentation() {
    if (!manifest || !presentationConfig) return
    setSlideshowDeck(buildPresentationDeck(manifest, presentationConfig))
    setSlideshowStep('playing')
  }

  // V1.4 completion patch (14 Sep) -- set or clear the Group Photo.
  // Optimistic update (the manifest's own event.groupPhotoMomentId is
  // updated immediately), matching the existing favourite-toggle
  // pattern in this same file; a failure here is non-destructive --
  // a manual refresh reconciles if the server call didn't land.
  async function setGroupPhoto(momentId: string | null) {
    if (!manifest) return
    setSettingGroupPhoto(true)
    const previous = manifest.event.groupPhotoMomentId
    setManifest({ ...manifest, event: { ...manifest.event, groupPhotoMomentId: momentId } })
    try {
      const res = await fetch(`/api/trips/${params.tripId}/group-photo`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ momentId }),
      })
      if (!res.ok) setManifest(m => m ? { ...m, event: { ...m.event, groupPhotoMomentId: previous } } : m)
    } catch {
      setManifest(m => m ? { ...m, event: { ...m.event, groupPhotoMomentId: previous } } : m)
    } finally {
      setSettingGroupPhoto(false)
      setShowGroupPhotoPicker(false)
    }
  }

  // V1.6 (5 Oct) -- set or clear the Champion Photo. Mirrors
  // setGroupPhoto exactly: optimistic update, non-destructive on
  // failure (a manual refresh reconciles).
  async function setChampionPhoto(momentId: string | null) {
    if (!manifest) return
    setSettingChampionPhoto(true)
    const previous = manifest.event.championPhotoMomentId
    setManifest({ ...manifest, event: { ...manifest.event, championPhotoMomentId: momentId } })
    try {
      const res = await fetch(`/api/trips/${params.tripId}/champion-photo`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ momentId }),
      })
      if (!res.ok) setManifest(m => m ? { ...m, event: { ...m.event, championPhotoMomentId: previous } } : m)
    } catch {
      setManifest(m => m ? { ...m, event: { ...m.event, championPhotoMomentId: previous } } : m)
    } finally {
      setSettingChampionPhoto(false)
      setShowChampionPhotoPicker(false)
    }
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
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <button
                onClick={() => setShowGroupPhotoPicker(true)}
                style={{
                  flex: 1, padding: '10px 0', borderRadius: 8, border: '1.5px solid #d9c9a3', background: '#fff',
                  fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 700, color: '#1a4731', cursor: 'pointer',
                }}
              >
                📷 {manifest.event.groupPhotoMomentId ? 'Group Photo ✓' : 'Group Photo'}
              </button>
              <button
                onClick={() => setSlideshowStep('scope')}
                style={{
                  flex: 2, padding: '10px 0', borderRadius: 8, border: 'none',
                  background: '#1a4731', color: '#fff', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                }}
              >
                ▶ Create Slideshow
              </button>
            </div>
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
                {m.imageUrl && m.mediaType === 'video' ? (
                  // V1.4 completion patch (14 Sep) -- a video Moment
                  // cannot render inside an <img> tag at all; this was
                  // a genuine bug before video Moments existed to
                  // expose it. Muted, no controls -- the grid is a
                  // thumbnail, not a player; tapping opens the detail
                  // lightbox the same as a photo.
                  <video src={m.imageUrl} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : m.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.imageUrl} alt={m.caption ?? 'Event memory'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : null}
                {m.mediaType === 'video' && <span style={{ position: 'absolute', bottom: 4, left: 4, fontSize: 12, background: 'rgba(0,0,0,0.6)', color: '#fff', borderRadius: 4, padding: '1px 5px' }}>🎬 {m.durationSeconds ? `${Math.round(m.durationSeconds)}s` : ''}</span>}
                {m.isBlooper && <span style={{ position: 'absolute', top: 4, left: 4, fontSize: 12, background: 'rgba(0,0,0,0.6)', color: '#fff', borderRadius: 4, padding: '1px 5px' }}>Blooper</span>}
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
            {detailMoment.imageUrl && detailMoment.mediaType === 'video' ? (
              // V1.4 completion patch (14 Sep) -- same <img>-cannot-
              // show-video fix as the grid thumbnail above.
              <video src={detailMoment.imageUrl} controls playsInline style={{ width: '100%', display: 'block', maxHeight: '70vh' }} />
            ) : detailMoment.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={detailMoment.imageUrl} alt={detailMoment.caption ?? ''} style={{ width: '100%', display: 'block' }} />
            ) : null}
            <div style={{ padding: 14 }}>
              {detailMoment.caption && <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#374151', marginBottom: 6 }}>{detailMoment.caption}</p>}
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: '#9ca3af' }}>
                {detailMoment.playerName ?? 'Unknown'}
                {detailMoment.holeNumber ? ` · Hole ${detailMoment.holeNumber}` : ''}
                {detailMoment.roundId ? ` · ${manifest.rounds.find(r => r.id === detailMoment.roundId)?.name ?? ''}` : ''}
              </p>
              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                {isOrganiser && (
                  <button onClick={() => toggleFavourite(detailMoment.momentId, !detailMoment.organiserFavourite)} style={smallButtonStyle}>
                    {detailMoment.organiserFavourite ? '⭐ Favourited' : '☆ Favourite'}
                  </button>
                )}
                {/* V1.4 completion patch (14 Sep) -- organiser-only, video Moments only. Never requires the Moment to also be a Favourite. */}
                {isOrganiser && detailMoment.mediaType === 'video' && (
                  <button onClick={() => toggleBlooper(detailMoment.momentId, !detailMoment.isBlooper)} style={smallButtonStyle}>
                    {detailMoment.isBlooper ? '🎬 Blooper ✓' : '🎬 Add to Bloopers'}
                  </button>
                )}
                <button onClick={() => downloadOne(detailMoment.momentId)} style={smallButtonStyle}>⬇ Download</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Step 1 -- Choose Scope: a round, or Full Event. Dynamically
          generated from manifest.rounds -- never hard-coded to three. */}
      {slideshowStep === 'scope' && manifest && (
        <div onClick={() => setSlideshowStep('closed')} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 60, display: 'flex', alignItems: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: '16px 16px 0 0', padding: 20, width: '100%' }}>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 800, color: '#1a1a16', marginBottom: 4 }}>Create Slideshow</p>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: '#9ca3af', marginBottom: 12 }}>What&apos;s this presentation for?</p>
            {[...manifest.rounds].sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0)).map(r => (
              <button key={r.id} onClick={() => chooseScope({ kind: 'round', roundId: r.id })} style={sourceOptionStyle}>
                {r.name}
              </button>
            ))}
            <button onClick={() => chooseScope({ kind: 'fullEvent' })} style={{ ...sourceOptionStyle, fontWeight: 700 }}>
              Full Event
            </button>
            <button onClick={() => setSlideshowStep('closed')} style={{ width: '100%', padding: '10px 0', marginTop: 10, border: 'none', background: 'none', fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#9ca3af', cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Step 2 -- Choose Sections. Round scope: one flat set of
          toggles. Full Event: every included round independently
          configurable, then the Event Finale group -- the central
          requirement this whole flow exists for. Only sections
          getAvailableSections reports as genuinely available are ever
          shown, per "gracefully suppress unavailable content." */}
      {slideshowStep === 'sections' && presentationConfig && manifest && (
        <div style={{ position: 'fixed', inset: 0, background: '#fff', zIndex: 60, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: 16, borderBottom: '1px solid #eceae3', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button onClick={() => setSlideshowStep('closed')} style={{ border: 'none', background: 'none', fontFamily: 'var(--font-body)', fontSize: 13, color: '#374151', cursor: 'pointer' }}>Cancel</button>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, color: '#1a1a16' }}>Choose Sections</p>
            <button onClick={() => setSlideshowStep('review')} style={{ border: 'none', background: '#1a4731', color: '#fff', borderRadius: 8, padding: '7px 14px', fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>Next</button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
            {presentationConfig.scope.kind === 'round' ? (
              <SectionToggleGroup
                title={manifest.rounds.find(r => r.id === presentationConfig.rounds[0]?.roundId)?.name ?? 'This Round'}
                availability={getAvailableSections(manifest, presentationConfig.scope)}
                round={presentationConfig.rounds[0]}
                onToggle={(key, val) => updateRoundSection(presentationConfig.rounds[0].roundId, { [key]: val })}
              />
            ) : (
              <>
                <div style={{ marginBottom: 18 }}>
                  <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, letterSpacing: 1, color: '#9ca3af', textTransform: 'uppercase', marginBottom: 8 }}>Opening</p>
                  <ToggleRow label="Event Opening" checked={presentationConfig.eventOpening} onChange={v => setPresentationConfig(prev => prev && { ...prev, eventOpening: v })} />
                  {manifest.event.groupPhotoMomentId ? (
                    <ToggleRow label="Group Photo" checked={presentationConfig.groupPhoto} onChange={v => setPresentationConfig(prev => prev && { ...prev, groupPhoto: v })} />
                  ) : (
                    <button onClick={() => setShowGroupPhotoPicker(true)} style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#1a4731', background: 'none', border: 'none', padding: '8px 0', cursor: 'pointer', textDecoration: 'underline' }}>
                      + Add a Group Photo
                    </button>
                  )}
                </div>
                {presentationConfig.rounds.map(r => {
                  const round = manifest.rounds.find(rr => rr.id === r.roundId)
                  if (!round) return null
                  return (
                    <SectionToggleGroup
                      key={r.roundId} title={round.name}
                      availability={getAvailableSections(manifest, { kind: 'round', roundId: r.roundId })}
                      round={r}
                      onToggle={(key, val) => updateRoundSection(r.roundId, { [key]: val })}
                    />
                  )
                })}
                <div>
                  <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, letterSpacing: 1, color: '#9ca3af', textTransform: 'uppercase', marginBottom: 8 }}>Event Finale</p>
                  {getAvailableSections(manifest, { kind: 'fullEvent' }).find(a => a.type === 'EVENT_CHAMPION')?.available && (
                    <>
                      <ToggleRow label="Event Champion" checked={presentationConfig.eventChampion} onChange={v => setPresentationConfig(prev => prev && { ...prev, eventChampion: v })} />
                      {/* V1.6 (5 Oct) -- optional, explicit override; falls back to a
                          Favourite photo of the champion, then the Group Photo, if left unset. */}
                      {presentationConfig.eventChampion && (
                        <button onClick={() => setShowChampionPhotoPicker(true)} style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: '#1a4731', background: 'none', border: 'none', padding: '2px 0 10px', cursor: 'pointer', textDecoration: 'underline' }}>
                          {manifest.event.championPhotoMomentId ? 'Change Champion Photo' : '+ Choose a Champion Photo (optional)'}
                        </button>
                      )}
                    </>
                  )}
                  {getAvailableSections(manifest, { kind: 'fullEvent' }).find(a => a.type === 'FINAL_LEADERBOARD')?.available && (
                    <ToggleRow label="Final Leaderboard" checked={presentationConfig.finalLeaderboard} onChange={v => setPresentationConfig(prev => prev && { ...prev, finalLeaderboard: v })} />
                  )}
                  {getAvailableSections(manifest, { kind: 'fullEvent' }).find(a => a.type === 'BLOOPERS')?.available && (
                    <ToggleRow label="Bloopers" checked={presentationConfig.bloopers} onChange={v => setPresentationConfig(prev => prev && { ...prev, bloopers: v })} />
                  )}
                  <ToggleRow label="Closing / Thanks" checked={presentationConfig.eventFinale} onChange={v => setPresentationConfig(prev => prev && { ...prev, eventFinale: v })} />
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Step 3 -- Review: resulting structure/slide count, duration,
          and (only if any round has Best Moments on) the existing
          add/remove Memory picker, reused rather than rebuilt. */}
      {slideshowStep === 'review' && presentationConfig && manifest && (() => {
        const previewDeck = buildPresentationDeck(manifest, presentationConfig)
        const anyBestMoments = presentationConfig.rounds.some(r => r.bestMoments)
        const sectionCounts = {
          photo: previewDeck.slides.filter(s => s.kind === 'photo').length,
          winner: previewDeck.slides.filter(s => s.kind === 'sideGameWinner').length,
          mb: previewDeck.slides.filter(s => s.kind === 'makersBreakers').length,
          rr: previewDeck.slides.filter(s => s.kind === 'roundResults').length,
        }
        return (
          <div style={{ position: 'fixed', inset: 0, background: '#fff', zIndex: 60, display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: 16, borderBottom: '1px solid #eceae3', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button onClick={() => setSlideshowStep('sections')} style={{ border: 'none', background: 'none', fontFamily: 'var(--font-body)', fontSize: 13, color: '#374151', cursor: 'pointer' }}>Back</button>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, color: '#1a1a16' }}>{previewDeck.slides.length} Slides</p>
              <button onClick={playPresentation} style={{ border: 'none', background: '#1a4731', color: '#fff', borderRadius: 8, padding: '7px 14px', fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>▶ Play</button>
            </div>
            <div style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid #f3f4f1' }}>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: '#9ca3af' }}>Duration per photo:</span>
              {([5, 8, 10] as const).map(d => (
                <button key={d} onClick={() => setSlideshowDuration(d)} style={{ padding: '4px 10px', borderRadius: 14, border: slideshowDuration === d ? 'none' : '1px solid #d9c9a3', background: slideshowDuration === d ? '#1a4731' : '#fff', color: slideshowDuration === d ? '#fff' : '#374151', fontFamily: 'var(--font-body)', fontSize: 11.5, cursor: 'pointer' }}>{d}s</button>
              ))}
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, letterSpacing: 1, color: '#9ca3af', textTransform: 'uppercase', marginBottom: 10 }}>What&apos;s included</p>
              <div style={{ background: '#f8f4eb', borderRadius: 10, padding: 14, marginBottom: 18 }}>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#374151', marginBottom: 4 }}>{sectionCounts.photo} photo{sectionCounts.photo === 1 ? '' : 's'}</p>
                {sectionCounts.winner > 0 && <p style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#374151', marginBottom: 4 }}>{sectionCounts.winner} Side Game winner{sectionCounts.winner === 1 ? '' : 's'}</p>}
                {sectionCounts.mb > 0 && <p style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#374151', marginBottom: 4 }}>{sectionCounts.mb} Makers & Breakers section{sectionCounts.mb === 1 ? '' : 's'}</p>}
                {sectionCounts.rr > 0 && <p style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#374151' }}>{sectionCounts.rr} Round Winner{sectionCounts.rr === 1 ? '' : 's'}</p>}
              </div>

              {anyBestMoments && (
                <>
                  <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, letterSpacing: 1, color: '#9ca3af', textTransform: 'uppercase', marginBottom: 10 }}>Best Moments</p>
                  <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#9ca3af', marginBottom: 10 }}>
                    {presentationConfig.bestMomentsSource === 'favourites' ? 'Showing Favourites. Tap to remove, or tap any below to add specific ones.' : presentationConfig.bestMomentsSource === 'all' ? 'Showing all Memories for the included rounds.' : 'Showing your specific selection.'}
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                    {manifest.memories.filter(m => m.mediaType === 'photo' && presentationConfig.rounds.some(r => r.bestMoments && r.roundId === m.roundId)).map(m => {
                      const included = previewDeck.slides.some(s => s.kind === 'photo' && s.momentId === m.momentId)
                      return (
                        <button key={m.momentId} onClick={() => toggleBestMomentSelection(m.momentId)} style={{ position: 'relative', aspectRatio: '1', borderRadius: 8, overflow: 'hidden', border: included ? '3px solid #1a4731' : '1px solid #eceae3', padding: 0, cursor: 'pointer', opacity: included ? 1 : 0.5 }}>
                          {m.imageUrl && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={m.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          )}
                        </button>
                      )
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        )
      })()}

      {/* Step 4 -- fullscreen playback. Exactly one buildPresentationDeck
          call site exists, in playPresentation above. */}
      {slideshowStep === 'playing' && slideshowDeck && (
        <EventHighlightsPlayer
          slides={slideshowDeck.slides}
          durationSeconds={slideshowDuration}
          onExit={() => setSlideshowStep('review')}
        />
      )}

      {/* Group Photo picker -- V1.4 completion patch (14 Sep). Only
          genuine photo Moments are offered; the server independently
          re-validates this on save (see the group-photo route), so a
          stale client-side list is never trusted on its own. */}
      {showGroupPhotoPicker && (
        <div onClick={() => setShowGroupPhotoPicker(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 70, display: 'flex', alignItems: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: '16px 16px 0 0', padding: 20, width: '100%', maxHeight: '75vh', display: 'flex', flexDirection: 'column' }}>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 800, color: '#1a1a16', marginBottom: 4 }}>Select Group Photo</p>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: '#9ca3af', marginBottom: 12 }}>This photo opens your Event Highlights, right after the title slide.</p>
            {manifest.event.groupPhotoMomentId && (
              <button onClick={() => setGroupPhoto(null)} disabled={settingGroupPhoto} style={{ marginBottom: 10, padding: '8px 0', borderRadius: 8, border: '1px solid #d9c9a3', background: '#fff', fontFamily: 'var(--font-body)', fontSize: 12, color: '#7a7260', cursor: 'pointer' }}>
                Remove Group Photo
              </button>
            )}
            <div style={{ overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
              {manifest.memories.filter(m => m.mediaType === 'photo').map(m => (
                <button
                  key={m.momentId} onClick={() => setGroupPhoto(m.momentId)} disabled={settingGroupPhoto}
                  style={{ position: 'relative', aspectRatio: '1', borderRadius: 8, overflow: 'hidden', border: m.momentId === manifest.event.groupPhotoMomentId ? '3px solid #1a4731' : 'none', padding: 0, cursor: 'pointer', background: '#f3f4f6' }}
                >
                  {m.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  )}
                  {m.momentId === manifest.event.groupPhotoMomentId && (
                    <span style={{ position: 'absolute', top: 4, right: 4, fontSize: 14 }}>✓</span>
                  )}
                </button>
              ))}
            </div>
            {manifest.memories.filter(m => m.mediaType === 'photo').length === 0 && (
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#9ca3af', textAlign: 'center', padding: '20px 0' }}>No photos available yet.</p>
            )}
          </div>
        </div>
      )}

      {/* Champion Photo picker -- V1.6 (5 Oct). Mirrors the Group
          Photo picker exactly. Explicit priority over the automatic
          Favourite-photo-of-the-champion match and the Group Photo
          fallback, both handled server-side in slideshowDeck.ts. */}
      {showChampionPhotoPicker && (
        <div onClick={() => setShowChampionPhotoPicker(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 70, display: 'flex', alignItems: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: '16px 16px 0 0', padding: 20, width: '100%', maxHeight: '75vh', display: 'flex', flexDirection: 'column' }}>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 800, color: '#1a1a16', marginBottom: 4 }}>Select Champion Photo</p>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: '#9ca3af', marginBottom: 12 }}>Optional. Without one, a Favourite photo of the champion is used, then the Group Photo.</p>
            {manifest.event.championPhotoMomentId && (
              <button onClick={() => setChampionPhoto(null)} disabled={settingChampionPhoto} style={{ marginBottom: 10, padding: '8px 0', borderRadius: 8, border: '1px solid #d9c9a3', background: '#fff', fontFamily: 'var(--font-body)', fontSize: 12, color: '#7a7260', cursor: 'pointer' }}>
                Remove Champion Photo
              </button>
            )}
            <div style={{ overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
              {manifest.memories.filter(m => m.mediaType === 'photo').map(m => (
                <button
                  key={m.momentId} onClick={() => setChampionPhoto(m.momentId)} disabled={settingChampionPhoto}
                  style={{ position: 'relative', aspectRatio: '1', borderRadius: 8, overflow: 'hidden', border: m.momentId === manifest.event.championPhotoMomentId ? '3px solid #1a4731' : 'none', padding: 0, cursor: 'pointer', background: '#f3f4f6' }}
                >
                  {m.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  )}
                  {m.momentId === manifest.event.championPhotoMomentId && (
                    <span style={{ position: 'absolute', top: 4, right: 4, fontSize: 14 }}>✓</span>
                  )}
                </button>
              ))}
            </div>
            {manifest.memories.filter(m => m.mediaType === 'photo').length === 0 && (
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#9ca3af', textAlign: 'center', padding: '20px 0' }}>No photos available yet.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * SectionToggleGroup -- one round's own section toggles within Choose
 * Sections. Maps the four round-level section types directly from
 * getAvailableSections' own output: a section the data genuinely
 * can't support for this round (e.g. no published Makers & Breakers)
 * is never shown as a toggle at all -- "gracefully suppress
 * unavailable content" applies here, not just in the generated deck.
 * Round Intro itself is never a toggle -- the round divider is
 * automatic whenever the round has any other content, matching
 * buildPresentationDeck's own "no empty round section" rule.
 */
function SectionToggleGroup({ title, availability, round, onToggle }: {
  title: string
  availability: SectionAvailability[]
  round: RoundSectionConfig
  onToggle: (key: keyof Omit<RoundSectionConfig, 'roundId'>, value: boolean) => void
}) {
  const sectionMap: { type: SectionAvailability['type']; key: keyof Omit<RoundSectionConfig, 'roundId'>; label: string }[] = [
    { type: 'BEST_MOMENTS', key: 'bestMoments', label: 'Best Moments' },
    { type: 'SIDE_GAME_WINNERS', key: 'sideGameWinners', label: 'Side Game Winners' },
    { type: 'MAKERS_BREAKERS', key: 'makersBreakers', label: 'Makers & Breakers' },
    { type: 'ROUND_RESULTS', key: 'roundResults', label: 'Round Winner' },
  ]
  const availableOnes = sectionMap.filter(s => availability.find(a => a.type === s.type)?.available)
  return (
    <div style={{ marginBottom: 18 }}>
      <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, letterSpacing: 1, color: '#9ca3af', textTransform: 'uppercase', marginBottom: 8 }}>{title}</p>
      {availableOnes.length === 0 && (
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#c4bfae' }}>Nothing available for this round yet.</p>
      )}
      {availableOnes.map(s => (
        <ToggleRow key={s.key} label={s.label} checked={round[s.key]} onChange={v => onToggle(s.key, v)} />
      ))}
    </div>
  )
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', padding: '11px 4px', border: 'none', borderBottom: '1px solid #f3f4f1', background: 'none', cursor: 'pointer', textAlign: 'left' }}
    >
      <span style={{ fontFamily: 'var(--font-body)', fontSize: 13.5, color: '#1a1a16' }}>{label}</span>
      <span style={{ width: 38, height: 22, borderRadius: 11, background: checked ? '#1a4731' : '#e5e2d9', position: 'relative', transition: 'background 0.15s', flexShrink: 0 }}>
        <span style={{ position: 'absolute', top: 2, left: checked ? 18 : 2, width: 18, height: 18, borderRadius: 9, background: '#fff', transition: 'left 0.15s' }} />
      </span>
    </button>
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
