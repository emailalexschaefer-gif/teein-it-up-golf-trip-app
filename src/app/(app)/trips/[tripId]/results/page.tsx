import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import FinalEventResults from '@/components/results/FinalEventResults'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface Props { params: Promise<{ tripId: string }> }

export default async function ResultsPage({ params }: Props) {
  const { tripId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return <FinalEventResults tripId={tripId} />
}
