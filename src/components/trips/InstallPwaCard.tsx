'use client'

import { useState } from 'react'
import { useInstallPrompt } from '@/lib/pwa/useInstallPrompt'

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

export default function InstallPwaCard({ onDismiss }: { onDismiss?: () => void }) {
  const { platform, promptInstall } = useInstallPrompt()
  const [showIosSheet, setShowIosSheet] = useState(false)
  // Lazy initializer, not useState(false) — reading the persisted value
  // only at mount time. Without this, a previously-dismissed card would
  // flash visible again on every fresh page load before any check ran,
  // exactly the repeat-nagging behaviour "do not repeatedly nag" rules
  // out.
  const [dismissed, setDismissed] = useState(() => isInstallCardDismissed())

  if (platform === 'installed' || platform === 'unsupported' || dismissed) return null

  function handleMaybeLater() {
    markInstallCardDismissed()
    setDismissed(true)
    onDismiss?.()
  }

  async function handleAddToHomeScreen() {
    if (platform === 'android-supported') {
      // Real, native browser flow — not a faked button. If the browser
      // hasn't actually surfaced beforeinstallprompt yet, promptInstall
      // is a safe no-op rather than pretending to install anything.
      await promptInstall()
      return
    }
    setShowIosSheet(true)
  }

  return (
    <div style={{
      background: 'linear-gradient(135deg,#14532d,#1a6b3a)', border: '1px solid rgba(232,201,106,0.3)',
      borderRadius: 14, padding: '14px 16px', marginBottom: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 22, flexShrink: 0 }}>📱</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--font-body)', fontWeight: 800, fontSize: 13.5, color: '#fff' }}>
            Keep Teein&apos; It Up handy
          </div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: 'rgba(255,255,255,0.75)', marginTop: 2, lineHeight: 1.4 }}>
            Add Teein&apos; It Up to your phone for one-tap access throughout the event.
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
        <button
          onClick={() => void handleAddToHomeScreen()}
          style={{
            flex: 1, padding: 10, borderRadius: 9, background: '#e8c96a', border: 'none',
            fontFamily: 'var(--font-body)', fontWeight: 800, fontSize: 12.5, color: '#0f2d1c', cursor: 'pointer',
          }}
        >
          Add to Home Screen →
        </button>
        <button
          onClick={handleMaybeLater}
          style={{
            padding: '10px 14px', borderRadius: 9, background: 'none', border: '1px solid rgba(255,255,255,0.25)',
            fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 12.5, color: 'rgba(255,255,255,0.8)', cursor: 'pointer',
          }}
        >
          Maybe later
        </button>
      </div>

      {showIosSheet && (
        <div
          onClick={() => setShowIosSheet(false)}
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
              {[
                { icon: '⬆️', text: <>Tap <strong>Share</strong></> },
                { icon: '➕', text: <>Choose <strong>Add to Home Screen</strong></> },
                { icon: '✓', text: <>Tap <strong>Add</strong></> },
              ].map((step, i) => (
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
              onClick={() => setShowIosSheet(false)}
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
