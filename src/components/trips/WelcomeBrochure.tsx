'use client'


/**
 * Icons below are copied verbatim from TripBottomNav.tsx's own item
 * definitions (🏠 ⛳ 🏆 🎯 🎛️ 💬) — inspected directly rather than
 * assumed. Note the fifth destination: the real nav uses 🎛️ for
 * "My Round"/"My HQ", not a golfer emoji — even though earlier
 * reference mockups showed a golfer icon there, the explicit
 * instruction ("use the exact same icons, do not invent") takes
 * precedence over an illustrative example, so this uses 🎛️ to
 * genuinely match what players already see in their own nav bar.
 */
const DESTINATIONS = [
  { icon: '🏠', label: 'Home', desc: 'Your events and what\u2019s coming up.' },
  { icon: '⛳', label: 'Scorecard', desc: 'Everything you need when it\u2019s time to play.' },
  { icon: '🏆', label: 'Leaderboard', desc: 'Follow the competition live.' },
  { icon: '🎯', label: 'Side Games', desc: 'NTPs, Long Drives and bragging rights.' },
  { icon: '🎛️', label: 'My Golf', desc: 'Your rounds, highlights and golf story.' },
  { icon: '💬', label: 'Chat', desc: 'Announcements, conversation and Moments.' },
]

const DISMISS_KEY_PREFIX = 'lobby-brochure-dismissed-'

export function isBrochureDismissed(tripId: string): boolean {
  if (typeof window === 'undefined') return true // SSR-safe default — never flashes the full brochure during hydration
  try {
    return window.localStorage.getItem(`${DISMISS_KEY_PREFIX}${tripId}`) === '1'
  } catch {
    return false // localStorage unavailable (private browsing etc.) — fail open to showing the brochure once, not silently breaking
  }
}

function markBrochureDismissed(tripId: string) {
  try { window.localStorage.setItem(`${DISMISS_KEY_PREFIX}${tripId}`, '1') } catch { /* best-effort — a repeat brochure once in a rare browser is a minor annoyance, not worth a fallback system */ }
}

export default function WelcomeBrochure({
  tripId, tripName, watermarkUrl, onDismiss,
}: {
  tripId: string; tripName: string; watermarkUrl: string; onDismiss: () => void
}) {
  function handleGotIt() {
    markBrochureDismissed(tripId)
    onDismiss()
  }

  return (
    <div style={{
      position: 'relative', borderRadius: 18, overflow: 'hidden',
      border: '1.5px solid #c9a84c', marginBottom: 16,
      boxShadow: '0 6px 24px rgba(15,45,28,0.35)',
    }}>
      {/* Atmospheric watermark — a strong dark green gradient sits over
          it so text stays fully legible and the image reads as
          ambience, not content, matching "do not let the image
          dominate." */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: `url(${watermarkUrl})`, backgroundSize: 'cover', backgroundPosition: 'center',
      }} />
      <div style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(165deg, rgba(15,45,28,0.94) 0%, rgba(15,45,28,0.88) 40%, rgba(15,45,28,0.82) 100%)',
      }} />

      <div style={{ position: 'relative', padding: '20px 18px 18px' }}>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, color: '#e8c96a', letterSpacing: 0.6, textTransform: 'uppercase' }}>
          👋 Welcome to the
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 800, color: '#ffffff', lineHeight: 1.1, marginTop: 2 }}>
          Event Lobby
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: '#e8c96a', marginTop: 2 }}>
          {tripName}
        </div>

        <p style={{ fontFamily: 'var(--font-body)', fontSize: 13.5, color: 'rgba(255,255,255,0.85)', lineHeight: 1.5, marginTop: 12, marginBottom: 16 }}>
          Grab yourself a drink, meet the other guests and have a look around.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {DESTINATIONS.map(d => (
            <div key={d.label} style={{
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(232,201,106,0.25)',
              borderRadius: 12, padding: '10px 8px', textAlign: 'center',
            }}>
              <div style={{ fontSize: 22, marginBottom: 4 }}>{d.icon}</div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, fontWeight: 700, color: '#e8c96a' }}>{d.label}</div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 9.5, color: 'rgba(255,255,255,0.65)', marginTop: 2, lineHeight: 1.3 }}>{d.desc}</div>
            </div>
          ))}
        </div>

        <p style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 14, color: '#e8c96a', textAlign: 'center', marginTop: 16, marginBottom: 14 }}>
          Enjoy the event! 🍻
        </p>

        <button
          onClick={handleGotIt}
          style={{
            display: 'block', width: '100%', padding: 13, borderRadius: 10,
            background: '#e8c96a', border: 'none', color: '#0f2d1c',
            fontFamily: 'var(--font-body)', fontWeight: 800, fontSize: 14, cursor: 'pointer',
          }}
        >
          Got it ✓
        </button>
      </div>
    </div>
  )
}

/**
 * The small reopenable card shown after dismissal — item 3's explicit
 * "small unobtrusive Lobby card... can tap this at any time to reopen."
 */
export function CollapsedWelcomeCard({ onReopen }: { onReopen: () => void }) {
  return (
    <button
      onClick={onReopen}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
        background: 'linear-gradient(135deg,#14532d,#1a6b3a)', border: '1px solid rgba(232,201,106,0.3)',
        borderRadius: 12, padding: '10px 14px', marginBottom: 12, cursor: 'pointer', textAlign: 'left',
      }}
    >
      <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, color: '#fff' }}>
        👋 Welcome to the Event Lobby
      </span>
      <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, color: '#e8c96a', flexShrink: 0, marginLeft: 10 }}>
        Show welcome guide →
      </span>
    </button>
  )
}
