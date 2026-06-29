'use client'

import { useEffect } from 'react'
import { initSyncListeners } from '@/lib/db/sync'

export default function SyncInitializer() {
  useEffect(() => {
    const cleanup = initSyncListeners()
    return cleanup
  }, [])
  return null
}
