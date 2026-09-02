'use client'

import { useState } from 'react'
import { trackEvent } from '@/lib/analytics/trackEvent'

type Intent = 'player' | 'organiser' | 'both'

const INTENT_OPTIONS: { value: Intent; label: string }[] = [
  { value: 'player', label: 'Player' },
  { value: 'organiser', label: 'Organiser' },
  { value: 'both', label: 'Both' },
]

const ORGANISER_TYPE_LABELS: Record<string, string> = {
  golf_trips: 'Golf Trips',
  social_golf: "Social Golf / Mates' Golf",
  corporate: 'Corporate Golf Days',
  club_community: 'Club / Community Golf Events',
  other: 'Other',
}

/**
 * Crucial MVP Onboarding Update, item 4 — "provide a safe way to
 * progressively capture this information later, through profile/
 * onboarding completion." This is that safe, optional path: every
 * existing account (which never went through the new-signup gate at
 * all, since it only applies within 15 minutes of account creation —
 * see AppLayout) can still answer this, voluntarily, at their own
 * pace, from their own Profile page. Never a gate, never forced —
 * simply available.
 */
export default function IntentSection({
  initialIntent, initialOrganiserTypes,
}: {
  initialIntent: string | null
  initialOrganiserTypes: string[] | null
}) {
  const [intent, setIntent] = useState<string | null>(initialIntent)
  const [organiserTypes, setOrganiserTypes] = useState<string[]>(initialOrganiserTypes ?? [])
  const [editing, setEditing] = useState(!initialIntent)
  const [saving, setSaving] = useState(false)

  async function save(newIntent: Intent, newTypes: string[]) {
    setSaving(true)
    try {
      await fetch('/api/me/intent', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIntent: newIntent, organiserTypes: newTypes }),
      })
      trackEvent('onboarding_intent_captured', { intent: newIntent })
      setIntent(newIntent)
      setOrganiserTypes(newTypes)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  function toggleType(value: string) {
    setOrganiserTypes(prev => prev.includes(value) ? prev.filter(t => t !== value) : [...prev, value])
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #eceae3', borderRadius: 14, padding: '16px 16px', marginTop: 16 }}>
      <div style={{ fontFamily: 'var(--font-display)', color: '#14532d', fontSize: 14, fontWeight: 800, marginBottom: editing ? 12 : 4 }}>
        How do you use Teein&apos; It Up?
      </div>

      {!editing && intent && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 13.5, color: '#4a4638', fontWeight: 600 }}>
              {INTENT_OPTIONS.find(o => o.value === intent)?.label}
            </span>
            {organiserTypes.length > 0 && (
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: '#9ca3af', marginTop: 2 }}>
                {organiserTypes.map(t => ORGANISER_TYPE_LABELS[t] ?? t).join(', ')}
              </div>
            )}
          </div>
          <button
            onClick={() => setEditing(true)}
            style={{ fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, color: '#7a5c00', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            Change
          </button>
        </div>
      )}

      {editing && (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: (intent === 'organiser' || intent === 'both') ? 12 : 0 }}>
            {INTENT_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setIntent(opt.value)}
                style={{
                  flex: 1, padding: '9px 0', borderRadius: 8, cursor: 'pointer',
                  background: intent === opt.value ? '#14532d' : '#fff',
                  color: intent === opt.value ? '#fff' : '#14532d',
                  border: intent === opt.value ? 'none' : '1.5px solid #eceae3',
                  fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 700,
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {(intent === 'organiser' || intent === 'both') && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {Object.entries(ORGANISER_TYPE_LABELS).map(([value, label]) => {
                const checked = organiserTypes.includes(value)
                return (
                  <button
                    key={value}
                    onClick={() => toggleType(value)}
                    style={{
                      padding: '6px 10px', borderRadius: 999, fontSize: 11.5, fontFamily: 'var(--font-body)', fontWeight: 600, cursor: 'pointer',
                      background: checked ? '#f0ead9' : '#fff', border: checked ? '1.5px solid #c9a84c' : '1px solid #eceae3',
                      color: checked ? '#7a5c00' : '#9ca3af',
                    }}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          )}

          <button
            onClick={() => intent && save(intent as Intent, organiserTypes)}
            disabled={!intent || saving}
            style={{
              width: '100%', padding: '10px 0', borderRadius: 8, border: 'none',
              background: '#14532d', color: '#fff', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13,
              cursor: 'pointer', opacity: (!intent || saving) ? 0.6 : 1,
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </div>
  )
}
