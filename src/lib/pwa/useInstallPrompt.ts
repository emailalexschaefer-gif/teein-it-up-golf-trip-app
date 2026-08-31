'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  getCapturedInstallPrompt, subscribeToInstallPromptCapture,
  wasAlreadyInstalledAtCaptureTime, clearCapturedInstallPrompt,
  initInstallPromptCapture,
} from '@/lib/pwa/installPromptCapture'

/**
 * Shared across the Lobby concierge card and the Profile settings
 * entry point — one source of truth for "can we install, and how,"
 * rather than each surface re-detecting independently.
 *
 * P0 field-test fix — this used to attach its own beforeinstallprompt
 * listener directly, on whatever mount this hook happened to run on.
 * Since this hook only ever runs inside InstallPwaCard, which only ever
 * mounts once a player reaches the trip Lobby (after login → trip list
 * → this specific trip), the event — which fires exactly once, often
 * very early in the page's lifetime — had almost always already fired
 * and been missed by the time this listener existed. Resetting the
 * dismissal flag correctly cleared localStorage, but there was no
 * captured event left to hand back, so the card correctly (by its own
 * logic) stayed hidden. Now reads from a small global singleton
 * (installPromptCapture.ts) populated by a listener mounted at the true
 * app root (layout.tsx) instead — see that file for the full trace.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export type InstallPlatform = 'android-supported' | 'ios-safari' | 'installed' | 'fallback' | 'unsupported'

export function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  // 30 Aug field-test bundle — smart install button. 'unsupported' used
  // to be both the initial loading state AND the permanent end state
  // for any browser that wasn't iOS Safari or a genuine
  // beforeinstallprompt-supporting Chromium — meaning Android Firefox,
  // Samsung Internet, and any other browser silently got no install
  // guidance at all, violating the explicit "must never silently fail"
  // requirement. 'fallback' is now a real, distinct end state (generic,
  // still-useful instructions) — 'unsupported' is reserved for the
  // brief instant before this effect has run at all, not a permanent
  // resting state for a real browser.
  const [platform, setPlatform] = useState<InstallPlatform>('unsupported')

  useEffect(() => {
    // Belt-and-braces — if this hook somehow mounts before the root
    // layout's own effect has run (shouldn't happen given layout.tsx's
    // structure, but costs nothing to guard), this is a safe, idempotent
    // no-op call that guarantees the listener is attached either way.
    initInstallPromptCapture()

    // Already-installed detection — the standard, reliable signal
    // (matchMedia display-mode), not a custom/unreliable heuristic,
    // per the explicit "do not build complicated unreliable detection."
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      // iOS Safari's own older, non-standard standalone flag — still
      // the correct check on iOS, where display-mode alone isn't
      // consistently reported.
      || (window.navigator as unknown as { standalone?: boolean }).standalone === true

    if (isStandalone || wasAlreadyInstalledAtCaptureTime()) {
      setPlatform('installed')
      return
    }

    // iOS genuinely has no capability signal for "can this browser add
    // to home screen" — Safari always can, no other iOS browser (they
    // all use WebKit under Apple's rules, but only Safari itself
    // exposes the share-sheet install path) ever can. This one
    // UA-based branch is the "use platform/browser detection only
    // where required for an appropriate fallback" case the brief
    // explicitly allows for — there is no feature-detectable
    // alternative on iOS.
    const ua = window.navigator.userAgent
    const isIOS = /iPad|iPhone|iPod/.test(ua)
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua)
    if (isIOS) {
      setPlatform(isSafari ? 'ios-safari' : 'fallback')
      return
    }

    // Android/Chromium: pick up whatever the global capture already
    // has (covers the common case — the event fired before this
    // component mounted), and also subscribe in case it arrives later
    // in this same page session. Capability-detected — this never asks
    // "is this Chrome," only "did the browser actually offer a real
    // install prompt" (the beforeinstallprompt event itself), which is
    // the genuine capability signal the brief asks to prefer.
    function applyCaptured() {
      const captured = getCapturedInstallPrompt()
      if (captured) {
        setDeferredPrompt(captured)
        setPlatform('android-supported')
      } else if (wasAlreadyInstalledAtCaptureTime()) {
        setPlatform('installed')
      } else {
        // No genuine prompt available (yet, or ever, for this
        // browser) — generic fallback instructions, never silence.
        setPlatform('fallback')
      }
    }
    applyCaptured()
    const unsubscribe = subscribeToInstallPromptCapture(applyCaptured)
    return unsubscribe
  }, [])

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return
    await deferredPrompt.prompt()
    await deferredPrompt.userChoice
    // The native prompt can only ever be used once — clear both the
    // local and global reference so a second tap doesn't silently do
    // nothing.
    clearCapturedInstallPrompt()
    setDeferredPrompt(null)
  }, [deferredPrompt])

  return { platform, promptInstall }
}
