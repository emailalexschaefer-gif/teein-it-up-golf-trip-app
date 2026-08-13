import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import CourseDetailAdminClient from './CourseDetailAdminClient'

export const dynamic = 'force-dynamic'

interface Props { params: Promise<{ courseId: string }> }

export default async function CourseDetailAdminPage({ params }: Props) {
  const { courseId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const profileRes = await supabase.from('profiles').select('app_role').eq('id', user.id).maybeSingle()
  if (profileRes.data?.app_role !== 'admin') redirect('/dashboard')

  return <CourseDetailAdminClient courseId={courseId} />
}
