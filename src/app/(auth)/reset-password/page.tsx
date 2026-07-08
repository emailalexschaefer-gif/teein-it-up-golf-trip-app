import { Suspense } from 'react'
import ResetPasswordForm from './ResetPasswordForm'

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="h-32" />}>
      <ResetPasswordForm />
    </Suspense>
  )
}
