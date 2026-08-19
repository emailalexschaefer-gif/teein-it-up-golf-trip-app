'use client'

import { useEffect, useState, useCallback } from 'react'

/**
 * Shared across the Lobby concierge card and the Profile settings
 * entry point — one source of truth for "can we install, and how,"
 * rather than each surface re-detecting independently.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export type InstallPlatform = 'android-supported' | 'ios-safari' | 'installed' | 'unsupported'

export function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [platform, setPlatform] = useState<InstallPlatform>('unsupported')

  useEffect(() => {
    // Already-installed detection — the standard, reliable signal
    // (matchMedia display-mode), not a custom/unreliable heuristic,
    // per the explicit "do not build complicated unreliable detection."
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      // iOS Safari's own older, non-standard standalone flag — still
      // the correct check on iOS, where display-mode alone isn't
      // consistently reported.
      || (window.navigator as unknown as { standalone?: boolean }).standalone === true

    if (isStandalone) {
      setPlatform('installed')
      return
    }

    const ua = window.navigator.userAgent
    const isIOS = /iPad|iPhone|iPod/.test(ua)
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua)
    if (isIOS && isSafari) {
      setPlatform('ios-safari')
      return
    }

    // Android/Chromium: wait for the real browser signal rather than
    // assuming support from the user agent alone — beforeinstallprompt
    // only fires when the browser has actually determined the page is
    // installable (manifest + service worker + HTTPS requirements met).
    function handler(e: Event) {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
      setPlatform('android-supported')
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return
    await deferredPrompt.prompt()
    await deferredPrompt.userChoice
    setDeferredPrompt(null)
  }, [deferredPrompt])

  return { platform, promptInstall }
}
