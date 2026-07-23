import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import MarkerReviewClient from './MarkerReviewClient'

interface Props { params: Promise<{ tripId: string; roundId: string }> }

// Organiser-only marker assignment review/edit screen. Simple by design —
// per the brief, a settings UI beyond "visible and editable" isn't required.
export default async function MarkerReviewPage({ params }: Props) {
  const { tripId, roundId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  const memberCheck = await admin
    .from('trip_members').select('role').eq('trip_id', tripId).eq('profile_id', user.id).maybeSingle()
  if (!memberCheck.data || memberCheck.data.role !== 'organiser') {
    redirect(`/trips/${tripId}/rounds/${roundId}`)
  }

  return <MarkerReviewClient tripId={tripId} roundId={roundId} />
}
