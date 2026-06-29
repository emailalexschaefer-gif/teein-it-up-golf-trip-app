'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getAppUrl } from '@/lib/utils'

export default function JoinPage() {
  const params     = useParams()
  const inviteCode = (params.code as string)?.toUpperCase()

  const [name, setName]         = useState('')
  const [email, setEmail]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [tripName, setTripName] = useState<string | null>(null)
  const [step, setStep]         = useState<'form' | 'check_email' | 'invalid'>('form')
  const [error, setError]       = useState<string | null>(null)

  const supabase = createClient()

  useEffect(() => {
    if (!inviteCode) return
    supabase
      .from('trips')
      .select('name, status')
      .eq('invite_code', inviteCode)
      .maybeSingle()
      .then((result) => {
        if (!result.data || result.data.status === 'archived') {
          setStep('invalid')
        } else {
          setTripName(result.data.name)
        }
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteCode])

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError(null)

    const { error: authError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        data: { full_name: name },
        emailRedirectTo: `${getAppUrl()}/api/auth/callback?redirectTo=${encodeURIComponent(`/join/${inviteCode}/welcome`)}`,
      },
    })

    setLoading(false)
    if (authError) {
      setError(authError.message)
    } else {
      setStep('check_email')
    }
  }

  if (step === 'invalid') {
    return (
      <>
        <p className="text-3xl text-center mb-3">⛳</p>
        <h1 className="text-lg font-bold text-text text-center mb-2">Link not found</h1>
        <p className="text-text-muted text-sm text-center">This invite link is not valid or has expired.</p>
      </>
    )
  }

  if (step === 'check_email') {
    return (
      <>
        <p className="text-3xl text-center mb-3">📧</p>
        <h1 className="text-lg font-bold text-text text-center mb-2">Check your email</h1>
        <p className="text-text-muted text-sm text-center">
          We sent a sign-in link to <strong>{email}</strong>. Tap it to join <strong>{tripName}</strong>.
        </p>
      </>
    )
  }

  return (
    <>
      <div className="text-center mb-6">
        <p className="text-2xl mb-1">⛳</p>
        <h1 className="text-xl font-bold text-text">You&apos;re invited</h1>
        {tripName && <p className="text-text-muted text-sm mt-1">Join <strong className="text-text">{tripName}</strong></p>}
      </div>

      <form onSubmit={handleJoin} className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-text mb-1">Your name<span className="text-red-500 ml-0.5">*</span></label>
          <input type="text" required autoComplete="name" value={name}
            onChange={(e) => setName(e.target.value)} placeholder="James Smith"
            className="w-full rounded-xl border border-surface-subtle px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600" />
        </div>
        <div>
          <label className="block text-sm font-medium text-text mb-1">Email<span className="text-red-500 ml-0.5">*</span></label>
          <input type="email" required autoComplete="email" value={email}
            onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
            className="w-full rounded-xl border border-surface-subtle px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600" />
        </div>
        {error && <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}
        <button type="submit" disabled={loading || !tripName}
          className="w-full bg-brand-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-brand-700 transition-colors disabled:opacity-50">
          {loading ? 'Joining…' : 'Join trip'}
        </button>
      </form>
      <p className="mt-4 text-center text-xs text-text-subtle">We&apos;ll send you a sign-in link. No password required.</p>
    </>
  )
}
