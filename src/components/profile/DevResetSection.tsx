'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const TEST_EMAIL = 'teeinitupapp@gmail.com'
const CONFIRM_WORD = 'RESET'

interface Props { userEmail: string; userId: string }
type Stage = 'idle' | 'confirming' | 'deleting' | 'done'

export default function DevResetSection({ userEmail, userId }: Props) {
  const router = useRouter()
  const [stage, setStage] = useState<Stage>('idle')
  const [typed, setTyped] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (userEmail.toLowerCase() !== TEST_EMAIL.toLowerCase()) return null

  const confirmed = typed === CONFIRM_WORD

  async function handleDelete() {
    if (!confirmed) return
    setStage('deleting'); setError(null)
    try {
      const res  = await fetch('/api/dev/reset-test-account', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body:   JSON.stringify({ userId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? "We couldn't reset the test account. Please try again.")
        setStage('confirming'); return
      }
      setStage('done')
      await createClient().auth.signOut()
      router.push('/login?mode=signup&message=Test+account+deleted.+You+can+now+create+it+again.')
    } catch (err) {
      console.error('[DevResetSection]', err)
      setError("We couldn't reset the test account. Please try again.")
      setStage('confirming')
    }
  }

  const sectionStyle: React.CSSProperties = {
    marginTop: 28, border: '1.5px solid #fca5a5', borderRadius: 14, overflow: 'hidden',
  }
  const bodyStyle: React.CSSProperties = { padding: 16 }
  const labelStyle: React.CSSProperties = {
    fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700,
    color: '#b91c1c', letterSpacing: 0.8, textTransform: 'uppercase',
    display: 'block', marginBottom: 6,
  }
  const textStyle: React.CSSProperties = {
    fontFamily: 'var(--font-body)', fontSize: 13, color: '#7a7260', marginBottom: 12,
  }

  return (
    <div style={sectionStyle}>
      <div style={{ background: '#fef2f2', padding: '10px 16px', borderBottom: '1px solid #fca5a5' }}>
        <p style={{ ...labelStyle, marginBottom: 0 }}>Developer Testing</p>
      </div>

      <div style={bodyStyle}>
        {stage === 'idle' && (
          <>
            <p style={textStyle}>
              This permanently deletes this test account and its trip memberships so the
              email can be reused for signup testing.
            </p>
            <button type="button" onClick={() => setStage('confirming')} style={{
              padding: '10px 18px', borderRadius: 10, border: '1.5px solid #fca5a5',
              background: '#fff', cursor: 'pointer',
              fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: '#b91c1c',
            }}>
              Delete &amp; Reset Test Account
            </button>
          </>
        )}

        {stage === 'confirming' && (
          <>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: '#1a1a16', marginBottom: 6 }}>
              Reset test account?
            </p>
            <p style={textStyle}>
              This will permanently delete the test account, profile, trip memberships and
              test-specific records. This cannot be undone.
            </p>

            {error && (
              <div style={{
                background: '#fef2f2', border: '1.5px solid #fca5a5', borderRadius: 8,
                padding: '8px 12px', marginBottom: 12,
                fontFamily: 'var(--font-body)', fontSize: 12, color: '#b91c1c',
              }}>{error}</div>
            )}

            <label style={labelStyle}>Type RESET to confirm</label>
            <input
              type="text" value={typed} placeholder="RESET" autoCapitalize="characters"
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTyped(e.target.value)}
              style={{
                width: '100%', borderRadius: 8,
                border: `1.5px solid ${confirmed ? '#86efac' : '#d9c9a3'}`,
                padding: '10px 12px', fontSize: 14, fontFamily: 'var(--font-body)',
                color: '#1a1a16', background: '#fff', outline: 'none',
                boxSizing: 'border-box', marginBottom: 12,
              }}
            />

            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={handleDelete} disabled={!confirmed} style={{
                flex: 1, padding: '10px 16px', borderRadius: 10, border: 'none',
                cursor: confirmed ? 'pointer' : 'not-allowed',
                background: confirmed ? '#dc2626' : '#fca5a5',
                fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, color: '#fff',
              }}>
                Delete Account
              </button>
              <button type="button" onClick={() => { setStage('idle'); setTyped(''); setError(null) }} style={{
                flex: 1, padding: '10px 16px', borderRadius: 10,
                border: '1.5px solid #d9c9a3', background: 'transparent', cursor: 'pointer',
                fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: '#7a7260',
              }}>
                Cancel
              </button>
            </div>
          </>
        )}

        {stage === 'deleting' && (
          <p style={{ ...textStyle, textAlign: 'center', marginBottom: 0 }}>Deleting test account…</p>
        )}

        {stage === 'done' && (
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#166534', textAlign: 'center' }}>
            ✓ Test account deleted. Signing out…
          </p>
        )}
      </div>
    </div>
  )
}
