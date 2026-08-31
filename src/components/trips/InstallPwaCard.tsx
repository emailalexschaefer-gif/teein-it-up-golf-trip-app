'use client'

import { useState, useEffect } from 'react'
import { useInstallPrompt } from '@/lib/pwa/useInstallPrompt'
import { trackEvent } from '@/lib/analytics/trackEvent'

const DISMISS_KEY_PREFIX = 'pwa-install-dismissed-'

export function isInstallCardDismissed(): boolean {
  if (typeof window === 'undefined') return true
  try {
    // Not trip-scoped, unlike the brochure's dismiss key — installing
    // the app is a device-level decision, not something tied to any
    // one event, so "maybe later" should mean "later" everywhere, not
    // just for this trip.
    return window.localStorage.getItem(`${DISMISS_KEY_PREFIX}global`) === '1'
  } catch {
    return false
  }
}

function markInstallCardDismissed() {
  try { window.localStorage.setItem(`${DISMISS_KEY_PREFIX}global`, '1') } catch { /* best-effort, same as the brochure's own dismiss persistence */ }
}

/**
 * Item — export so ProfileForm can offer the same "remains discoverable
 * later" entry point without a second install-prompt implementation.
 */
export function resetInstallCardDismissal() {
  try { window.localStorage.removeItem(`${DISMISS_KEY_PREFIX}global`) } catch { /* no-op if storage is unavailable */ }
}

// 30 Aug field-test bundle — generic instructions for any browser that
// isn't iOS Safari and never fired a real beforeinstallprompt (Android
// Firefox, Samsung Internet in some configurations, etc.). Deliberately
// non-specific rather than guessing at a particular browser's exact
// menu wording — "never silently fail" is satisfied by giving SOME
// correct, actionable guidance, not by perfectly matching every
// possible browser's own terminology.
const FALLBACK_STEPS = [
  { icon: '⋮', text: <>Open your browser&apos;s <strong>menu</strong> (usually top-right)</> },
  { icon: '➕', text: <>Look for <strong>Add to Home Screen</strong> or <strong>Install App</strong></> },
  { icon: '✓', text: <>Confirm to finish</> },
]

const IOS_STEPS = [
  { icon: '⬆️', text: <>Tap <strong>Share</strong></> },
  { icon: '➕', text: <>Choose <strong>Add to Home Screen</strong></> },
  { icon: '✓', text: <>Tap <strong>Add</strong></> },
]

const FEATURES = [
  'Full-screen app experience',
  'Easy one-tap access throughout your round',
  'Quickly switch between GPS and Teein\u2019 It Up',
  'Best experience for live scoring, Side Games & Moments',
]

export default function InstallPwaCard({ onDismiss }: { onDismiss?: () => void }) {
  const { platform, promptInstall } = useInstallPrompt()
  const [showSheet, setShowSheet] = useState(false)
  // Lazy initializer, not useState(false) — reading the persisted value
  // only at mount time. Without this, a previously-dismissed card would
  // flash visible again on every fresh page load before any check ran,
  // exactly the repeat-nagging behaviour "do not repeatedly nag" rules
  // out.
  const [dismissed, setDismissed] = useState(() => isInstallCardDismissed())

  // 30 Aug field-test bundle — analytics funnel. Fires once, the
  // moment this card first becomes genuinely visible to a real player
  // (never for 'installed' or 'unsupported', which return null below
  // and never render at all) — not on every render.
  useEffect(() => {
    if (platform === 'installed' || platform === 'unsupported' || dismissed) return
    trackEvent('install_offer_shown', { platform })
  }, [platform, dismissed])

  // Item 6 — already-installed players never see this section at all,
  // not a dimmed/disabled version of it. 'unsupported' is only the
  // brief instant before useInstallPrompt's own effect has resolved a
  // real platform — see that hook for why it's no longer a permanent
  // resting state for any genuine browser.
  if (platform === 'installed' || platform === 'unsupported' || dismissed) return null

  function handleMaybeLater() {
    trackEvent('install_dismissed', { platform })
    markInstallCardDismissed()
    setDismissed(true)
    onDismiss?.()
  }

  // Item 2 — the one smart button. The player never chooses or is even
  // shown which path they're on; this function alone decides, based on
  // what useInstallPrompt has already determined.
  async function handleInstall() {
    trackEvent('install_clicked', { platform })
    if (platform === 'android-supported') {
      // Real, native browser flow — not a faked button. Preserves the
      // existing, already-verified-on-a-real-Samsung-device
      // deferredPrompt implementation exactly as-is; this only adds
      // the surrounding funnel/UI polish around it.
      await promptInstall()
      trackEvent('install_completed', { platform })
      return
    }
    // iOS Safari or fallback — no genuine one-tap browser API exists
    // for either, so the smart action is showing the correct
    // instructions for whichever this player is actually on.
    trackEvent('install_instructions_shown', { platform })
    setShowSheet(true)
  }

  const steps = platform === 'ios-safari' ? IOS_STEPS : FALLBACK_STEPS

  return (
    <div style={{
      background: 'linear-gradient(135deg,#14532d,#1a6b3a)', border: '1px solid rgba(232,201,106,0.3)',
      borderRadius: 14, padding: '16px 16px 14px', marginBottom: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 18 }}>📱</span>
        <div style={{ fontFamily: 'var(--font-body)', fontWeight: 800, fontSize: 12, letterSpacing: 0.5, textTransform: 'uppercase', color: '#e8c96a' }}>
          Get the best Teein&apos; It Up experience
        </div>
      </div>

      <div style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14, color: '#fff', marginBottom: 8 }}>
        Install Teein&apos; It Up before you play.
      </div>

      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 12 }}>
        {FEATURES.map(f => (
          <li key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 7, fontFamily: 'var(--font-body)', fontSize: 12, color: 'rgba(255,255,255,0.85)', lineHeight: 1.4 }}>
            <span style={{ color: '#e8c96a', flexShrink: 0 }}>✓</span>
            <span>{f}</span>
          </li>
        ))}
      </ul>

      <div style={{ display: 'flex', gap: 10 }}>
        <button
          onClick={() => void handleInstall()}
          style={{
            flex: 1, padding: 11, borderRadius: 9, background: '#e8c96a', border: 'none',
            fontFamily: 'var(--font-body)', fontWeight: 800, fontSize: 13, color: '#0f2d1c', cursor: 'pointer',
          }}
        >
          Install Teein&apos; It Up
        </button>
        <button
          onClick={handleMaybeLater}
          style={{
            padding: '11px 14px', borderRadius: 9, background: 'none', border: '1px solid rgba(255,255,255,0.25)',
            fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 12.5, color: 'rgba(255,255,255,0.8)', cursor: 'pointer',
          }}
        >
          Maybe later
        </button>
      </div>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, color: 'rgba(255,255,255,0.5)', textAlign: 'center', marginTop: 8 }}>
        Takes about 10 seconds.
      </div>

      {showSheet && (
        <div
          onClick={() => setShowSheet(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'flex-end' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#faf6ed', borderRadius: '18px 18px 0 0', padding: '22px 20px',
              paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))',
              width: '100%', maxWidth: 540, margin: '0 auto',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/icon-192.png" alt="" style={{ width: 40, height: 40, borderRadius: 10 }} />
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 800, color: '#14532d' }}>
                Add Teein&apos; It Up to your Home Screen
              </div>
            </div>
            <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {steps.map((step, i) => (
                <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{
                    width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                    background: '#e8c96a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13,
                  }}>{step.icon}</span>
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: '#1a1a16' }}>{step.text}</span>
                </li>
              ))}
            </ol>
            <button
              onClick={() => setShowSheet(false)}
              style={{
                display: 'block', width: '100%', marginTop: 18, padding: 12, borderRadius: 10,
                background: '#f3f4f6', border: '1px solid #d1d5db', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, cursor: 'pointer',
              }}
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
