import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import SideGamesClient from './SideGamesClient'

export const dynamic = 'force-dynamic'

interface Props { params: Promise<{ tripId: string }> }

export default async function SideGamesPage({ params }: Props) {
  const { tripId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return <SideGamesClient tripId={tripId} />
}

