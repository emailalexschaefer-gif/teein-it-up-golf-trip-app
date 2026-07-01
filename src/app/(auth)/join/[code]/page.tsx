import { Suspense } from 'react'
import JoinForm from './JoinForm'

// Next.js App Router: useParams() requires a Suspense boundary.
export default function JoinPage() {
  return (
    <Suspense fallback={<div className="h-64 flex items-center justify-center text-text-muted text-sm">Loading…</div>}>
      <JoinForm />
    </Suspense>
  )
}
