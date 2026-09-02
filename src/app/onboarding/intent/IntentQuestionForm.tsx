'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { trackEvent } from '@/lib/analytics/trackEvent'

type Intent = 'player' | 'organiser' | 'both'

const INTENT_OPTIONS: { value: Intent; label: string; description: string }[] = [
  { value: 'player', label: 'Player', description: "I mainly want to play in golf events and social rounds." },
  { value: 'organiser', label: 'Organiser', description: 'I organise golf trips, golf days or events.' },
  { value: 'both', label: 'Both', description: 'I play and organise.' },
]

const ORGANISER_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'golf_trips', label: 'Golf Trips' },
  { value: 'social_golf', label: "Social Golf / Mates' Golf" },
  { value: 'corporate', label: 'Corporate Golf Days' },
  { value: 'club_community', label: 'Club / Community Golf Events' },
  { value: 'other', label: 'Other' },
]

/**
 * Crucial MVP Onboarding Update — the actual question UI. One tap on
 * Player/Organiser/Both submits immediately (per the explicit "do not
 * turn signup into a long survey" instruction — this is a single
 * decision, not a form to fill in and press Submit on). Organiser/Both
 * reveals the lightweight multi-select follow-up as a second, still-
 * optional step — skippable, since the primary signal (Player/
 * Organiser/Both) is already captured and persisted by that point;
 * the follow-up is a bonus, not a second gate.
 */
export default function IntentQuestionForm({ redirectTo }: { redirectTo: string }) {
  const router = useRouter()
  const [selectedIntent, setSelectedIntent] = useState<Intent | null>(null)
  const [selectedTypes, setSelectedTypes] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  async function submitIntent(intent: Intent) {
    setSelectedIntent(intent)
    if (intent === 'player') {
      await save(intent, [])
    }
    // organiser/both fall through to the follow-up screen below —
    // saved once the follow-up is submitted or skipped.
  }

  async function save(intent: Intent, organiserTypes: string[]) {
    setSaving(true)
    try {
      await fetch('/api/me/intent', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIntent: intent, organiserTypes }),
      })
      trackEvent('onboarding_intent_captured', { intent })
    } catch {
      // Non-fatal — this is a segmentation signal, not something that
      // should ever block a genuine new user from reaching the app.
      // Worst case: they land on their destination and, since
      // user_intent is still null, are asked again next time the gate
      // in AppLayout runs within its own recency window.
    } finally {
      router.push(redirectTo)
    }
  }

  function toggleType(value: string) {
    setSelectedTypes(prev => prev.includes(value) ? prev.filter(t => t !== value) : [...prev, value])
  }

  if (selectedIntent === 'organiser' || selectedIntent === 'both') {
    return (
      <div style={{ width: '100%', maxWidth: 420 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, color: '#14532d', textAlign: 'center', marginBottom: 8 }}>
          What kind of golf do you organise?
        </h1>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#7a7260', textAlign: 'center', marginBottom: 20 }}>
          Select any that apply.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
          {ORGANISER_TYPE_OPTIONS.map(opt => {
            const checked = selectedTypes.includes(opt.value)
            return (
              <button
                key={opt.value}
                onClick={() => toggleType(opt.value)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left',
                  background: checked ? '#f0ead9' : '#fff', border: checked ? '1.5px solid #c9a84c' : '1.5px solid #eceae3',
                  borderRadius: 10, padding: '12px 14px', cursor: 'pointer',
                }}
              >
                <span style={{
                  width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                  border: checked ? 'none' : '1.5px solid #a89f8a', background: checked ? '#c9a84c' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#fff',
                }}>{checked ? '✓' : ''}</span>
                <span style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: '#14532d', fontWeight: 600 }}>{opt.label}</span>
              </button>
            )
          })}
        </div>
        <button
          onClick={() => save(selectedIntent, selectedTypes)}
          disabled={saving}
          style={{
            width: '100%', background: '#14532d', color: '#fff', border: 'none', borderRadius: 12,
            padding: '13px 0', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 15, cursor: 'pointer',
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? 'Saving…' : selectedTypes.length > 0 ? 'Continue' : 'Skip this bit →'}
        </button>
      </div>
    )
  }

  return (
    <div style={{ width: '100%', maxWidth: 420 }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, color: '#14532d', textAlign: 'center', marginBottom: 24 }}>
        How do you see yourself using Teein&apos; It Up?
      </h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {INTENT_OPTIONS.map(opt => (
          <button
            key={opt.value}
            onClick={() => submitIntent(opt.value)}
            disabled={saving}
            style={{
              textAlign: 'left', background: '#fff', border: '1.5px solid #eceae3', borderRadius: 12,
              padding: '14px 16px', cursor: 'pointer', opacity: saving ? 0.6 : 1,
            }}
          >
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 15, fontWeight: 800, color: '#14532d', marginBottom: 2 }}>
              {opt.label}
            </div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: '#7a7260' }}>
              {opt.description}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
