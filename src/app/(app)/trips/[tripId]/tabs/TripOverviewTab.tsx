'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { formatTripDateRange } from '@/lib/utils'
import { TRIP_STATUS_LABELS, EVENT_TYPE_OPTIONS } from '@/types/app'
import type { TripData } from '../TripDetailClient'
import TripInformationCard from '@/components/trips/TripInformationCard'
import { createClient } from '@/lib/supabase/client'
import { processImageFile } from '@/lib/imageProcessing'
import ImageCropper from '@/components/shared/ImageCropper'

type Tab = 'overview' | 'players' | 'groups' | 'rounds'

interface Props {
  trip: TripData; isOrganiser: boolean; playerCount: number; numGroups: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateStatus: any; toast: any; router: any
  onTabChange: (tab: Tab) => void
}

export default function TripOverviewTab({ trip, isOrganiser, playerCount, numGroups, updateStatus, toast, router, onTabChange }: Props) {
  const [showArchiveDialog, setShowArchiveDialog] = useState(false)
  const [showDeleteDialog,  setShowDeleteDialog]  = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [restoring, setRestoring] = useState(false)

  const eventLabel   = EVENT_TYPE_OPTIONS.find(o => o.value === trip.event_type)?.label ?? 'Golf Trip'
  const expected     = trip.expected_players ?? 0
  const ppg          = trip.players_per_group ?? 4

  const isArchived = trip.status === 'archived'

  async function handleRestore() {
    setRestoring(true)
    // Infer the right restore target from existing trip data:
    // - any completed round → restore to 'completed'
    // - has players but no completed rounds → restore to 'open'
    // - pure draft (no players, no rounds) → restore to 'draft'
    const hasCompletedRound = trip.rounds.some(r => r.status === 'completed')
    const hasPlayers = trip.trip_members.some(m => m.role === 'player')
    const restoreStatus: import('@/types/app').TripStatus =
      hasCompletedRound ? 'completed'
      : hasPlayers       ? 'open'
      :                    'draft'
    await updateStatus.mutateAsync({ tripId: trip.id, status: restoreStatus })
    toast(`Trip restored to ${TRIP_STATUS_LABELS[restoreStatus]}`, 'success')
    router.refresh()
    setRestoring(false)
  }

  async function handleArchive() {
    await updateStatus.mutateAsync({ tripId: trip.id, status: 'archived' })
    toast('Trip archived', 'success')
    setShowArchiveDialog(false)
    router.push('/dashboard')
  }

  async function handleDelete() {
    if (deleteConfirmText !== 'DELETE') return
    setDeleting(true)
    const res = await fetch(`/api/trips/${trip.id}`, { method: 'DELETE' })
    setDeleting(false)
    if (res.ok) {
      toast('Trip permanently deleted', 'success')
      router.push('/dashboard')
    } else {
      const d = await res.json().catch(() => ({}))
      toast(d.error ?? 'Failed to delete trip', 'error')
      setShowDeleteDialog(false)
    }
  }

  return (
    <>
      <div className="space-y-4">

        {/* ── Archived banner ──────────────────────────────────────────── */}
        {isArchived && (
          <div style={{
            background: '#f8f4eb', border: '1.5px solid #d9c9a3', borderRadius: 12, padding: '14px 16px',
          }}>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: '#1a1a16', marginBottom: 4 }}>
              This trip is archived
            </p>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#7a7260', marginBottom: 12 }}>
              All players, groups, rounds and results are preserved. You can restore or permanently delete this trip.
            </p>
            <div className="flex gap-2">
              <button onClick={handleRestore} disabled={restoring} style={{
                flex: 1, padding: '10px 14px', borderRadius: 10, border: 'none',
                background: 'linear-gradient(135deg, #2d7a52, #1a4731)', cursor: 'pointer',
                fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, color: '#ffffff',
                opacity: restoring ? 0.5 : 1,
              }}>
                {restoring ? 'Restoring…' : 'Restore Trip'}
              </button>
              {isOrganiser && (
                <button onClick={() => { setDeleteConfirmText(''); setShowDeleteDialog(true) }} style={{
                  padding: '10px 14px', borderRadius: 10,
                  border: '1.5px solid #fca5a5', background: '#fff',
                  fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: '#b91c1c',
                  cursor: 'pointer',
                }}>
                  Delete Permanently
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Stat strip ───────────────────────────────────────────────── */}
        <div className="card p-4">
          <div className="flex" style={{ gap: 0 }}>
            <StatCell
              icon="👥"
              value={playerCount}
              sub={expected > 0
                ? (playerCount > expected ? `(${playerCount - expected} over)` : `of ${expected}`)
                : 'players'}
              label="Players"
            />
            <div style={{ width: 1, background: '#ede0c4' }} />
            <StatCell icon="⛳" value={trip.rounds.length} sub="rounds" label="Rounds" />
            <div style={{ width: 1, background: '#ede0c4' }} />
            <StatCell icon="🏌️" value={numGroups} sub="groups" label="Groups" />
          </div>
        </div>

        {/* Item A — event logo, organiser-only, right at the top of
            Trip Details (the "sensible place... later" the brief asks
            for — creation-wizard placement deliberately not attempted
            in this pass, to avoid adding friction/regression risk to
            an already-working wizard flow under this brief's own time
            constraints). Players never see this control — trip.logo_url
            already displays for everyone via TripCard's existing
            graceful-fallback rendering, unchanged. */}
        {isOrganiser && <EventLogoCard trip={trip} />}

        {/* ── Trip details ─────────────────────────────────────────────── */}
        <div className="card p-4 space-y-3">
          <p className="s-label">Trip details</p>
          <InfoRow label="Type"   value={eventLabel} />
          <InfoRow label="Dates"  value={formatTripDateRange(trip.start_date, trip.end_date)} />
          {trip.location    && <InfoRow label="Location"    value={trip.location} />}
          {trip.description && (
            <div className="flex gap-3">
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#a89e88', width: 72, flexShrink: 0, paddingTop: 1 }}>About</span>
              {/* Bug fix — this previously reused InfoRow, which renders
                  value as a bare <span> with no whitespace handling at
                  all, collapsing every line break and blank line the
                  organiser typed. Trip Information (TripInformationCard)
                  already solved this correctly (whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word') — same treatment applied here,
                  not reinvented. Display-only, same trip.description
                  data, no data-model change. */}
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#1a1a16', flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>
                {trip.description}
              </p>
            </div>
          )}
          {ppg > 0          && <InfoRow label="Group size"  value={`${ppg} players per group`} />}
          <InfoRow label="Status" value={TRIP_STATUS_LABELS[trip.status]} />
          {(trip.organiser_is_playing ?? false) && <InfoRow label="Organiser" value="Also playing" />}
        </div>

        {/* ── Trip information ─────────────────────────────────────────── */}
        <TripInformationCard tripId={trip.id} isOrganiser={isOrganiser} />

        {/* ── Organiser management: Archive / Delete (non-archived
            trips). The manual "Move trip to next stage" forward/backward
            status controls that used to sit here were removed — trip
            lifecycle now progresses automatically (first player join,
            group readiness, round start, round completion), so there is
            no longer a status for the organiser to manually select. ── */}
        {isOrganiser && !isArchived && (
          <div className="card p-4">
            <p className="s-label" style={{ marginBottom: 10 }}>Trip management</p>
            <div style={{ paddingTop: 0 }}>
              <button
                onClick={() => setShowArchiveDialog(true)}
                style={{
                  width: '100%', padding: '9px 16px', borderRadius: 10,
                  border: '1.5px solid #d9c9a3', background: 'transparent', cursor: 'pointer',
                  fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600, color: '#7a7260',
                }}
              >
                Archive Trip
              </button>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#a89e88', marginTop: 4, paddingLeft: 2 }}>
                Hides this trip from your active list. All data is preserved.
              </p>
            </div>

            {/* Delete — only from completed or long-lived statuses */}
            {['completed', 'draft'].includes(trip.status) && (
              <div style={{ marginTop: 8 }}>
                <button
                  onClick={() => { setDeleteConfirmText(''); setShowDeleteDialog(true) }}
                  style={{
                    width: '100%', padding: '9px 16px', borderRadius: 10,
                    border: '1.5px solid #fca5a5', background: 'transparent', cursor: 'pointer',
                    fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600, color: '#b91c1c',
                  }}
                >
                  Delete Trip Permanently
                </button>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#a89e88', marginTop: 4, paddingLeft: 2 }}>
                  Permanently removes all trip data. Cannot be undone.
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── Bottom nav ───────────────────────────────────────────────── */}
        {!isArchived && (
          <WizardNav
            backHref="/dashboard" backLabel="← My Trips"
            onNext={() => onTabChange('players')} nextLabel="Add Players →"
          />
        )}
        {isArchived && (
          <WizardNav backHref="/dashboard" backLabel="← My Trips" />
        )}
      </div>

      {/* ── Archive confirmation dialog ──────────────────────────────── */}
      {showArchiveDialog && (
        <Dialog onClose={() => setShowArchiveDialog(false)}>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: '#1a1a16', marginBottom: 6 }}>
            Archive Trip?
          </p>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#7a7260', marginBottom: 20 }}>
            This removes the trip from your active list. All players, groups, rounds and results are preserved.
            You can restore it at any time.
          </p>
          <div className="flex gap-3">
            <button onClick={() => setShowArchiveDialog(false)} style={{
              flex: 1, padding: '12px 16px', borderRadius: 10,
              border: '1.5px solid #d9c9a3', background: 'transparent', cursor: 'pointer',
              fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: '#7a7260',
            }}>Cancel</button>
            <button onClick={handleArchive} disabled={updateStatus.isPending} style={{
              flex: 1, padding: '12px 16px', borderRadius: 10, border: 'none',
              background: '#1a4731', cursor: 'pointer',
              fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, color: '#ffffff',
              opacity: updateStatus.isPending ? 0.5 : 1,
            }}>Archive</button>
          </div>
        </Dialog>
      )}

      {/* ── Delete confirmation dialog ───────────────────────────────── */}
      {showDeleteDialog && (
        <Dialog onClose={() => !deleting && setShowDeleteDialog(false)}>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: '#1a1a16', marginBottom: 6 }}>
            Delete Trip?
          </p>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#7a7260', marginBottom: 4 }}>
            This permanently deletes <strong>{trip.name}</strong> and all associated data including players, groups, rounds and scores.
          </p>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: '#b91c1c', marginBottom: 16 }}>
            This action cannot be undone.
          </p>

          <label style={{
            display: 'block', fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700,
            color: '#b91c1c', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 6,
          }}>
            Type DELETE to confirm
          </label>
          <input
            type="text" value={deleteConfirmText}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDeleteConfirmText(e.target.value)}
            placeholder="DELETE"
            autoCapitalize="characters"
            style={{
              width: '100%', borderRadius: 8,
              border: `1.5px solid ${deleteConfirmText === 'DELETE' ? '#86efac' : '#d9c9a3'}`,
              padding: '10px 12px', fontSize: 14, fontFamily: 'var(--font-body)',
              color: '#1a1a16', background: '#fff', outline: 'none',
              boxSizing: 'border-box', marginBottom: 14,
            }}
          />

          <div className="flex gap-3">
            <button onClick={() => setShowDeleteDialog(false)} disabled={deleting} style={{
              flex: 1, padding: '12px 16px', borderRadius: 10,
              border: '1.5px solid #d9c9a3', background: 'transparent', cursor: 'pointer',
              fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: '#7a7260',
              opacity: deleting ? 0.4 : 1,
            }}>Cancel</button>
            <button
              onClick={handleDelete}
              disabled={deleteConfirmText !== 'DELETE' || deleting}
              style={{
                flex: 1, padding: '12px 16px', borderRadius: 10, border: 'none',
                background: deleteConfirmText === 'DELETE' && !deleting ? '#dc2626' : '#fca5a5',
                cursor: deleteConfirmText === 'DELETE' && !deleting ? 'pointer' : 'not-allowed',
                fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, color: '#ffffff',
              }}
            >
              {deleting ? 'Deleting…' : 'Delete Trip'}
            </button>
          </div>
        </Dialog>
      )}
    </>
  )
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function Dialog({ children, onClose }: React.PropsWithChildren<{ onClose: () => void }>) {
  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 50,
      }} />
      {/* Panel — Package 1 fix: previously had no height constraint at
          all. On a small iPhone with the on-screen keyboard open
          (required here, since confirming needs typing "DELETE"), the
          available viewport shrinks enough that this panel's own bottom
          content — Cancel/Delete Trip — could be pushed below the
          visible area entirely, with no way to reach it. maxHeight +
          overflowY makes the panel itself scroll internally once
          content + keyboard would otherwise overflow, so the CTA is
          always reachable by scrolling within the dialog rather than
          disappearing off-screen. dvh (dynamic viewport height) is used
          over vh specifically because it correctly accounts for mobile
          browser chrome/keyboard changing the visible viewport — a
          fixed vh value doesn't shrink when the keyboard opens. Fixes
          both this dialog and the Archive dialog above, which shares
          this same component and had the identical latent risk even
          though only Delete was reported. */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 51,
        background: '#faf6ed', borderRadius: '20px 20px 0 0',
        padding: '24px 20px 36px',
        boxShadow: '0 -4px 32px rgba(0,0,0,0.18)',
        maxWidth: 540, margin: '0 auto',
        maxHeight: '85dvh', overflowY: 'auto',
      }}>
        {children}
      </div>
    </>
  )
}

function StatCell({ icon, value, sub, label }: { icon: string; value: number | string; sub: string; label: string }) {
  return (
    <div className="flex-1 text-center py-2 px-3">
      <p style={{ fontSize: 22, marginBottom: 2 }}>{icon}</p>
      <p style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, color: '#1a1a16', lineHeight: 1 }}>{value}</p>
      <p style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: '#7a7260', marginTop: 2 }}>{sub || label}</p>
    </div>
  )
}

/**
 * Item A — event logo upload. Directly mirrors ProfileForm.tsx's own
 * proven avatar-upload flow (same processImageFile crop, same preview-
 * then-confirm step, same cache-busting on save) — the only genuine
 * differences are the storage bucket ('event-logos' vs 'profile-
 * photos'), the path prefix (trip.id vs the user's own id, matching
 * migration 059's organiser-scoped RLS), and persisting to
 * trips.logo_url via the existing PATCH /api/trips/[tripId] route
 * (extended earlier in this same change) rather than a direct table
 * update — trips already have a proper organiser-authorised API route
 * for edits, unlike the profile table's simpler direct-update pattern.
 */
function EventLogoCard({ trip }: { trip: TripData }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null)
  const [cropSourceUrl, setCropSourceUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [currentLogoUrl, setCurrentLogoUrl] = useState(trip.logo_url ?? null)

  function handleSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setError('Unsupported image type.'); return }
    if (file.size > 8 * 1024 * 1024) { setError('Image is too large.'); return }
    setError('')
    // Priority 4/7 — same crop stage as ProfileForm, same reusable
    // ImageCropper, different shape only: cropShape="rect" here (a
    // square guide with grid lines, no circular mask) since event logos
    // render in square/rounded containers throughout the app (event
    // cards, invitation panel), never as a circular avatar.
    setCropSourceUrl(URL.createObjectURL(file))
  }

  async function handleCropSave(croppedBlob: Blob) {
    setCropSourceUrl(null)
    try {
      const processed = await processImageFile(new File([croppedBlob], 'crop.jpg', { type: 'image/jpeg' }))
      setPreviewBlob(processed)
      setPreviewUrl(URL.createObjectURL(processed))
    } catch (err) {
      // Priority 3 — same fix as ImageCropper's own handleSave: log the
      // real error (image processing specifically, not the crop step
      // itself, which already succeeded by the time this runs) instead
      // of a bare catch {} that discarded it entirely.
      console.error('[event logo] image processing failed', err instanceof Error ? err.message : err)
      setError('Could not process that image. Please try again.')
    }
  }

  function cancelPreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setPreviewBlob(null)
  }

  async function confirmUpload() {
    if (!previewBlob) return
    setBusy(true)
    setError('')
    const supabase = createClient()
    const path = `${trip.id}/logo.jpg`

    const { error: uploadErr } = await supabase.storage.from('event-logos').upload(path, previewBlob, { upsert: true, contentType: 'image/jpeg' })
    if (uploadErr) {
      setBusy(false)
      setError(uploadErr.message?.toLowerCase().includes('bucket not found') ? 'Logo storage is not configured.' : 'Upload failed. Please try again.')
      console.error('[event logo upload]', uploadErr)
      return
    }

    const { data: urlData } = supabase.storage.from('event-logos').getPublicUrl(path)
    const bustedUrl = `${urlData.publicUrl}?v=${Date.now()}`

    const res = await fetch(`/api/trips/${trip.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ logo_url: bustedUrl }),
    })
    setBusy(false)
    // Priority 3 — distinct message from the storage-upload failure
    // above, matching "do not map every failure to one generic
    // processing message" — the image is already safely in Storage by
    // this point; what failed here is specifically saving the URL
    // reference against the trip.
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      console.error('[event logo] saving logo_url failed', body?.error ?? res.status)
      setError('Photo uploaded, but could not save it to your event. Please try again.')
      return
    }
    setCurrentLogoUrl(bustedUrl)
    cancelPreview()
  }

  async function handleRemove() {
    setBusy(true)
    setError('')
    const res = await fetch(`/api/trips/${trip.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ logo_url: null }),
    })
    setBusy(false)
    if (!res.ok) { setError('Could not remove logo. Please try again.'); return }
    setCurrentLogoUrl(null)
  }

  return (
    <div className="card p-4 space-y-3">
      <p className="s-label">Event Logo</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{
          width: 64, height: 64, borderRadius: 12, flexShrink: 0, overflow: 'hidden',
          background: '#f2e8d0', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #eceae3',
        }}>
          {previewUrl ? (
            <img src={previewUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : currentLogoUrl ? (
            <img src={currentLogoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <span style={{ fontSize: 24 }}>⛳</span>
          )}
        </div>
        <div style={{ flex: 1 }}>
          {previewUrl ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={confirmUpload} disabled={busy} style={{ padding: '7px 14px', borderRadius: 8, background: '#14532d', color: '#fff', border: 'none', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>
                {busy ? 'Saving…' : 'Save Logo'}
              </button>
              <button onClick={cancelPreview} disabled={busy} style={{ padding: '7px 14px', borderRadius: 8, background: '#f3f4f6', border: '1px solid #d1d5db', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <label style={{ padding: '7px 14px', borderRadius: 8, background: '#ffffff', border: '1.5px solid #d1d5db', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 12.5, color: '#14532d', cursor: 'pointer' }}>
                {currentLogoUrl ? 'Change Logo' : 'Upload Logo'}
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleSelected} style={{ display: 'none' }} />
              </label>
              {currentLogoUrl && (
                <button onClick={handleRemove} disabled={busy} style={{ padding: '7px 14px', borderRadius: 8, background: 'none', border: 'none', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 12.5, color: '#dc2626', cursor: 'pointer' }}>
                  Remove
                </button>
              )}
            </div>
          )}
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#9ca3af', marginTop: 6 }}>
            Optional — shown on your invitation link and event card. If left blank, Teein&apos; It Up&apos;s own branding is used instead.
          </p>
          {error && <p style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: '#dc2626', marginTop: 4 }}>{error}</p>}
        </div>
      </div>

      {cropSourceUrl && (
        <ImageCropper
          imageSrc={cropSourceUrl}
          cropShape="rect"
          title="Position Your Event Logo"
          onCancel={() => setCropSourceUrl(null)}
          onSave={blob => void handleCropSave(blob)}
        />
      )}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#a89e88', width: 72, flexShrink: 0, paddingTop: 1 }}>{label}</span>
      <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#1a1a16', flex: 1 }}>{value}</span>
    </div>
  )
}

export function WizardNav({
  backHref, backLabel, onBack, onNext, nextLabel,
}: {
  backHref?: string; backLabel: string
  onBack?: () => void; onNext?: () => void; nextLabel?: string
}) {
  return (
    <div className="flex gap-3 pt-2">
      {backHref ? (
        <Link href={backHref} style={{
          flex: 1, textAlign: 'center', display: 'block',
          padding: '13px 16px', borderRadius: 12,
          background: '#f8f4eb', border: '1.5px solid #d9c9a3',
          fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: '#7a7260',
          textDecoration: 'none',
        }}>{backLabel}</Link>
      ) : onBack ? (
        <button onClick={onBack} style={{
          flex: 1, padding: '13px 16px', borderRadius: 12,
          background: '#f8f4eb', border: '1.5px solid #d9c9a3',
          fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: '#7a7260',
          cursor: 'pointer',
        }}>{backLabel}</button>
      ) : <div style={{ flex: 1 }} />}

      {nextLabel && onNext && (
        <button onClick={onNext} style={{
          flex: 2, padding: '13px 16px', borderRadius: 12,
          background: 'linear-gradient(135deg, #2d7a52, #1a4731)', border: 'none',
          fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, color: '#ffffff',
          cursor: 'pointer', boxShadow: '0 3px 12px rgba(26,71,49,0.35)',
        }}>{nextLabel}</button>
      )}
    </div>
  )
}
