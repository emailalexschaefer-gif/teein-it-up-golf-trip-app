import { Suspense } from 'react'
import LoginForm from './LoginForm'

// Next.js App Router: useSearchParams() requires a Suspense boundary.
// LoginForm is the client component containing all the logic.
export default function LoginPage() {
  return (
    <Suspense fallback={<div className="h-64 flex items-center justify-center text-text-muted text-sm">Loading…</div>}>
      <LoginForm />
    </Suspense>
  )
}
