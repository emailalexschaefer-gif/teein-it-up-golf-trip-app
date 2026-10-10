'use client'

import React, { useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

/**
 * UploadMomentsModal -- V1.18 (10 Oct), Package 2 ("Upload Moments").
 *
 * Reuses the EXISTING Moments upload/storage architecture end to end
 * -- the same `event-moments` Storage bucket, the same upload path
 * convention (`{tripId}/{roundOrGeneral}/{uploaderId}/{filename}`)
 * MomentCapture.tsx already uses, and the same POST
 * `/api/trips/[tripId]/moments` route every other Moment is created
 * through. No second/parallel media pipeline. The one new thing this
 * sends is `unassigned: true`, a flag the route only honours for the
 * event's own organiser (see moments/route.ts) -- it forces every
 * context field (round, hole, player, group) to null/everyone on the
 * server, never reading whatever this component happens to send, so
 * this component cannot accidentally invent a round/hole/player
 * association even if it tried to.
 *
 * This is deliberately NOT MomentCapture reused directly: that
 * component is tightly bound to live round-scoring context (a
 * roundId, an optional hole, Side Game proxy-entry linking) that has
 * no meaning here -- the whole point of this entry point is photos
 * and videos that arrive OUTSIDE any of that context (e.g. forwarded
 * from WhatsApp after the round). What IS shared between them is the
 * real infrastructure: the Storage bucket, the upload path shape, and
 * the single moments API route -- exactly what "no second/parallel
 * storage system" actually requires.
 *
 * Multiple files upload sequentially, not in parallel -- simpler to
 * reason about and report progress for reliably than a parallel batch,
 * and "multiple files in one operation" doesn't require them to be
 * simultaneous. Each file's own success/failure is tracked and shown
 * independently; a file that fails is clearly marked failed and is
 * never shown as if it had saved -- the per-file status list below is
 * the single source of truth the organiser sees, never a generic "done"
 * message that could paper over a partial failure.
 */

const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime']
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_VIDEO_SECONDS = 15
const MAX_FILES_PER_BATCH = 20

type FileStatus = 'pending' | 'uploading' | 'done' | 'failed'
interface QueuedFile { file: File; status: FileStatus; error?: string }

export default function UploadMomentsModal({ tripId, onClose, onUploaded }: { tripId: string; onClose: () => void; onUploaded: () => void }) {
  const [queue, setQueue] = useState<QueuedFile[]>([])
  const [running, setRunning] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function readVideoDuration(file: File): Promise<number> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file)
      const video = document.createElement('video')
      video.preload = 'metadata'
      video.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(video.duration) }
      video.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read this video file.')) }
      video.src = url
    })
  }

  function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).slice(0, MAX_FILES_PER_BATCH)
    e.target.value = ''
    if (files.length === 0) return
    setQueue(files.map(file => ({ file, status: 'pending' as const })))
  }

  async function uploadOne(item: QueuedFile, index: number, userId: string) {
    const isVideo = VIDEO_TYPES.includes(item.file.type)
    const isImage = IMAGE_TYPES.includes(item.file.type)
    setQueue(prev => prev.map((q, i) => i === index ? { ...q, status: 'uploading' } : q))

    if (!isVideo && !isImage) {
      setQueue(prev => prev.map((q, i) => i === index ? { ...q, status: 'failed', error: 'Unsupported file type.' } : q))
      return
    }

    let durationSeconds: number | undefined
    if (isVideo) {
      try {
        durationSeconds = await readVideoDuration(item.file)
      } catch {
        setQueue(prev => prev.map((q, i) => i === index ? { ...q, status: 'failed', error: 'Could not read this video.' } : q))
        return
      }
      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
        setQueue(prev => prev.map((q, i) => i === index ? { ...q, status: 'failed', error: 'Could not read this video’s duration.' } : q))
        return
      }
      if (durationSeconds > MAX_VIDEO_SECONDS) {
        setQueue(prev => prev.map((q, i) => i === index ? { ...q, status: 'failed', error: `Videos must be ${MAX_VIDEO_SECONDS}s or shorter.` } : q))
        return
      }
    }

    const supabase = createClient()
    const extension = isVideo
      ? (item.file.type === 'video/webm' ? 'webm' : item.file.type === 'video/quicktime' ? 'mov' : 'mp4')
      : (item.file.type === 'image/png' ? 'png' : item.file.type === 'image/webp' ? 'webp' : 'jpg')
    // Same bucket, same path convention as MomentCapture -- 'general'
    // in the round-id slot, since this Moment has no round by design.
    const path = `${tripId}/general/${userId}/${Date.now()}-${index}.${extension}`

    const uploadRes = await supabase.storage.from('event-moments').upload(path, item.file, { contentType: item.file.type })
    if (uploadRes.error) {
      setQueue(prev => prev.map((q, i) => i === index ? { ...q, status: 'failed', error: uploadRes.error!.message } : q))
      return
    }

    try {
      const res = await fetch(`/api/trips/${tripId}/moments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imagePath: path, caption: '', unassigned: true,
          ...(isVideo ? { momentType: 'video', durationSeconds } : {}),
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setQueue(prev => prev.map((q, i) => i === index ? { ...q, status: 'failed', error: body.error ?? 'Could not save this Moment.' } : q))
        return
      }
      setQueue(prev => prev.map((q, i) => i === index ? { ...q, status: 'done' } : q))
    } catch {
      setQueue(prev => prev.map((q, i) => i === index ? { ...q, status: 'failed', error: 'Network error while saving.' } : q))
    }
  }

  async function startUpload() {
    setRunning(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setRunning(false); return }
    // Sequential, not parallel -- see the file-level comment. Reads
    // the queue fresh each iteration so a status update from the
    // previous file is reflected before the next one starts.
    for (let i = 0; i < queue.length; i++) {
      await uploadOne(queue[i], i, user.id)
    }
    setRunning(false)
    onUploaded()
  }

  const allSettled = queue.length > 0 && queue.every(q => q.status === 'done' || q.status === 'failed')

  return (
    <div onClick={() => !running && onClose()} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 70, display: 'flex', alignItems: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: '16px 16px 0 0', padding: 20, width: '100%', maxHeight: '80dvh', display: 'flex', flexDirection: 'column' }}>
        <p style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 800, color: '#1a1a16', marginBottom: 4 }}>＋ Upload Moments</p>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: '#9ca3af', marginBottom: 14 }}>
          Add photos or videos from outside the app &mdash; forwarded from WhatsApp, say. These are saved as general Event Memories, with no round, hole, or player guessed for them.
        </p>

        {queue.length === 0 ? (
          <button
            onClick={() => inputRef.current?.click()}
            style={{ padding: '14px 0', borderRadius: 10, border: '1.5px dashed #d9c9a3', background: '#f8f4eb', fontFamily: 'var(--font-body)', fontSize: 13.5, fontWeight: 700, color: '#1a4731', cursor: 'pointer' }}
          >
            Select Files
          </button>
        ) : (
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {queue.map((q, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 10px', borderRadius: 8, background: '#f8f4eb' }}>
                <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{q.file.name}</span>
                <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700, flexShrink: 0, color: q.status === 'done' ? '#1a4731' : q.status === 'failed' ? '#dc2626' : q.status === 'uploading' ? '#7a7260' : '#9ca3af' }}>
                  {q.status === 'pending' && 'Waiting…'}
                  {q.status === 'uploading' && 'Uploading…'}
                  {q.status === 'done' && '✓ Saved'}
                  {q.status === 'failed' && (q.error ? `✗ ${q.error}` : '✗ Failed')}
                </span>
              </div>
            ))}
          </div>
        )}

        <input ref={inputRef} type="file" accept={[...IMAGE_TYPES, ...VIDEO_TYPES].join(',')} multiple onChange={handlePick} style={{ display: 'none' }} />

        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button
            onClick={onClose}
            disabled={running}
            style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: '1px solid #e5e2d9', background: '#fff', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: '#374151', cursor: running ? 'default' : 'pointer', opacity: running ? 0.6 : 1 }}
          >
            {allSettled ? 'Done' : 'Cancel'}
          </button>
          {queue.length > 0 && !allSettled && (
            <button
              onClick={startUpload}
              disabled={running}
              style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: 'none', background: '#1a4731', color: '#fff', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, cursor: running ? 'default' : 'pointer', opacity: running ? 0.6 : 1 }}
            >
              {running ? 'Uploading…' : `Upload ${queue.length} file${queue.length === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
