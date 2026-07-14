'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { tripKeys } from '@/lib/queries/trips'

// Always-visible "Join a trip" card — displayed at the top of My Trips
export default function JoinByCode() {
  const router      = useRouter()
  const queryClient = useQueryClient()

  const [code, setCode]       = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault()
    if (!code.trim()) return
    setLoading(true); setError(null)

    const res  = await fetch('/api/join', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ invite_code: code.trim().toUpperCase() }),
    })
    const data = await res.json()
    setLoading(false)

    if (!res.ok) {
      setError(data.error ?? 'Could not join trip. Check the code and try again.')
      return
    }

    setSuccess(true)
    void queryClient.invalidateQueries({ queryKey: tripKeys.lists() })
    router.push(`/trips/${data.tripId}`)
  }

  return (
    <div style={{
      background: '#f8f4eb',
      border: '1.5px solid #d9c9a3',
      borderRadius: 14,
      padding: '16px 16px',
      boxShadow: '0 2px 16px rgba(15,45,28,0.07)',
    }}>
      <p style={{
        fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700,
        color: '#1a1a16', marginBottom: 3,
      }}>Join a trip</p>
      <p style={{
        fontFamily: 'var(--font-body)', fontSize: 12, color: '#7a7260', marginBottom: 12,
      }}>Enter the invite code shared by your organiser.</p>

      <form onSubmit={handleJoin}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            value={code}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
            }
            placeholder="e.g. A1B2C3"
            maxLength={8}
            autoCapitalize="characters"
            style={{
              flex: 1, borderRadius: 10, border: '1.5px solid #d9c9a3',
              padding: '10px 14px', fontSize: 14,
              fontFamily: 'var(--font-body)', letterSpacing: 2,
              color: '#1a1a16', background: '#ffffff', outline: 'none',
            }}
          />
          <button
            type="submit"
            disabled={loading || code.length < 4}
            style={{
              padding: '10px 18px', borderRadius: 10, border: 'none',
              background: (loading || code.length < 4)
                ? '#9db8a8'
                : 'linear-gradient(135deg, #2d7a52, #1a4731)',
              fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700,
              color: '#ffffff', cursor: (loading || code.length < 4) ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {loading ? 'Joining…' : success ? '✓ Joined' : 'Join Trip'}
          </button>
        </div>
        {error && (
          <p style={{
            fontFamily: 'var(--font-body)', fontSize: 12, color: '#b91c1c', marginTop: 8,
          }}>{error}</p>
        )}
      </form>
    </div>
  )
}
