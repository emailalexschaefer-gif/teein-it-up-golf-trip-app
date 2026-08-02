'use client'

import { useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useQueryClient } from '@tanstack/react-query'

// Resize to a max dimension (preserving aspect ratio — Moments are golf
// photos, not avatars, so square-cropping would be wrong here) and
// compress to JPEG. Draws through <img> + canvas, which normalizes EXIF
// orientation in every modern browser, same principle as the avatar
// pipeline but a deliberately separate function — Moments and avatars
// have different shape requirements (natural aspect ratio vs. square),
// and duplicating ~15 lines here is lower-risk than refactoring the
// already-deployed, already-working avatar flow to share one.
function processMomentImage(file: File, maxDimension = 1600): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, maxDimension / Math.max(img.width, img.height))
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) { reject(new Error('Canvas not supported')); return }
      ctx.drawImage(img, 0, 0, w, h)
      canvas.toBlob(
        (blob) => { if (blob) resolve(blob); else reject(new Error('Compression failed')) },
        'image/jpeg', 0.82,
      )
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image')) }
    img.src = url
  })
}

interface Props {
  tripId: string
  roundId?: string | null
  holeNumber?: number | null
  myGroupId: string | null
  onPosted?: () => void
}

export default function MomentCapture({ tripId, roundId, holeNumber, myGroupId, onPosted }: Props) {
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [previewFile, setPreviewFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [caption, setCaption] = useState('')
  const [audience, setAudience] = useState<'everyone' | 'group'>('everyone')
  const [uploading, setUploading] = useState(false)
  const [stage, setStage] = useState<'idle' | 'preparing' | 'uploading'>('idle')
  const [error, setError] = useState('')

  function handleSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Please choose a JPEG, PNG, or WEBP image.')
      return
    }
    setError('')
    setPreviewFile(file)
    setPreviewUrl(URL.createObjectURL(file))
  }

  function cancelPreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewFile(null)
    setPreviewUrl(null)
    setCaption('')
    setAudience('everyone')
    setError('')
  }

  async function handlePost() {
    if (!previewFile) return
    setUploading(true)
    setError('')
    setStage('preparing')

    try {
      const compressed = await processMomentImage(previewFile)

      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not signed in.')

      setStage('uploading')
      // Folder structure per the spec: trip-id/round-id/player-id/filename
      // — round-id falls back to 'general' when captured outside active
      // scoring (e.g. from My Round rather than mid-hole).
      const path = `${tripId}/${roundId ?? 'general'}/${user.id}/${Date.now()}.jpg`
      const { error: uploadErr } = await supabase.storage.from('event-moments').upload(path, compressed, { contentType: 'image/jpeg' })
      if (uploadErr) throw new Error(uploadErr.message)

      const res = await fetch(`/api/trips/${tripId}/moments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imagePath: path, caption, roundId: roundId ?? null, holeNumber: holeNumber ?? null,
          audience: audience === 'group' && myGroupId ? 'group' : 'everyone',
        }),
      })
      const resData = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(resData.error ?? "Moment couldn't be posted. Please try again.")

      void queryClient.invalidateQueries({ queryKey: ['event-messages', tripId] })
      void queryClient.invalidateQueries({ queryKey: ['moments', tripId] })
      cancelPreview()
      onPosted?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Moment couldn't be posted. Please try again.")
    } finally {
      setUploading(false)
      setStage('idle')
    }
  }

  return (
    <div>
      <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={handleSelect} style={{ display: 'none' }} />

      {!previewFile ? (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 20,
            background: '#fdf3d9', border: '1px solid #e8c96a', cursor: 'pointer',
            fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 700, color: '#a1791f',
          }}
        >
          📷 Moment
        </button>
      ) : (
        <div style={{ background: '#ffffff', border: '1px solid #eceae3', borderRadius: 12, padding: 12, marginTop: 8 }}>
          {previewUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- a
            // local blob: preview URL, not a remote image next/image can
            // optimize
            <img src={previewUrl} alt="Preview" style={{ width: '100%', maxHeight: 260, objectFit: 'contain', borderRadius: 8, marginBottom: 8, background: '#f3f4f6' }} />
          )}
          <input
            value={caption}
            onChange={e => setCaption(e.target.value)}
            placeholder="Caption (optional)"
            maxLength={200}
            style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 10px', fontFamily: 'var(--font-body)', fontSize: 13, marginBottom: 8 }}
          />
          {myGroupId && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              {(['everyone', 'group'] as const).map(a => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAudience(a)}
                  style={{
                    padding: '5px 12px', borderRadius: 14, cursor: 'pointer',
                    background: audience === a ? '#dcfce7' : '#f3f4f6',
                    border: audience === a ? '1px solid #86efac' : '1px solid #e5e7eb',
                    fontFamily: 'var(--font-body)', fontSize: 11.5, fontWeight: 700,
                    color: audience === a ? '#16a34a' : '#6b7280',
                  }}
                >
                  {a === 'everyone' ? 'Everyone' : 'My Group'}
                </button>
              ))}
            </div>
          )}
          {error && <p style={{ color: '#dc2626', fontSize: 11.5, marginBottom: 8, fontFamily: 'var(--font-body)' }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button" onClick={handlePost} disabled={uploading}
              style={{ flex: 1, padding: 10, borderRadius: 8, background: '#14532d', color: '#fff', border: 'none', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, cursor: uploading ? 'default' : 'pointer', opacity: uploading ? 0.6 : 1 }}
            >
              {stage === 'preparing' ? 'Preparing photo…' : stage === 'uploading' ? 'Uploading photo…' : 'Post'}
            </button>
            <button
              type="button" onClick={cancelPreview} disabled={uploading}
              style={{ flex: 1, padding: 10, borderRadius: 8, background: '#f3f4f6', border: '1px solid #d1d5db', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
