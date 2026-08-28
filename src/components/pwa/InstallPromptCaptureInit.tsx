'use client'

import { useEffect } from 'react'
import { initInstallPromptCapture } from '@/lib/pwa/installPromptCapture'

/**
 * Mounted once, at the very root layout — see installPromptCapture.ts
 * for the full root-cause trace. Renders nothing; this is purely so the
 * `beforeinstallprompt` listener is attached from the earliest possible
 * moment in the page's lifetime, before any player has navigated
 * anywhere near the Lobby page that used to be the only place
 * listening.
 */
export default function InstallPromptCaptureInit() {
  useEffect(() => {
    initInstallPromptCapture()
  }, [])
  return null
}
