'use client'

import { useState, useRef } from 'react'
import type { CSSProperties, ChangeEvent } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useQueryClient } from '@tanstack/react-query'

function logStage(stage: string, detail?: unknown) {
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.log(`[moment pipeline] ${stage}`, detail ?? '')
  }
}

interface ResolvedUpload { blob: Blob; contentType: string; extension: string; usedOriginal: boolean }

// The actual fix for "Could not read that image" blocking posting
// entirely: previously, a single <img>+canvas decode path was the only
// way to prepare an image, and if it failed for any reason (some Android
// camera/gallery files genuinely fail to decode via <img> in Chrome —
// unusual EXIF, certain encodings, very large dimensions), the whole
// upload was blocked with no recovery. Now: attempt processing via
// createImageBitmap (a more robust, more directly Blob-oriented decode
// API than <img> src assignment) first: if it succeeds, compress and
// resize as before. If it fails at ANY stage, fall back to uploading the
// ORIGINAL FILE completely unprocessed — Supabase Storage only needs the
// raw bytes, it never needs the browser to successfully decode the image
// as a bitmap, so this succeeds even when the decode path can't handle
// the file. Only actually fails if both the processed path AND this
// original-file fallback fail (i.e. the storage upload itself fails,
// handled separately in handlePostPhoto).
async function resolveUploadBlob(file: File): Promise<ResolvedUpload> {
  logStage('processing-attempted', { filename: file.name, mimeType: file.type, size: file.size })
  try {
    const bitmap = await createImageBitmap(file)
    logStage('bitmap-decoded', { width: bitmap.width, height: bitmap.height })

    const maxDimension = 1600
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height))
    const w = Math.round(bitmap.width * scale)
    const h = Math.round(bitmap.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context not available')
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()

    const blob: Blob | null = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.82))
    if (!blob) throw new Error('Compression produced no output')

    logStage('processed-blob-created', { size: blob.size, width: w, height: h })
    return { blob, contentType: 'image/jpeg', extension: 'jpg', usedOriginal: false }
  } catch (err) {
    logStage('processing-failed-falling-back-to-original', { error: err instanceof Error ? err.message : String(err) })
    // Do not block a valid image solely because resizing/decoding
    // failed. The original file's own MIME type determines the upload
    // content-type and extension here, since we never got a chance to
    // normalize it to JPEG.
    const extension = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
    return { blob: file, contentType: file.type || 'application/octet-stream', extension, usedOriginal: true }
  }
}

interface Props {
  tripId: string
  roundId?: string | null
  holeNumber?: number | null
  myGroupId: string | null
  onPosted?: () => void
}

type ComposerStage = 'closed' | 'choosing' | 'photoPreview' | 'textMoment'

export default function MomentCapture({ tripId, roundId, holeNumber, myGroupId, onPosted }: Props) {
  const queryClient = useQueryClient()
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)

  const [stage, setStage] = useState<ComposerStage>('closed')
  const [previewFile, setPreviewFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewFailed, setPreviewFailed] = useState(false)
  const [caption, setCaption] = useState('')
  const [audience, setAudience] = useState<'everyone' | 'group'>('everyone')
  const [uploading, setUploading] = useState(false)
  const [uploadStage, setUploadStage] = useState<'idle' | 'preparing' | 'uploading'>('idle')
  const [error, setError] = useState('')

  function resetAll() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewFile(null)
    setPreviewUrl(null)
    setPreviewFailed(false)
    setCaption('')
    setAudience('everyone')
    setError('')
    setStage('closed')
  }

  function chooseAnother() {
    galleryInputRef.current?.click()
  }

  function handleSelect(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    logStage('file-selected', { filename: file.name, mimeType: file.type, size: file.size })
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Please choose a JPEG, PNG, or WEBP image.')
      return
    }
    // Always revoke any existing preview URL before creating a new one —
    // fixes a real leak: picking a second photo without cancelling the
    // first left the previous blob URL un-revoked.
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setError('')
    setPreviewFailed(false)
    setPreviewFile(file)
    const url = URL.createObjectURL(file)
    logStage('object-url-created', { url })
    setPreviewUrl(url)
    setStage('photoPreview')
  }

  async function handlePostPhoto() {
    if (!previewFile) return
    setUploading(true)
    setError('')
    setUploadStage('preparing')

    try {
      const resolved = await resolveUploadBlob(previewFile)

      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not signed in.')

      setUploadStage('uploading')
      logStage('storage-upload-starting', { usedOriginal: resolved.usedOriginal, size: resolved.blob.size })
      // Folder structure per the spec: trip-id/round-id/player-id/filename
      // — round-id falls back to 'general' when captured outside active
      // scoring (e.g. from My Round rather than mid-hole). Extension
      // reflects whichever path actually produced the upload blob.
      const path = `${tripId}/${roundId ?? 'general'}/${user.id}/${Date.now()}.${resolved.extension}`
      const { error: uploadErr } = await supabase.storage.from('event-moments').upload(path, resolved.blob, { contentType: resolved.contentType })
      if (uploadErr) {
        logStage('storage-upload-failed', { message: uploadErr.message })
        throw new Error(uploadErr.message)
      }
      logStage('storage-upload-complete', { path })

      await postMoment({ imagePath: path })
    } catch (err) {
      logStage('post-failed', { error: err instanceof Error ? err.message : String(err) })
      setError(err instanceof Error ? err.message : "Moment couldn't be posted. Please try again.")
    } finally {
      setUploading(false)
      setUploadStage('idle')
    }
  }

  async function handlePostText() {
    if (!caption.trim()) { setError('Write something for this moment.'); return }
    setUploading(true)
    setError('')
    try {
      await postMoment({})
    } catch (err) {
      setError(err instanceof Error ? err.message : "Moment couldn't be posted. Please try again.")
    } finally {
      setUploading(false)
    }
  }

  async function postMoment({ imagePath }: { imagePath?: string }) {
    logStage('moment-row-insert-requested', { hasImage: !!imagePath, audience })
    const res = await fetch(`/api/trips/${tripId}/moments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imagePath: imagePath ?? null, caption: caption.trim(), roundId: roundId ?? null, holeNumber: holeNumber ?? null,
        audience: audience === 'group' && myGroupId ? 'group' : 'everyone',
      }),
    })
    const resData = await res.json().catch(() => ({}))
    if (!res.ok) {
      logStage('moment-row-insert-failed', { error: resData.error })
      throw new Error(resData.error ?? "Moment couldn't be posted. Please try again.")
    }
    logStage('moment-posted', { momentId: resData.moment?.id })

    void queryClient.invalidateQueries({ queryKey: ['event-messages', tripId] })
    void queryClient.invalidateQueries({ queryKey: ['moments', tripId] })
    resetAll()
    onPosted?.()
  }

  return (
    <div>
      {/* Two separate file inputs — Take Photo forces the camera via
          capture="environment" (rear camera, the useful default for golf
          photos); Choose from Gallery has no capture attribute, which is
          what actually lets the OS show the photo library/files picker
          instead of jumping straight to the camera app. This is the fix
          for "tapping Moment opens the phone's file picker" — previously
          there was one input with no capture attribute at all, opened
          immediately on tap, with no in-app choice screen first. */}
      <input ref={cameraInputRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={handleSelect} style={{ display: 'none' }} />
      <input ref={galleryInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={handleSelect} style={{ display: 'none' }} />

      {stage === 'closed' && (
        <button
          type="button"
          onClick={() => setStage('choosing')}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 20,
            background: '#fdf3d9', border: '1px solid #e8c96a', cursor: 'pointer',
            fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 700, color: '#a1791f',
          }}
        >
          📷 Moment
        </button>
      )}

      {/* The composer choice screen itself — the actual redesign. Tapping
          Moment now always lands here first, never directly in the
          phone's native picker. */}
      {stage === 'choosing' && (
        <div style={{ background: '#ffffff', border: '1px solid #eceae3', borderRadius: 12, padding: 12, marginTop: 8 }}>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, color: '#14532d', marginBottom: 8 }}>
            Capture a Moment
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button type="button" onClick={() => cameraInputRef.current?.click()} style={composerOptionStyle}>
              📷 Take Photo
            </button>
            <button type="button" onClick={() => galleryInputRef.current?.click()} style={composerOptionStyle}>
              🖼️ Choose from Gallery
            </button>
            <button type="button" onClick={() => setStage('textMoment')} style={composerOptionStyle}>
              💬 Text Moment
            </button>
            <button type="button" onClick={resetAll} style={{ ...composerOptionStyle, background: 'none', border: 'none', color: '#9ca3af', fontWeight: 600 }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {stage === 'textMoment' && (
        <div style={{ background: '#ffffff', border: '1px solid #eceae3', borderRadius: 12, padding: 12, marginTop: 8 }}>
          <textarea
            value={caption}
            onChange={e => setCaption(e.target.value)}
            placeholder="What's happening?"
            maxLength={200}
            rows={3}
            style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 10px', fontFamily: 'var(--font-body)', fontSize: 13, marginBottom: 8, resize: 'vertical' }}
          />
          {myGroupId && <AudiencePicker audience={audience} setAudience={setAudience} />}
          {error && <p style={{ color: '#dc2626', fontSize: 11.5, marginBottom: 8, fontFamily: 'var(--font-body)' }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button" onClick={handlePostText} disabled={uploading}
              style={{ flex: 1, padding: 10, borderRadius: 8, background: '#14532d', color: '#fff', border: 'none', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, cursor: uploading ? 'default' : 'pointer', opacity: uploading ? 0.6 : 1 }}
            >
              {uploading ? 'Posting…' : 'Post'}
            </button>
            <button type="button" onClick={resetAll} disabled={uploading} style={cancelButtonStyle}>Cancel</button>
          </div>
        </div>
      )}

      {stage === 'photoPreview' && (
        <div style={{ background: '#ffffff', border: '1px solid #eceae3', borderRadius: 12, padding: 12, marginTop: 8 }}>
          {previewUrl && !previewFailed && (
            // eslint-disable-next-line @next/next/no-img-element -- a
            // local blob: preview URL, not a remote image next/image can
            // optimize
            <img
              src={previewUrl}
              alt="Preview"
              onError={() => { logStage('preview-decode-failed'); setPreviewFailed(true) }}
              style={{ width: '100%', maxHeight: 260, objectFit: 'contain', borderRadius: 8, marginBottom: 8, background: '#f3f4f6' }}
            />
          )}
          {previewFailed && (
            // The preview couldn't be decoded for display, but this does
            // NOT block posting — resolveUploadBlob has its own
            // independent decode attempt, and falls back to the original
            // file if that fails too, so the upload can still succeed
            // even when this preview couldn't render.
            <div style={{ padding: '24px 12px', textAlign: 'center', borderRadius: 8, marginBottom: 8, background: '#f3f4f6' }}>
              <p style={{ fontSize: 28, marginBottom: 4 }}>🖼️</p>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: '#9ca3af' }}>
                Preview unavailable, but you can still post this photo.
              </p>
            </div>
          )}
          <input
            value={caption}
            onChange={e => setCaption(e.target.value)}
            placeholder="Caption (optional)"
            maxLength={200}
            style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 10px', fontFamily: 'var(--font-body)', fontSize: 13, marginBottom: 8 }}
          />
          {myGroupId && <AudiencePicker audience={audience} setAudience={setAudience} />}
          {error && <p style={{ color: '#dc2626', fontSize: 11.5, marginBottom: 8, fontFamily: 'var(--font-body)' }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <button
              type="button" onClick={handlePostPhoto} disabled={uploading}
              style={{ flex: 1, padding: 10, borderRadius: 8, background: '#14532d', color: '#fff', border: 'none', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, cursor: uploading ? 'default' : 'pointer', opacity: uploading ? 0.6 : 1 }}
            >
              {uploadStage === 'preparing' ? 'Preparing photo…' : uploadStage === 'uploading' ? 'Uploading photo…' : 'Post'}
            </button>
            <button type="button" onClick={resetAll} disabled={uploading} style={cancelButtonStyle}>Cancel</button>
          </div>
          <button type="button" onClick={chooseAnother} disabled={uploading} style={{ width: '100%', padding: 8, background: 'none', border: 'none', color: '#9ca3af', fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>
            Choose Another
          </button>
        </div>
      )}
    </div>
  )
}

function AudiencePicker({ audience, setAudience }: { audience: 'everyone' | 'group'; setAudience: (a: 'everyone' | 'group') => void }) {
  return (
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
  )
}

const composerOptionStyle: CSSProperties = {
  width: '100%', textAlign: 'left', padding: '10px 12px', borderRadius: 8,
  background: '#f7f6f1', border: '1px solid #e5e2d9', cursor: 'pointer',
  fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, color: '#14532d',
}

const cancelButtonStyle: CSSProperties = {
  flex: 1, padding: 10, borderRadius: 8, background: '#f3f4f6', border: '1px solid #d1d5db',
  fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, cursor: 'pointer',
}
