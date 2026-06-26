'use client'

// ─────────────────────────────────────────────────────────────────────────────
// SYNC INITIALIZER
// Mounts online/offline listeners and drains queued scores on load.
// Rendered once in the (app) layout — runs for all protected pages.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect } from 'react'
import { initSyncListeners } from '@/lib/db/sync'

export default function SyncInitializer() {
  useEffect(() => {
    const cleanup = initSyncListeners()
    return cleanup
  }, [])

  return null
}
