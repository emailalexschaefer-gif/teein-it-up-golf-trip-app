'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getAppUrl } from '@/lib/utils'

type Mode = 'magic' | 'password'

export default function LoginForm() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const redirectTo   = searchParams.get('redirectTo') || '/dashboard'

  const [mode, setMode]       = useState<Mode>('magic')
  const [email, setEmail]     = useState('')
  const [password, setPass]   = useState('')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg]         = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const supabase = createClient()

  async function handleMagic(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setMsg(null)

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${getAppUrl()}/api/auth/callback?redirectTo=${encodeURIComponent(redirectTo)}`,
      },
    })

    setLoading(false)
    setMsg(error
      ? { type: 'err', text: error.message }
      : { type: 'ok',  text: `Check your email — we sent a link to ${email}` }
    )
  }

  async function handlePassword(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setMsg(null)

    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)

    if (error) {
      setMsg({ type: 'err', text: error.message })
    } else {
      router.push(redirectTo)
      router.refresh()
    }
  }

  return (
    <>
      <h1 className="text-xl font-bold text-text mb-1">Sign in</h1>
      <p className="text-text-muted text-sm mb-6">
        {mode === 'magic' ? "We'll send you a sign-in link — no password needed." : 'Sign in with your email and password.'}
      </p>

      <form onSubmit={mode === 'magic' ? handleMagic : handlePassword} className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-text mb-1">
            Email<span className="text-red-500 ml-0.5">*</span>
          </label>
          <input
            type="email" required autoComplete="email" value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-xl border border-surface-subtle px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
          />
        </div>

        {mode === 'password' && (
          <div>
            <label className="block text-sm font-medium text-text mb-1">
              Password<span className="text-red-500 ml-0.5">*</span>
            </label>
            <input
              type="password" required autoComplete="current-password" value={password}
              onChange={(e) => setPass(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-xl border border-surface-subtle px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
            />
          </div>
        )}

        {msg && (
          <div className={`rounded-xl px-4 py-3 text-sm ${msg.type === 'ok' ? 'bg-brand-50 text-brand-600' : 'bg-red-50 text-red-600'}`}>
            {msg.text}
          </div>
        )}

        <button
          type="submit" disabled={loading}
          className="w-full bg-brand-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-brand-700 transition-colors disabled:opacity-50"
        >
          {loading ? 'Sending…' : mode === 'magic' ? 'Send sign-in link' : 'Sign in'}
        </button>
      </form>

      <div className="mt-4 text-center">
        <button
          type="button"
          onClick={() => { setMode(mode === 'magic' ? 'password' : 'magic'); setMsg(null) }}
          className="text-sm text-text-muted hover:text-brand-600 transition-colors"
        >
          {mode === 'magic' ? 'Sign in with password instead' : 'Sign in with a magic link instead'}
        </button>
      </div>
    </>
  )
}
