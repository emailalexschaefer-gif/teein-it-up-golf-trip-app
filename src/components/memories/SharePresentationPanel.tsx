'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { PresentationConfig } from '@/lib/trips/slideshowDeck'

// Release 3S -- organiser-only publish panel. Publishing is always a
// deliberate button press here; playing a presentation never publishes.
interface Candidate { momentId: string; imageUrl: string | null; mediaType: string; playerName: string | null }
interface Props { tripId: string; config: PresentationConfig; durationSeconds: 5 | 8 | 10; onClose: () => void; candidates: Candidate[] }

interface PreviewResult {
  counts: { eventMedia: number; publicMedia: number; publicSlides: number; eventSlides: number }
  excluded: { byReason: { reason: string; label: string; count: number }[]; items: { momentId: string; label: string; playerName: string | null }[] }
}
interface StatusResult { published: boolean; publicEnabled?: boolean; version?: number; publishedAt?: string; publicUrl?: string; chatPosted?: boolean }

const green = '#1a4731'
const btn: React.CSSProperties = { minHeight: 48, padding: '0 18px', borderRadius: 12, border: '1px solid #d1d5db', background: '#fff', fontSize: 15, cursor: 'pointer' }
const primary: React.CSSProperties = { ...btn, background: green, color: '#fff', border: 'none', fontWeight: 700 }

export default function SharePresentationPanel({ tripId, config, durationSeconds, onClose, candidates }: Props) {
  const qc = useQueryClient()
  const refreshStatus = () => qc.invalidateQueries({ queryKey: ['share-presentation-status', tripId] })
  const [status, setStatus] = useState<StatusResult | null>(null)
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [nameMode, setNameMode] = useState<'initials' | 'full'>('initials')
  const [attestFullNames, setAttestFullNames] = useState(false)
  const [publicEnabled, setPublicEnabled] = useState(false)
  const [attestCleared, setAttestCleared] = useState(false)
  const [excluded, setExcluded] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [link, setLink] = useState<string | null>(null)

  const call = useCallback(async (action: 'preview' | 'publish') => {
    const res = await fetch(`/api/trips/${tripId}/share-presentation`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, config, durationSeconds, nameMode, attestFullNames, publicEnabled, attestCleared, excludedMomentIds: excluded }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Something went wrong.')
    return body
  }, [tripId, config, durationSeconds, nameMode, attestFullNames, publicEnabled, attestCleared, excluded])

  useEffect(() => {
    let cancelled = false
    fetch(`/api/trips/${tripId}/share-presentation`, { cache: 'no-store' })
      .then(r => r.json()).then((s: StatusResult) => { if (!cancelled) { setStatus(s); setPublicEnabled(s.publicEnabled === true); if (s.publicUrl) setLink(s.publicUrl) } })
      .catch(() => { if (!cancelled) setStatus({ published: false }) })
    return () => { cancelled = true }
  }, [tripId])

  useEffect(() => {
    let cancelled = false
    setPreview(null)
    call('preview').then(b => { if (!cancelled) { setPreview(b as PreviewResult); setError(null) } })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Preview failed.') })
    return () => { cancelled = true }
  }, [call])

  const publish = async () => {
    setBusy(true); setError(null); setNotice(null)
    try {
      const b = await call('publish')
      setLink(b.publicUrl as string)
      setStatus({ published: true, publicEnabled, version: b.version, publicUrl: b.publicUrl, chatPosted: b.chatPosted })
      void refreshStatus()
      setNotice(b.republished ? 'Updated. The link is unchanged.' : 'Published!')
      if (!b.chatPosted) setNotice(n => `${n ?? ''} The Chat post could not be created — publishing again will retry it.`)
    } catch (e) { setError(e instanceof Error ? e.message : 'Publishing failed.') }
    finally { setBusy(false) }
  }

  const unpublish = async () => {
    if (!window.confirm('Unpublish? The link will stop working for everyone.')) return
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/trips/${tripId}/share-presentation`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Could not unpublish. Please try again.')
      void refreshStatus()
      setStatus({ published: false }); setLink(null); setNotice('Unpublished. The old link no longer works.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not unpublish.') }
    finally { setBusy(false) }
  }

  const copy = async () => {
    if (!shownLink) return
    try { await navigator.clipboard.writeText(shownLink); setCopied(true); setTimeout(() => setCopied(false), 2000) }
    catch { window.prompt('Copy this link', shownLink) }
  }

  const isPublic = status?.publicEnabled === true
  const shownLink = link ? (isPublic ? link : `${window.location.origin}/trips/${tripId}/presentation`) : null
  const canPublish = !busy && preview !== null && (!publicEnabled || attestCleared) && (nameMode === 'initials' || attestFullNames)

  return (
    <div role="dialog" aria-modal="true" aria-label="Publish presentation" style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div style={{ background: '#faf6ed', width: '100%', maxWidth: 520, maxHeight: '92dvh', overflowY: 'auto', borderRadius: '18px 18px 0 0', padding: '20px 16px calc(20px + env(safe-area-inset-bottom))' }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 22, margin: '0 0 4px' }}>Publish Presentation</h2>
        <p style={{ fontSize: 13, color: '#4b5563', margin: '0 0 14px' }}>
          Event members see the full presentation inside the event. A public link is optional and only includes media you have cleared.
        </p>

        {status?.published && <p style={{ fontSize: 13, margin: '0 0 12px', color: green }}>Currently published (version {status.version}).</p>}

        {!preview && !error && <p style={{ fontSize: 14 }}>Checking what can be shared&hellip;</p>}
        {preview && (
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 12, marginBottom: 12, fontSize: 14 }}>
            <p style={{ margin: '0 0 4px' }}><strong>Event members:</strong> {preview.counts.eventMedia} photos/videos, {preview.counts.eventSlides} slides</p>
            <p style={{ margin: '0 0 8px' }}><strong>Public link:</strong> {publicEnabled ? `${preview.counts.publicMedia} photos/videos, ${preview.counts.publicSlides} slides` : 'Off'}</p>
            {preview.excluded.byReason.length > 0 ? (
              <>
                <p style={{ margin: '0 0 4px', fontSize: 13, color: '#4b5563' }}>Left out (winner slides keep the trophy artwork instead):</p>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                  {preview.excluded.byReason.map(r => <li key={r.reason}>{r.count} × {r.label}</li>)}
                </ul>
              </>
            ) : <p style={{ margin: 0, fontSize: 13, color: '#4b5563' }}>Nothing is being left out.</p>}
          </div>
        )}

        <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 12, marginBottom: 12 }}>
          <label style={{ display: 'flex', gap: 10, alignItems: 'center', minHeight: 44, fontSize: 14, fontWeight: 700 }}>
            <input type="checkbox" checked={publicEnabled} onChange={e => setPublicEnabled(e.target.checked)} style={{ width: 22, height: 22 }} />
            Also allow a shareable link for people outside the event
          </label>
          <p style={{ fontSize: 12, color: '#6b7280', margin: '2px 0 0' }}>Leave this off to publish for event members only. You can turn it on later by updating the presentation.</p>
          {status?.publicEnabled === true && !publicEnabled && (
            <p role="status" style={{ fontSize: 12, color: '#b91c1c', margin: '6px 0 0' }}>Public sharing is currently ON. Updating with this unticked switches it off, and any link already shared stops working immediately.</p>
          )}
          {publicEnabled && (
            <>
              <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13, margin: '10px 0' }}>
                <input type="checkbox" checked={attestCleared} onChange={e => setAttestCleared(e.target.checked)} style={{ width: 22, height: 22, marginTop: 1, flexShrink: 0 }} />
                I confirm the players have been told their photos, highlights and winners may be shared outside the group, and that any media without permission is removed below.
              </label>
              <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 6px' }}>Tap any photo or video to leave it out of the public version ({excluded.length} removed). Once a link is forwarded, photos can be saved by others.</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
                {candidates.map(c => {
                  const out = excluded.includes(c.momentId)
                  return (
                    <button key={c.momentId} type="button" aria-pressed={out} aria-label={`${out ? 'Include' : 'Remove'} ${c.playerName ?? 'event'} ${c.mediaType}`}
                      onClick={() => setExcluded(x => out ? x.filter(i => i !== c.momentId) : [...x, c.momentId])}
                      style={{ position: 'relative', aspectRatio: '1', padding: 0, borderRadius: 8, overflow: 'hidden', border: out ? '3px solid #b91c1c' : '1px solid #d1d5db', background: '#e5e7eb', cursor: 'pointer' }}>
                      {c.imageUrl && c.mediaType === 'photo' && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={c.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: out ? 0.35 : 1 }} />
                      )}
                      {c.mediaType === 'video' && <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>Video</span>}
                      {out && <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#b91c1c', fontWeight: 800 }}>Removed</span>}
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>

        <fieldset style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 12, marginBottom: 12 }}>
          <legend style={{ fontSize: 13, padding: '0 6px' }}>Names on the public link</legend>
          <label style={{ display: 'flex', gap: 10, alignItems: 'center', minHeight: 44, fontSize: 14 }}>
            <input type="radio" name="nm" checked={nameMode === 'initials'} onChange={() => setNameMode('initials')} /> Abbreviated (Alex S.) &mdash; recommended
          </label>
          <label style={{ display: 'flex', gap: 10, alignItems: 'center', minHeight: 44, fontSize: 14 }}>
            <input type="radio" name="nm" checked={nameMode === 'full'} onChange={() => setNameMode('full')} /> Full names
          </label>
          {nameMode === 'full' && (
            <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13, marginTop: 6 }}>
              <input type="checkbox" checked={attestFullNames} onChange={e => setAttestFullNames(e.target.checked)} style={{ marginTop: 3 }} />
              I have everyone&rsquo;s agreement to show their full names to people outside the event.
            </label>
          )}
        </fieldset>

        {error && <p role="alert" style={{ color: '#b91c1c', fontSize: 14 }}>{error}</p>}
        {notice && <p role="status" style={{ color: green, fontSize: 14 }}>{notice}</p>}

        {link && (
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 12, marginBottom: 12 }}>
            <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 4px' }}>{isPublic ? 'Shareable link' : 'Event-members link (public sharing is off)'}</p>
            <p style={{ fontSize: 13, wordBreak: 'break-all', margin: '0 0 8px' }}>{shownLink}</p>
            <button onClick={copy} style={btn}>{copied ? 'Copied!' : 'Copy Link'}</button>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={publish} disabled={!canPublish} style={{ ...primary, opacity: canPublish ? 1 : 0.5 }}>
            {busy ? 'Working…' : status?.published ? 'Update published presentation' : 'Publish Presentation'}
          </button>
          {status?.published && <button onClick={unpublish} disabled={busy} style={{ ...btn, color: '#b91c1c' }}>Unpublish</button>}
          <button onClick={onClose} style={btn}>Close</button>
        </div>
      </div>
    </div>
  )
}
