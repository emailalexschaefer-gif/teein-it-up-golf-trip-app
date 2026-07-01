import { Suspense } from 'react'
import JoinWelcomeInner from './JoinWelcomeInner'

// Next.js App Router: useParams() requires a Suspense boundary.
export default function JoinWelcomePage() {
  return (
    <Suspense fallback={<div className="h-32 flex items-center justify-center text-text-muted text-sm">Joining trip…</div>}>
      <JoinWelcomeInner />
    </Suspense>
  )
}
