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

    // Already a member is always a success — just navigate to the trip
    if (res.ok || data.alreadyMember) {
      setSuccess(true)
      void queryClient.invalidateQueries({ queryKey: tripKeys.lists() })
      router.push(`/trips/${data.tripId}`)
      return
    }

    // Specific error messages from the API
    setError(data.error ?? 'Could not join trip. Check the code and try again.')
  }

  return (
    <div style={{
      background: 'rgba(242,232,208,0.4)',
      border: '1px solid #d9c9a3',
      borderRadius: 12,
      padding: '12px 14px',
    }}>
      <p style={{
        fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700,
        color: '#7a7260', letterSpacing: 0.8, textTransform: 'uppercase',
        marginBottom: 8,
      }}>Join a trip</p>

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
