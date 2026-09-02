import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import IntentQuestionForm from './IntentQuestionForm'

/**
 * Crucial MVP Onboarding Update — /onboarding/intent.
 *
 * Deliberately a standalone route, outside both the (app) layout group
 * (which is where the "does this fresh account still need onboarding"
 * gate lives — see AppLayout) and the (auth) group (which is for
 * unauthenticated screens; this page requires a real session). Keeping
 * this page structurally independent of (app)/layout.tsx avoids any
 * possibility of the gate redirecting a user back to the very page it
 * sent them to — the gate simply never applies here, because this
 * route was never wrapped by that layout in the first place.
 */
export default async function OnboardingIntentPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>
}) {
  const { redirect: redirectTo } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div style={{
      minHeight: '100vh', background: '#faf6ed',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '24px 16px',
    }}>
      <IntentQuestionForm redirectTo={redirectTo && redirectTo.startsWith('/') ? redirectTo : '/dashboard'} />
    </div>
  )
}
