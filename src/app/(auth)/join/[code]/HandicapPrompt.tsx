'use client'

import React, { useState } from 'react'

interface Props {
  inviteCode: string
  onComplete: (hcp: number | null, noHcp: boolean) => void
  onCancel: () => void
}

export default function HandicapPrompt({ inviteCode, onComplete, onCancel }: Props) {
  const [hcp, setHcp]       = useState('')
  const [noHcp, setNoHcp]   = useState(false)
  const [error, setError]   = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!noHcp && hcp === '') {
      setError('Please enter your handicap or select "I don\'t have an official handicap".')
      return
    }
    if (!noHcp) {
      const n = parseFloat(hcp)
      if (isNaN(n) || n < -10 || n > 54) {
        setError('Handicap must be between -10 and 54.')
        return
      }
      onComplete(n, false)
    } else {
      onComplete(null, true)
    }
  }

  return (
    <div>
      <p style={{ fontSize: 28, textAlign: 'center', marginBottom: 8 }}>⛳</p>
      <h1 style={{
        fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700,
        color: '#1a1a16', textAlign: 'center', marginBottom: 6,
      }}>Add your golf handicap</h1>
      <p style={{
        fontFamily: 'var(--font-body)', fontSize: 13, color: '#7a7260',
        textAlign: 'center', marginBottom: 20,
      }}>
        Your handicap helps organisers create fair groups and calculate competitions.
      </p>

      {error && (
        <div style={{
          background: '#fef2f2', border: '1.5px solid #fca5a5',
          borderRadius: 10, padding: '10px 14px', marginBottom: 12,
          fontFamily: 'var(--font-body)', fontSize: 13, color: '#b91c1c',
        }}>{error}</div>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={{
            display: 'block', fontFamily: 'var(--font-body)',
            fontSize: 11, fontWeight: 700, color: '#7a7260',
            letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 5,
          }}>Golf Handicap</label>
          {!noHcp && (
            <input
              type="number" min={-10} max={54} step={0.1}
              value={hcp}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setHcp(e.target.value); setError('') }}
              placeholder="e.g. 14 or 14.5"
              style={{
                width: '100%', borderRadius: 10, border: '1.5px solid #d9c9a3',
                padding: '11px 14px', fontSize: 14, fontFamily: 'var(--font-body)',
                color: '#1a1a16', background: '#ffffff', outline: 'none',
                boxSizing: 'border-box', marginBottom: 8,
              }}
            />
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox" checked={noHcp}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                setNoHcp(e.target.checked)
                if (e.target.checked) { setHcp(''); setError('') }
              }}
            />
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#7a7260' }}>
              I don&apos;t have an official handicap
            </span>
          </label>
        </div>

        <button type="submit" style={{
          width: '100%', padding: '13px 20px', borderRadius: 12, border: 'none',
          cursor: 'pointer',
          background: 'linear-gradient(135deg, #2d7a52, #1a4731)',
          fontFamily: 'var(--font-body)', fontSize: 15, fontWeight: 700, color: '#ffffff',
          boxShadow: '0 3px 12px rgba(26,71,49,0.35)',
        }}>
          Save and Join Trip
        </button>

        <button type="button" onClick={onCancel} style={{
          width: '100%', padding: '11px 16px', borderRadius: 12,
          border: '1.5px solid #d9c9a3', background: 'transparent', cursor: 'pointer',
          fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: '#7a7260',
        }}>
          Cancel
        </button>
      </form>

      <p style={{
        fontFamily: 'var(--font-body)', fontSize: 11, color: '#a89e88',
        textAlign: 'center', marginTop: 12,
      }}>
        Trip code: <strong>{inviteCode}</strong> — you can update your handicap anytime in My Profile.
      </p>
    </div>
  )
}
