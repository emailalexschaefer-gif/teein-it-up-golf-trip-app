'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { initials, avatarColor } from '@/lib/utils'

interface Props {
  userId: string
  authEmail: string
  initialName: string
  initialEmail: string
  initialHandicap: number | null
  avatarUrl: string | null
}

type SaveState = 'idle' | 'saving' | 'success' | 'error'

export default function ProfileForm({ userId, authEmail, initialName, initialEmail, initialHandicap, avatarUrl }: Props) {
  const router = useRouter()

  const [name, setName]             = useState(initialName)
  const [email, setEmail]           = useState(initialEmail)
  const [hcp, setHcp]               = useState(initialHandicap !== null ? String(initialHandicap) : '')
  const [noHcp, setNoHcp]           = useState(initialHandicap === null && initialName !== '') // null after first join = no hcp
  const [saveState, setSaveState]   = useState<SaveState>('idle')
  const [errorMsg, setErrorMsg]     = useState('')
  const [emailNote, setEmailNote]   = useState('')

  const userColor    = avatarColor(userId)
  const userInitials = initials(name || '?')

  const emailChanged = email.trim().toLowerCase() !== authEmail.toLowerCase()
  const handicapVal  = noHcp ? null : (hcp === '' ? null : parseFloat(hcp))

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setErrorMsg('Name is required'); setSaveState('error'); return }
    if (!email.trim() || !/^[^@]+@[^@]+\.[^@]+$/.test(email)) {
      setErrorMsg('A valid email is required'); setSaveState('error'); return
    }

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
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
        {avatarUrl ? (
          <img src={avatarUrl} alt={name}
            style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover',
              border: '3px solid #d9c9a3', boxShadow: '0 4px 16px rgba(0,0,0,0.12)' }} />
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
      </div>

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
