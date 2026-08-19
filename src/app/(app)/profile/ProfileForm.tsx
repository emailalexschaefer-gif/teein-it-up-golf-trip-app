'use client'

import { useState, useRef } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { initials, avatarColor } from '@/lib/utils'
import ImageCropper from '@/components/shared/ImageCropper'
import { resetInstallCardDismissal } from '@/components/trips/InstallPwaCard'

interface Props {
  userId: string
  authEmail: string
  initialName: string
  initialEmail: string
  initialHandicap: number | null
  avatarUrl: string | null
  initialLocation: string
  initialBio: string
  initialOccupation: string
  initialCompany: string
  initialGolfClub: string
  initialInterests: string[]
  initialAskMeAbout: string
  teeinItUpRole: string
}

type SaveState = 'idle' | 'saving' | 'success' | 'error'

export default function ProfileForm({
  userId, authEmail, initialName, initialEmail, initialHandicap, avatarUrl,
  initialLocation, initialBio, initialOccupation, initialCompany, initialGolfClub, initialInterests, initialAskMeAbout, teeinItUpRole,
}: Props) {
  const router = useRouter()

  const [name, setName]             = useState(initialName)
  const [email, setEmail]           = useState(initialEmail)
  const [hcp, setHcp]               = useState(initialHandicap !== null ? String(initialHandicap) : '')
  const [noHcp, setNoHcp]           = useState(initialHandicap === null && initialName !== '') // null after first join = no hcp
  const [saveState, setSaveState]   = useState<SaveState>('idle')
  const [installResetMsg, setInstallResetMsg] = useState(false)
  const [errorMsg, setErrorMsg]     = useState('')
  const [emailNote, setEmailNote]   = useState('')

  // About Me (Sprint 5I)
  const [location, setLocation]         = useState(initialLocation)
  const [bio, setBio]                   = useState(initialBio)
  const [occupation, setOccupation]     = useState(initialOccupation)
  const [company, setCompany]           = useState(initialCompany)
  const [golfClub, setGolfClub]         = useState(initialGolfClub)
  const [interests, setInterests]       = useState<string[]>(initialInterests)
  const [askMeAbout, setAskMeAbout]     = useState(initialAskMeAbout)

  const INTEREST_OPTIONS = [
    'Golf Trips', 'Business Networking', 'Charity Events', 'AFL', 'Cricket',
    'Basketball', 'Fishing', 'Travel', 'Food & Wine', 'Fitness',
  ]
  function toggleInterest(tag: string) {
    setInterests(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])
  }

  const [currentAvatarUrl, setCurrentAvatarUrl] = useState(avatarUrl)
  const [avatarBusy, setAvatarBusy]             = useState(false)
  const [avatarError, setAvatarError]           = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const userColor    = avatarColor(userId)
  const userInitials = initials(name || '?')

  const emailChanged = email.trim().toLowerCase() !== authEmail.toLowerCase()

  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null)
  const [cropSourceUrl, setCropSourceUrl] = useState<string | null>(null)
  const [uploadStage, setUploadStage] = useState<'idle' | 'preparing' | 'uploading' | 'done'>('idle')

  // Process a selected/captured file into a square, ~512px, compressed
  // JPEG before it's ever uploaded — corrects orientation implicitly
  // (drawing through <img> + canvas normalizes EXIF rotation in every
  // modern browser), crops to a centered square, resizes, and compresses.
  // This is an automatic center-crop, not an interactive reposition/zoom
  // tool — that's a larger feature not attempted in this pass.
  async function processImageFile(file: File): Promise<Blob> {
    const bitmap = await createImageBitmap(file)
    const size = Math.min(bitmap.width, bitmap.height)
    const sx = (bitmap.width - size) / 2
    const sy = (bitmap.height - size) / 2

    const canvas = document.createElement('canvas')
    const targetSize = 512
    canvas.width = targetSize
    canvas.height = targetSize
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas not supported')
    ctx.drawImage(bitmap, sx, sy, size, size, 0, 0, targetSize, targetSize)

    return new Promise((resolve, reject) => {
      canvas.toBlob(
        blob => (blob ? resolve(blob) : reject(new Error('Could not process image'))),
        'image/jpeg', 0.85,
      )
    })
  }

  async function handleAvatarSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file later
    if (!file) return

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setAvatarError('Unsupported image type.')
      return
    }
    if (file.size > 8 * 1024 * 1024) {
      setAvatarError('Photo is too large.')
      return
    }

    // Priority 4/6 — crop stage inserted here, before the existing
    // pipeline. cropSourceUrl holds the RAW, unprocessed file — cropping
    // needs the original image, not something already center-cropped/
    // resized. The existing processImageFile step now runs AFTER the
    // player's chosen crop, in handleCropSave below, not here — this
    // extends the existing pipeline (still resizes to a sensible final
    // resolution, still compresses) rather than replacing it.
    setAvatarError('')
    setCropSourceUrl(URL.createObjectURL(file))
  }

  async function handleCropSave(croppedBlob: Blob) {
    setCropSourceUrl(null)
    setUploadStage('preparing')
    try {
      const processed = await processImageFile(new File([croppedBlob], 'crop.jpg', { type: 'image/jpeg' }))
      setPreviewBlob(processed)
      setPreviewUrl(URL.createObjectURL(processed))
    } catch {
      setAvatarError('Could not process that image. Please try again.')
    } finally {
      setUploadStage('idle')
    }
  }

  function cancelPreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setPreviewBlob(null)
  }

  async function confirmUpload() {
    if (!previewBlob) return
    setAvatarBusy(true)
    setAvatarError('')
    setUploadStage('uploading')

    const supabase = createClient()
    const path = `${userId}/avatar.jpg`

    const { error: uploadErr } = await supabase.storage.from('profile-photos').upload(path, previewBlob, { upsert: true, contentType: 'image/jpeg' })
    if (uploadErr) {
      setAvatarBusy(false)
      setUploadStage('idle')
      // Precise, non-technical messages — the exact "Bucket not found"
      // class of error is exactly what should never reach a user.
      if (uploadErr.message?.toLowerCase().includes('bucket not found')) {
        setAvatarError('Photo storage is not configured.')
      } else if (uploadErr.message?.toLowerCase().includes('permission') || uploadErr.message?.toLowerCase().includes('policy')) {
        setAvatarError('Upload permission denied.')
      } else {
        setAvatarError('Upload failed. Please try again.')
      }
      console.error('[avatar upload]', uploadErr)
      return
    }

    const { data: urlData } = supabase.storage.from('profile-photos').getPublicUrl(path)
    // Cache-bust so the new image actually shows immediately instead of a
    // browser-cached copy of the old file at the same URL.
    const bustedUrl = `${urlData.publicUrl}?v=${Date.now()}`

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db: any = supabase
    const { error: dbErr } = await db.from('profiles').update({ avatar_url: bustedUrl, updated_at: new Date().toISOString() }).eq('id', userId)
    setAvatarBusy(false)
    if (dbErr) {
      setUploadStage('idle')
      setAvatarError('Upload failed. Please try again.')
      console.error('[avatar profile update]', dbErr)
      return
    }
    setUploadStage('done')
    setCurrentAvatarUrl(bustedUrl)
    cancelPreview()
    router.refresh()
    setTimeout(() => setUploadStage('idle'), 1800)
  }

  async function handleRemoveAvatar() {
    setAvatarBusy(true)
    setAvatarError('')
    const supabase = createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db: any = supabase
    const { error: dbErr } = await db.from('profiles').update({ avatar_url: null, updated_at: new Date().toISOString() }).eq('id', userId)
    setAvatarBusy(false)
    if (dbErr) {
      setAvatarError('Upload failed. Please try again.')
      console.error('[avatar remove]', dbErr)
      return
    }
    setCurrentAvatarUrl(null)
    router.refresh()
  }
  const handicapVal  = noHcp ? null : (hcp === '' ? null : parseFloat(hcp))

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setErrorMsg('Name is required'); setSaveState('error'); return }
    if (!email.trim() || !/^[^@]+@[^@]+\.[^@]+$/.test(email)) {
      setErrorMsg('A valid email is required'); setSaveState('error'); return
    }
    if (bio.length > 200) { setErrorMsg('About Me must be 200 characters or fewer'); setSaveState('error'); return }

    setSaveState('saving')
    setErrorMsg('')
    setEmailNote('')

    const supabase = createClient()

    // 1. Update name and handicap in profiles table
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db: any = supabase
    const { error: profileErr } = await db
      .from('profiles')
      .update({
        full_name: name.trim(),
        handicap: handicapVal,
        location: location.trim() || null,
        bio: bio.trim() || null,
        occupation: occupation.trim() || null,
        company: company.trim() || null,
        golf_club: golfClub.trim() || null,
        interests,
        ask_me_about: askMeAbout.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)

    if (profileErr) {
      setSaveState('error')
      setErrorMsg(`Failed to save profile: ${profileErr.message}`)
      return
    }

    // 2. Handle email change via Supabase Auth (sends confirmation email)
    if (emailChanged) {
      const { error: emailErr } = await supabase.auth.updateUser({ email: email.trim() })
      if (emailErr) {
        setSaveState('error')
        setErrorMsg(`Failed to update email: ${emailErr.message}`)
        return
      }
      // Email confirmation may be required — inform the user
      setEmailNote(
        `A confirmation link has been sent to ${email.trim()}. ` +
        `Your email will update after you click the link. ` +
        `Until then your account still uses ${authEmail}.`
      )
    }

    setSaveState('success')
    // Refresh server components so name updates in nav and trip pages
    router.refresh()
  }

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <Link href="/dashboard" style={{
          fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600,
          color: '#7a7260', textDecoration: 'none', display: 'inline-block', marginBottom: 8,
        }}>← Dashboard</Link>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: '#1a1a16' }}>
          My Profile
        </h1>
      </div>

      {/* Avatar */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 24 }}>
        {currentAvatarUrl ? (
          <div style={{ position: 'relative', width: 72, height: 72, borderRadius: '50%', overflow: 'hidden',
            border: '3px solid #d9c9a3', boxShadow: '0 4px 16px rgba(0,0,0,0.12)' }}>
            <Image src={currentAvatarUrl} alt={name} fill sizes="72px" className="object-cover" />
          </div>
        ) : (
          <div style={{
            width: 72, height: 72, borderRadius: '50%', flexShrink: 0,
            background: userColor, border: '3px solid #d9c9a3',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#ffffff', fontWeight: 800, fontSize: 22,
            fontFamily: 'var(--font-body)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          }}>
            {userInitials}
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleAvatarSelected}
          style={{ display: 'none' }}
        />

        <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={avatarBusy}
            style={{
              fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, color: '#1a4731',
              background: 'none', border: 'none', cursor: avatarBusy ? 'default' : 'pointer',
              textDecoration: 'underline', opacity: avatarBusy ? 0.5 : 1,
            }}
          >
            {uploadStage === 'preparing' ? 'Preparing photo…' : avatarBusy ? 'Working…' : currentAvatarUrl ? 'Change photo' : 'Upload photo'}
          </button>
          {currentAvatarUrl && (
            <button
              type="button"
              onClick={handleRemoveAvatar}
              disabled={avatarBusy}
              style={{
                fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600, color: '#9ca3af',
                background: 'none', border: 'none', cursor: avatarBusy ? 'default' : 'pointer',
                textDecoration: 'underline', opacity: avatarBusy ? 0.5 : 1,
              }}
            >
              Remove
            </button>
          )}
        </div>
        {avatarError && (
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: '#dc2626', marginTop: 6, textAlign: 'center' }}>{avatarError}</p>
        )}
        {uploadStage === 'done' && (
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: '#16a34a', fontWeight: 700, marginTop: 6, textAlign: 'center' }}>Profile photo updated</p>
        )}
      </div>

      {/* ── Identity Card — auto-populated summary, not a separate form.
          Updates live from the same state the editable fields below use;
          Role is server-computed from actual trip_members rows, not
          user-editable. ────────────────────────────────────────────────── */}
      <div style={{
        background: 'linear-gradient(135deg,#14532d,#1a6b3a)', borderRadius: 14, padding: '16px 18px',
        marginBottom: 20, boxShadow: '0 4px 18px rgba(20,83,45,0.2)', textAlign: 'center',
      }}>
        <div style={{ fontFamily: 'var(--font-display)', color: '#fff', fontSize: 17, fontWeight: 800 }}>
          {name || 'Your name'}
        </div>
        {!noHcp && hcp && (
          <div style={{ fontFamily: 'var(--font-body)', color: '#e8c96a', fontSize: 12.5, marginTop: 2 }}>
            Playing Handicap: {hcp}
          </div>
        )}
        {location && (
          <div style={{ fontFamily: 'var(--font-body)', color: 'rgba(255,255,255,0.7)', fontSize: 12.5, marginTop: 2 }}>
            {location}
          </div>
        )}
        <div style={{
          display: 'inline-block', marginTop: 8, fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 700,
          color: '#a1791f', background: '#fdf3d9', border: '1px solid #e8c96a', borderRadius: 12, padding: '3px 12px',
        }}>
          {teeinItUpRole}
        </div>
      </div>

      {/* Preview/confirm modal — shown after a photo is selected/captured
          and processed (auto center-cropped to square, resized), before
          any upload happens. Not an interactive reposition/zoom tool —
          that's a larger feature not attempted in this pass. */}
      {previewUrl && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: '#ffffff', borderRadius: 16, padding: 20, maxWidth: 320, width: '100%', textAlign: 'center' }}>
            <p style={{ fontFamily: 'var(--font-body)', fontWeight: 700, color: '#14532d', fontSize: 14, marginBottom: 12 }}>Preview</p>
            {/* eslint-disable-next-line @next/next/no-img-element -- a local blob: URL, not a remote/optimizable image */}
            <img
              src={previewUrl}
              alt="Preview"
              style={{ width: 160, height: 160, borderRadius: '50%', objectFit: 'cover', border: '3px solid #d9c9a3', margin: '0 auto 16px' }}
            />
            {uploadStage === 'uploading' && (
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#9ca3af', marginBottom: 10 }}>Uploading photo…</p>
            )}
            {avatarError && (
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: '#dc2626', marginBottom: 10 }}>{avatarError}</p>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                type="button"
                onClick={confirmUpload}
                disabled={avatarBusy}
                style={{ padding: 12, borderRadius: 10, background: '#14532d', color: '#fff', border: 'none', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13.5, cursor: avatarBusy ? 'default' : 'pointer', opacity: avatarBusy ? 0.6 : 1 }}
              >
                {avatarBusy ? 'Uploading…' : 'Use Photo'}
              </button>
              <button
                type="button"
                onClick={() => { cancelPreview(); fileInputRef.current?.click() }}
                disabled={avatarBusy}
                style={{ padding: 12, borderRadius: 10, background: '#f3f4f6', border: '1px solid #d1d5db', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}
              >
                Choose Another
              </button>
              <button
                type="button"
                onClick={cancelPreview}
                disabled={avatarBusy}
                style={{ padding: 10, background: 'none', border: 'none', fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#9ca3af', cursor: 'pointer' }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSave}>
        <div className="card p-5 space-y-4">

          {/* Full name */}
          <Field label="Full name" required>
            <input
              type="text" value={name} maxLength={80} required
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
              placeholder="James Smith"
              style={inputStyle}
            />
          </Field>

          {/* Email */}
          <Field label="Email address" required hint={emailChanged ? 'A confirmation link will be sent to your new email.' : undefined}>
            <input
              type="email" value={email} required
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={inputStyle}
            />
          </Field>

          {/* Handicap */}
          <Field label="Golf handicap" hint="Your default handicap for future trips.">
            {!noHcp && (
              <input
                type="number" min={0} max={54} step={0.1}
                value={hcp}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setHcp(e.target.value)}
                placeholder="e.g. 14 or 14.5"
                disabled={noHcp}
                style={{ ...inputStyle, marginBottom: 8 }}
              />
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox" checked={noHcp}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  setNoHcp(e.target.checked)
                  if (e.target.checked) setHcp('')
                }}
              />
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#7a7260' }}>No official handicap</span>
            </label>
          </Field>

          {/* Location */}
          <Field label="Home location" hint="City/suburb — shown on your Identity Card.">
            <input
              type="text" value={location} maxLength={80}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLocation(e.target.value)}
              placeholder="e.g. Melbourne, Victoria"
              style={inputStyle}
            />
          </Field>

        </div>

        {/* ── About Me ─────────────────────────────────────────────────── */}
        <div className="card p-5 space-y-4" style={{ marginTop: 16 }}>
          <div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 800, color: '#1a1a16', marginBottom: 2 }}>About Me</h2>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#7a7260' }}>Tell other golfers a little about yourself.</p>
          </div>
          <div>
            <textarea
              value={bio} maxLength={200} rows={4}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setBio(e.target.value)}
              placeholder="Head of Marketing. Sandhurst member. Love golf trips, business networking and helping organise charity golf days."
              style={{ ...inputStyle, resize: 'vertical', minHeight: 90 }}
            />
            <div style={{ textAlign: 'right', fontFamily: 'var(--font-body)', fontSize: 11, color: bio.length > 200 ? '#dc2626' : '#9ca3af', marginTop: 4 }}>
              {bio.length}/200
            </div>
          </div>

          <Field label="Occupation">
            <input
              type="text" value={occupation} maxLength={80}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setOccupation(e.target.value)}
              placeholder="e.g. Marketing Manager"
              style={inputStyle}
            />
          </Field>

          <Field label="Company / Organisation">
            <input
              type="text" value={company} maxLength={80}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCompany(e.target.value)}
              placeholder="e.g. Nexans"
              style={inputStyle}
            />
          </Field>

          <Field label="Golf club">
            <input
              type="text" value={golfClub} maxLength={80}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setGolfClub(e.target.value)}
              placeholder="e.g. Royal Melbourne"
              style={inputStyle}
            />
          </Field>

          <div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: '#3d3a2f', marginBottom: 8 }}>Interests</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {INTEREST_OPTIONS.map(tag => {
                const active = interests.includes(tag)
                return (
                  <button
                    type="button" key={tag} onClick={() => toggleInterest(tag)}
                    style={{
                      fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 600,
                      padding: '6px 13px', borderRadius: 18, cursor: 'pointer',
                      background: active ? '#14532d' : '#f8f4eb',
                      color: active ? '#fff' : '#3d3a2f',
                      border: active ? '1.5px solid #14532d' : '1.5px solid #e5ddc8',
                    }}
                  >
                    {tag}
                  </button>
                )
              })}
            </div>
          </div>

          <Field label="Ask me about..." hint="A conversation starter, shown prominently on your profile.">
            <input
              type="text" value={askMeAbout} maxLength={60}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAskMeAbout(e.target.value)}
              placeholder="e.g. Golf Trips, AFL, Property"
              style={inputStyle}
            />
          </Field>

        </div>

        {/* Success */}
        {saveState === 'success' && (
          <div style={{
            margin: '12px 0', padding: '12px 14px', borderRadius: 10,
            background: '#f0fdf4', border: '1.5px solid #86efac',
            fontFamily: 'var(--font-body)', fontSize: 13, color: '#166534', fontWeight: 600,
          }}>
            ✓ Profile saved
            {emailNote && (
              <p style={{ fontWeight: 400, fontSize: 12, marginTop: 4, color: '#15803d' }}>{emailNote}</p>
            )}
          </div>
        )}

        {/* Error */}
        {saveState === 'error' && (
          <div style={{
            margin: '12px 0', padding: '12px 14px', borderRadius: 10,
            background: '#fef2f2', border: '1.5px solid #fca5a5',
            fontFamily: 'var(--font-body)', fontSize: 13, color: '#b91c1c',
          }}>
            {errorMsg}
          </div>
        )}

        {/* Save button */}
        <button
          type="submit"
          disabled={saveState === 'saving'}
          style={{
            width: '100%', marginTop: 16,
            padding: '14px 20px', borderRadius: 12, border: 'none', cursor: 'pointer',
            background: saveState === 'saving' ? '#9db8a8' : 'linear-gradient(135deg, #2d7a52, #1a4731)',
            fontFamily: 'var(--font-body)', fontSize: 15, fontWeight: 700, color: '#ffffff',
            boxShadow: saveState === 'saving' ? 'none' : '0 3px 12px rgba(26,71,49,0.35)',
          }}
        >
          {saveState === 'saving' ? 'Saving…' : 'Save Changes'}
        </button>
      </form>

      {/* Reset password link */}
      <div style={{ marginTop: 12, textAlign: 'center' }}>
        <Link href="/reset-password" style={{
          fontFamily: 'var(--font-body)', fontSize: 13, color: '#1a4731',
          textDecoration: 'none', fontWeight: 600,
        }}>
          Reset password
        </Link>
      </div>

      {/* "Remains discoverable later" — resets the same dismissal flag
          the Lobby card itself checks, so the concierge card appears
          again the next time this player opens an Event Lobby. Kept to
          a single link + brief confirmation rather than rendering the
          full card or iOS sheet here — the actual install action still
          only ever happens in the Lobby, where the real context (a
          specific event) makes it feel incidental rather than a
          settings-page chore. */}
      <div style={{ marginTop: 8, textAlign: 'center' }}>
        <button
          onClick={() => { resetInstallCardDismissal(); setInstallResetMsg(true); setTimeout(() => setInstallResetMsg(false), 3000) }}
          style={{
            background: 'none', border: 'none', fontFamily: 'var(--font-body)', fontSize: 13,
            color: '#1a4731', fontWeight: 600, cursor: 'pointer', padding: 0,
          }}
        >
          📱 {installResetMsg ? 'You\u2019ll see it next time you open an event' : 'Show "Add to Home Screen" again'}
        </button>
      </div>

      {/* Note about trip handicaps */}
      <div style={{
        marginTop: 16, padding: '10px 14px', borderRadius: 10,
        background: '#faf6ed', border: '1px solid #d9c9a3',
      }}>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#7a7260' }}>
          <strong style={{ color: '#1a1a16' }}>Trip handicaps:</strong>{' '}
          Updating your profile handicap sets your default for future trips.
          It does not change the playing handicap for any current trips.
          To update a trip-specific handicap, go to the trip and use Edit HCP in the Players tab.
        </p>
      </div>

      {cropSourceUrl && (
        <ImageCropper
          imageSrc={cropSourceUrl}
          cropShape="round"
          title="Position Your Photo"
          onCancel={() => setCropSourceUrl(null)}
          onSave={blob => void handleCropSave(blob)}
        />
      )}
    </div>
  )
}

function Field({ label, required, hint, children }: React.PropsWithChildren<{
  label: string; required?: boolean; hint?: string
}>) {
  return (
    <div>
      <label style={{
        display: 'block', fontFamily: 'var(--font-body)',
        fontSize: 11, fontWeight: 700, color: '#7a7260',
        letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 6,
      }}>
        {label}{required && <span style={{ color: '#ef4444', marginLeft: 3 }}>*</span>}
      </label>
      {hint && (
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#a89e88', marginBottom: 6 }}>{hint}</p>
      )}
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', borderRadius: 10,
  border: '1.5px solid #d9c9a3',
  padding: '11px 14px', fontSize: 14,
  fontFamily: 'var(--font-body)', color: '#1a1a16',
  background: '#ffffff', outline: 'none',
  boxSizing: 'border-box',
}
