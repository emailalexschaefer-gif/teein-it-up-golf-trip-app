'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function JoinTripPage() {
  const params = useParams()
  const router = useRouter()
  const inviteCode = (params.code as string)?.toUpperCase()

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [tripName, setTripName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState<'details' | 'check_email'>('details')

  const supabase = createClient()

  // Look up the trip by invite code to show the trip name
  useEffect(() => {
    if (!inviteCode) return

    supabase
      .from('trips')
      .select('name')
      .eq('invite_code', inviteCode)
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          setError('This invite link is not valid or has expired.')
        } else {
          setTripName(data.name)
        }
      })
  }, [inviteCode])

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault()
    if (!email || !fullName) return

    setLoading(true)
    setError(null)

    // Send magic link — on sign-in, the callback will trigger profile creation
    // and trip membership via the join API
    const { error: authError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/callback?redirectTo=/join/${inviteCode}/welcome`,
      },
    })

    setLoading(false)

    if (authError) {
      setError(authError.message)
    } else {
      setStep('check_email')
    }
  }

  if (error && !tripName) {
    return (
      <div className="text-center">
        <p className="text-2xl mb-2">⛳</p>
        <h1 className="text-lg font-bold text-text mb-2">Link not found</h1>
        <p className="text-text-muted text-sm">{error}</p>
      </div>
    )
  }

  if (step === 'check_email') {
    return (
      <div className="text-center">
        <p className="text-3xl mb-3">📧</p>
        <h1 className="text-lg font-bold text-text mb-2">Check your email</h1>
        <p className="text-text-muted text-sm">
          We&apos;ve sent a sign-in link to <strong>{email}</strong>.
          Tap it to join <strong>{tripName}</strong>.
        </p>
      </div>
    )
  }

  return (
    <>
      <div className="text-center mb-6">
        <p className="text-2xl mb-1">⛳</p>
        <h1 className="text-xl font-bold text-text">You&apos;re invited</h1>
        {tripName && (
          <p className="text-text-muted text-sm mt-1">
            Join <strong className="text-text">{tripName}</strong>
          </p>
        )}
      </div>

      <form onSubmit={handleJoin} className="space-y-3">
        <div>
          <label htmlFor="fullName" className="block text-sm font-medium text-text mb-1">
            Your name
          </label>
          <input
            id="fullName"
            type="text"
            autoComplete="name"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full rounded-xl border border-surface-subtle px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-transparent"
            placeholder="James Smith"
          />
        </div>

        <div>
          <label htmlFor="email" className="block text-sm font-medium text-text mb-1">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-surface-subtle px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-transparent"
            placeholder="you@example.com"
          />
        </div>

        {error && (
          <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !tripName}
          className="w-full bg-brand-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-brand-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Joining...' : 'Join trip'}
        </button>
      </form>

      <p className="mt-4 text-center text-xs text-text-subtle">
        We&apos;ll send you a sign-in link. No password required.
      </p>
    </>
  )
}
