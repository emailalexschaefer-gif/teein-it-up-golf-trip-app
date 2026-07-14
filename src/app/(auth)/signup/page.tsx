import type { Metadata } from 'next'
import { Suspense } from 'react'
import SignupForm from './SignupForm'

export const metadata: Metadata = { title: 'Create Account' }

export default function SignupPage() {
  return (
    <Suspense fallback={<div style={{ textAlign: 'center', padding: 20 }}>Loading…</div>}>
      <SignupForm />
    </Suspense>
  )
}
