'use client'

// Manual "Join a trip" widget on the dashboard.
// Lets a player enter a 6-character invite code directly (e.g. ATATZ8)
// without needing to receive the invite link by email.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { tripKeys } from '@/lib/queries/trips'

export default function JoinByCode() {
  const router      = useRouter()
  const queryClient = useQueryClient()

  const [open, setOpen]       = useState(false)
  const [code, setCode]       = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

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

    void queryClient.invalidateQueries({ queryKey: tripKeys.lists() })
    router.push(`/trips/${data.tripId}`)
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full text-sm text-brand-600 border border-brand-200 rounded-xl py-2.5 hover:bg-brand-50 transition-colors"
      >
        Have an invite code? Join a trip →
      </button>
    )
  }

  return (
    <div className="rounded-2xl border border-brand-200 bg-brand-50 p-4">
      <p className="text-sm font-semibold text-text mb-3">Enter your invite code</p>
      <form onSubmit={handleJoin} className="space-y-3">
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
          placeholder="e.g. ATATZ8"
          maxLength={8}
          autoCapitalize="characters"
          className="w-full rounded-xl border border-surface-subtle bg-white px-4 py-3 text-sm font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-brand-600"
        />
        {error && (
          <p className="text-xs text-red-600">{error}</p>
        )}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={loading || code.length < 4}
            className="flex-1 bg-brand-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-brand-700 transition-colors disabled:opacity-50"
          >
            {loading ? 'Joining…' : 'Join trip'}
          </button>
          <button
            type="button"
            onClick={() => { setOpen(false); setCode(''); setError(null) }}
            className="px-4 py-2.5 text-sm text-text-muted hover:text-text transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
