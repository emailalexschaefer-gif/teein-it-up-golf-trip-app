'use client'

// Shown to existing authenticated users who have handicap = null
// (never answered). One small step before joining.

import React, { useState } from 'react'

interface Props {
  onContinue: (handicap: number | null, declined: boolean) => void
  loading: boolean
}

export default function HandicapPrompt({ onContinue, loading }: Props) {
  const [hcp, setHcp]       = useState('')
  const [noHcp, setNoHcp]   = useState(false)
  const [error, setError]   = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!noHcp && hcp !== '') {
      const n = parseFloat(hcp)
      if (isNaN(n) || n < -10 || n > 54) {
        setError('Enter a handicap between -10 and 54, or select no official handicap.')
        return
      }
      onContinue(n, false)
    } else if (noHcp) {
      onContinue(null, true)
    } else {
      setError('Enter your handicap or select the no-handicap option.')
    }
  }

  return (
    <>
      <div className="text-center mb-5">
        <p className="text-3xl mb-2">⛳</p>
        <h1 className="text-lg font-bold text-text">One quick thing</h1>
        <p className="text-sm text-text-muted mt-1">Add your golf handicap to complete joining.</p>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-bold uppercase tracking-wide text-text-muted mb-1">
            Golf handicap
          </label>
          <p className="text-xs text-text-muted mb-2">Your default handicap for future trips and events.</p>
          {!noHcp && (
            <input
              type="number" min={-10} max={54} step={0.1}
              value={hcp}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setHcp(e.target.value)}
              placeholder="e.g. 14 or 14.5"
              className="w-full rounded-xl border border-surface-subtle px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600 mb-2"
            />
          )}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox" checked={noHcp}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                setNoHcp(e.target.checked)
                if (e.target.checked) setHcp('')
              }}
            />
            <span className="text-sm text-text-muted">I don&apos;t have an official handicap</span>
          </label>
        </div>

        <button
          type="submit" disabled={loading}
          className="w-full bg-brand-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-brand-700 transition-colors disabled:opacity-50"
        >
          {loading ? 'Joining…' : 'Save and join trip'}
        </button>
      </form>
    </>
  )
}
