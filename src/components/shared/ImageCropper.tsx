'use client'

import { useState, useCallback } from 'react'
import Cropper, { type Area } from 'react-easy-crop'

/**
 * Priority 4 — one reusable cropper for both contexts named in the
 * brief. cropShape is purely the visual guide overlay react-easy-crop
 * draws — it does NOT change what gets extracted. Both modes always
 * produce a genuinely square canvas region (Priority/item 25's "square
 * file, circular display" rule) — 'round' just shows a circular mask
 * so a player can see how their avatar will actually appear; a square
 * file comes out of getCroppedImageBlob() either way, and the existing
 * circular CSS treatment used throughout the app handles the rest.
 *
 * getCroppedImageBlob draws only the user-selected region onto a
 * canvas — this is the crop/reposition/zoom step. The RESULT still
 * gets passed through the existing processImageFile (resize to
 * targetSize, JPEG compression) before upload, so this component adds
 * a crop stage in front of the existing pipeline rather than
 * replacing it.
 */
export type CropShape = 'round' | 'rect'

// Priority 3 — cropper processing failure investigation. Traced the
// full pipeline per the brief's own list. The one genuine issue found:
// img.crossOrigin = 'anonymous' was set unconditionally, including for
// blob: URLs (which is what imageSrc always is here — created via
// URL.createObjectURL in both MomentCapture and EventLogoCard). Blob
// URLs are inherently same-origin and need no CORS handling at all;
// setting crossOrigin on them anyway is a well-documented cross-browser
// inconsistency — some mobile browser versions (Android Chrome
// included, historically) can fail to load an <img> entirely when
// crossOrigin is set on a same-origin blob URL, rather than simply
// ignoring the unnecessary attribute. Removed — there was never a
// cross-origin image involved here to protect against in the first
// place. Everything else in this function (canvas dimensions from the
// crop area, drawImage, toBlob, MIME type) traced correctly and needed
// no change.
//
// Distinct, stage-specific error messages added for diagnosis (dev
// console only — production UI in ImageCropper.tsx stays as one clean
// message, per "the production UI can remain clean").
async function getCroppedImageBlob(imageSrc: string, cropPixels: Area): Promise<Blob> {
  if (!cropPixels.width || !cropPixels.height || Number.isNaN(cropPixels.width) || Number.isNaN(cropPixels.height)) {
    console.error('[ImageCropper] invalid crop dimensions', cropPixels)
    throw new Error('Crop generation failed: invalid crop area.')
  }

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Crop generation failed: could not decode the selected image.'))
    img.src = imageSrc
  })

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(cropPixels.width)
  canvas.height = Math.round(cropPixels.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    console.error('[ImageCropper] 2D canvas context unavailable')
    throw new Error('Crop generation failed: canvas not supported on this device.')
  }

  try {
    ctx.drawImage(
      image,
      cropPixels.x, cropPixels.y, cropPixels.width, cropPixels.height,
      0, 0, canvas.width, canvas.height,
    )
  } catch (err) {
    console.error('[ImageCropper] drawImage failed', err)
    throw new Error('Crop generation failed: could not render the crop.')
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => {
        if (!blob) {
          console.error('[ImageCropper] canvas.toBlob produced no output', { width: canvas.width, height: canvas.height })
          reject(new Error('Crop generation failed: could not export the cropped image.'))
          return
        }
        resolve(blob)
      },
      'image/jpeg', 0.92, // higher quality than the final processImageFile pass — this is an intermediate step, not the final stored file
    )
  })
}

export default function ImageCropper({
  imageSrc, cropShape, aspect = 1, title, saveLabel = 'Save Photo', onCancel, onSave,
}: {
  imageSrc: string
  cropShape: CropShape
  // Priority 4 (Moments) — the one new configuration point this shared
  // component needed. Profile/logo usages don't pass this at all
  // (defaults to 1, their existing square behaviour, completely
  // unchanged). Moments passes 4/3 — a genuine "photograph" ratio, not
  // the tight square item 4 explicitly warns against forcing on every
  // Moment. The crop ENGINE stays identical either way; only the shape
  // of the crop area changes.
  aspect?: number
  title: string
  // Same idea — "Use Photo" for Moments (item 7: this should feel like
  // photography, not image-editing software) vs. the existing "Save
  // Photo" for profile/logo, both driven by one component.
  saveLabel?: string
  onCancel: () => void
  onSave: (blob: Blob) => void
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const onCropComplete = useCallback((_croppedArea: Area, pixels: Area) => {
    setCroppedAreaPixels(pixels)
  }, [])

  async function handleSave() {
    if (!croppedAreaPixels) return
    setSaving(true)
    setError('')
    try {
      const blob = await getCroppedImageBlob(imageSrc, croppedAreaPixels)
      onSave(blob)
    } catch (err) {
      // Priority 3 — the specific stage-labelled error from
      // getCroppedImageBlob was previously discarded entirely (a bare
      // catch {}), which is exactly why every failure surfaced as the
      // same generic message with no way to diagnose which stage
      // actually failed. Logged here (dev diagnosis), production UI
      // message stays clean and unchanged.
      console.error('[ImageCropper] crop save failed', err instanceof Error ? err.message : err)
      setError('Could not process that image. Please try again.')
      setSaving(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 200, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '16px 16px 8px', textAlign: 'center' }}>
        <span style={{ fontFamily: 'var(--font-display)', color: '#fff', fontSize: 16, fontWeight: 800 }}>{title}</span>
      </div>

      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <Cropper
          image={imageSrc}
          crop={crop}
          zoom={zoom}
          aspect={aspect}
          cropShape={cropShape}
          showGrid={cropShape === 'rect'}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={onCropComplete}
        />
      </div>

      <div style={{
        padding: '16px 20px', background: '#0f2d1c',
        paddingBottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <span style={{ fontFamily: 'var(--font-body)', color: 'rgba(245,230,184,0.7)', fontSize: 18 }}>−</span>
          <input
            type="range" min={1} max={3} step={0.01} value={zoom}
            onChange={e => setZoom(Number(e.target.value))}
            style={{ flex: 1, accentColor: '#c9a84c' }}
            aria-label="Zoom"
          />
          <span style={{ fontFamily: 'var(--font-body)', color: 'rgba(245,230,184,0.7)', fontSize: 18 }}>+</span>
        </div>

        {error && <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#fca5a5', marginBottom: 10, textAlign: 'center' }}>{error}</p>}

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={onCancel}
            disabled={saving}
            style={{ flex: 1, padding: 13, borderRadius: 10, background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving || !croppedAreaPixels}
            style={{ flex: 1, padding: 13, borderRadius: 10, background: '#c9a84c', border: 'none', color: '#0f2d1c', fontFamily: 'var(--font-body)', fontWeight: 800, fontSize: 14, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.7 : 1 }}
          >
            {saving ? 'Saving…' : saveLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
