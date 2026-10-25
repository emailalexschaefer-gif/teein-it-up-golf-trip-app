'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { PublicBoard } from '@/lib/leaderboardShare/publicBoard'
import { buildLeaderboardPdf } from '@/lib/leaderboardShare/exportPdf'
import { renderBoardPng, PngTooLargeError } from '@/lib/leaderboardShare/exportPng'
import { copyText, safeFilename, shareLink, shareOrDownload } from '@/lib/leaderboardShare/exportSave'

export interface ShareStatus { available: boolean; enabled?: boolean; isOrganiser?: boolean; url?: string }

const btn: React.CSSProperties = { minHeight: 46, padding: '0 16px', borderRadius: 10, fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14.5, cursor: 'pointer' }
const primary: React.CSSProperties = { ...btn, border: 'none', background: '#14532d', color: '#fff' }
const secondary: React.CSSProperties = { ...btn, border: '1.5px solid #14532d', background: '#fff', color: '#14532d' }

export default function ShareLeaderboardPanel({ tripId, status, onClose }: { tripId: string; status: ShareStatus; onClose: () => void }) {
  const qc = useQueryClient()
  const [current, setCurrent] = useState<ShareStatus>(status)
  const [ack, setAck] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const base = `/api/trips/${tripId}`

  async function call(method: 'POST' | 'DELETE', body?: unknown) {
    const res = await fetch(`${base}/share-leaderboard`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error ?? 'Something went wrong. Please try again.')
    setCurrent(data); qc.setQueryData(['share-leaderboard', tripId], data)
  }

  async function enable() {
    setBusy('enable'); setError(null); setNotice(null)
    try { await call('POST', { acknowledge: true }); setNotice('Public link is on.') } catch (e) { setError(e instanceof Error ? e.message : 'Could not turn on sharing.') } finally { setBusy(null) }
  }
  async function disable() {
    if (!window.confirm('Turn off the public link? Anyone who has it will no longer be able to see the leaderboard. Turning it on again creates a new link.')) return
    setBusy('disable'); setError(null); setNotice(null)
    try { await call('DELETE'); setAck(false); setNotice('Public link turned off.') } catch (e) { setError(e instanceof Error ? e.message : 'Could not turn off sharing.') } finally { setBusy(null) }
  }
  async function copy() {
    if (!current.url) return
    setNotice((await copyText(current.url)) ? 'Link copied.' : 'Could not copy. Press and hold the link to copy it.')
  }
  async function share() {
    if (!current.url) return
    const r = await shareLink(current.url, 'Live leaderboard', 'Follow the scores live:')
    if (r === 'unsupported') await copy()
  }

  async function loadBoard(): Promise<PublicBoard> {
    const res = await fetch(`${base}/leaderboard-snapshot`, { cache: 'no-store' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error ?? 'Could not load the leaderboard.')
    return data as PublicBoard
  }
  async function exportFile(kind: 'png' | 'pdf') {
    setBusy(kind); setError(null); setNotice(null)
    try {
      const board = await loadBoard()
      const generatedText = `Generated ${new Date(board.generatedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`
      const blob = kind === 'png'
        ? await renderBoardPng(board, { generatedText, siteLabel: window.location.host, logoUrl: '/brand/teein-it-up-icon.png' })
        : new Blob([buildLeaderboardPdf(board, { generatedText }) as BlobPart], { type: 'application/pdf' })
      const r = await shareOrDownload(blob, safeFilename(board.eventName, kind), `${board.eventName} leaderboard`)
      if (r === 'downloaded') setNotice(kind === 'png' ? 'Image saved.' : 'PDF saved.')
    } catch (e) {
      setError(e instanceof PngTooLargeError ? 'This field is too large for one image. Use the PDF instead.' : e instanceof Error ? e.message : 'Could not create the file.')
    } finally { setBusy(null) }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Share leaderboard" style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div style={{ background: '#fff', width: '100%', maxWidth: 520, borderRadius: '18px 18px 0 0', padding: 20, maxHeight: '92vh', overflowY: 'auto', fontFamily: 'var(--font-body)' }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 22, margin: '0 0 4px' }}>Share Leaderboard</h2>
        <p style={{ margin: '0 0 14px', fontSize: 13.5, color: '#4b4b44' }}>Let friends and family follow the scores, live or as a snapshot.</p>

        <h3 style={{ fontSize: 14, margin: '0 0 6px' }}>Live link</h3>
        {current.enabled && current.url ? (
          <>
            <input readOnly value={current.url} onFocus={e => e.currentTarget.select()} aria-label="Public leaderboard link"
              style={{ width: '100%', boxSizing: 'border-box', padding: 10, borderRadius: 10, border: '1px solid #d9d6cb', fontSize: 13.5, marginBottom: 10 }} />
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={copy} style={{ ...secondary, flex: 1 }}>Copy Link</button>
              <button onClick={share} style={{ ...primary, flex: 1 }}>Share{'…'}</button>
            </div>
            <p style={{ fontSize: 12.5, color: '#6b6b60', margin: '8px 0 0' }}>Anyone with this link can see full player names and scores. It updates automatically as play progresses.</p>
            {current.isOrganiser && (
              <button onClick={disable} disabled={busy !== null} style={{ ...btn, marginTop: 10, width: '100%', border: '1.5px solid #e5c1c1', background: '#fff', color: '#9b1c1c' }}>
                {busy === 'disable' ? 'Working…' : 'Turn off public link'}
              </button>
            )}
          </>
        ) : current.isOrganiser ? (
          <>
            <div style={{ background: '#fdf3d9', border: '1px solid #e8c96a', borderRadius: 10, padding: 12, fontSize: 13.5, lineHeight: 1.45 }}>
              <strong>Before you turn this on:</strong> anyone who has the link will see every player&apos;s full name and score, without logging in. No emails, contact details, handicaps or chat are shown. You can turn the link off at any time.
            </div>
            <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', margin: '12px 0', fontSize: 13.5 }}>
              <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} style={{ marginTop: 3, width: 18, height: 18 }} />
              <span>I understand full player names and scores will be publicly visible to anyone with the link.</span>
            </label>
            <button onClick={enable} disabled={!ack || busy !== null} style={{ ...primary, width: '100%', opacity: !ack || busy ? 0.55 : 1 }}>
              {busy === 'enable' ? 'Working…' : 'Turn on public link'}
            </button>
          </>
        ) : (
          <p style={{ fontSize: 13.5, color: '#4b4b44', margin: 0 }}>Your organiser hasn&apos;t turned on the public link yet. Ask them to enable it. You can still save the leaderboard as an image or PDF below.</p>
        )}

        <h3 style={{ fontSize: 14, margin: '20px 0 6px' }}>Save a snapshot</h3>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => exportFile('png')} disabled={busy !== null} style={{ ...secondary, flex: 1, opacity: busy ? 0.6 : 1 }}>{busy === 'png' ? 'Preparing…' : 'Image (PNG)'}</button>
          <button onClick={() => exportFile('pdf')} disabled={busy !== null} style={{ ...secondary, flex: 1, opacity: busy ? 0.6 : 1 }}>{busy === 'pdf' ? 'Preparing…' : 'PDF'}</button>
        </div>
        <p style={{ fontSize: 12.5, color: '#6b6b60', margin: '8px 0 0' }}>The whole field, as it stands right now. The PDF handles any number of players.</p>

        {error && <p role="alert" style={{ color: '#b91c1c', fontSize: 13.5, margin: '12px 0 0' }}>{error}</p>}
        {notice && <p role="status" style={{ color: '#14532d', fontSize: 13.5, margin: '12px 0 0' }}>{notice}</p>}
        <button onClick={onClose} style={{ ...btn, width: '100%', marginTop: 16, border: '1px solid #d9d6cb', background: '#fff', color: '#1a1a16' }}>Close</button>
      </div>
    </div>
  )
}
