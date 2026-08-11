'use client'

import MomentCapture from '@/components/moments/MomentCapture'

const HEADLINE: Record<string, (playerName: string) => string> = {
  nearest_pin:   () => "🎯 YOU'RE THE NEW NTP LEADER!",
  pros_approach: () => '🎯 NEW PRO\'S APPROACH LEADER',
  longest_drive: () => "💥 YOU'VE TAKEN THE LONGEST DRIVE LEAD",
}
const SUBTEXT: Record<string, string> = {
  nearest_pin: 'Grab a photo while you\'re still at the pin.',
  pros_approach: 'Grab a photo while you\'re still at the pin.',
  longest_drive: 'Grab a photo at your ball before playing the next shot.',
}

export interface NewLeaderContext {
  tripId: string
  roundId: string
  holeNumber: number
  myGroupId: string | null
  sideCompId: string
  compType: 'nearest_pin' | 'longest_drive' | 'pros_approach'
  entryId: string | null
  leadChangeId: string | null
  playerName: string
  resultValue: number | null
}

/**
 * One-shot Capture the Moment prompt. The parent only ever mounts this
 * component in direct, immediate reaction to a POST response with
 * becameLeader: true (see SideCompEntryPanel's onBecameLeader) — never
 * from a GET, a poll, or a re-render of unrelated state. Once dismissed
 * (Skip, or a successful post), the parent unmounts it and there is no
 * mechanism anywhere in this component that could bring it back on its
 * own — a refresh re-fetches GET state (current leader, my entry), which
 * never includes "should I show the prompt" at all, so a reload can
 * never reopen it either.
 */
export default function NewLeaderPrompt({ ctx, onDismiss }: { ctx: NewLeaderContext; onDismiss: () => void }) {
  const headline = HEADLINE[ctx.compType]?.(ctx.playerName) ?? '🏁 NEW LEADER!'
  const subtext = SUBTEXT[ctx.compType] ?? 'Grab a photo while you can.'

  return (
    <div style={{
      background: 'linear-gradient(135deg,#0f2d1c,#1a4731)', border: '1.5px solid #c9a84c',
      borderRadius: 14, padding: '14px 16px', marginBottom: 10, boxShadow: '0 4px 18px rgba(0,0,0,0.25)',
    }}>
      <div style={{ fontFamily: 'var(--font-display)', color: '#fff', fontWeight: 900, fontSize: 14.5, letterSpacing: 0.2 }}>
        {headline}
      </div>
      <div style={{ fontFamily: 'var(--font-body)', color: '#e8c96a', fontWeight: 700, fontSize: 13, marginTop: 2 }}>
        {ctx.playerName}{ctx.resultValue != null ? ` · ${ctx.resultValue}m` : ''}
      </div>

      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.15)' }}>
        <div style={{ fontFamily: 'var(--font-body)', color: '#fdf3d9', fontSize: 12, fontWeight: 700, marginBottom: 2 }}>
          📸 Capture the Moment
        </div>
        <div style={{ fontFamily: 'var(--font-body)', color: 'rgba(255,255,255,0.65)', fontSize: 11.5, marginBottom: 10 }}>
          {subtext}
        </div>

        {/* MomentCapture renders nothing visible until autoOpenCamera
            triggers the native camera picker — no intermediate "choosing"
            screen, matching the urgency of this specific prompt. Its own
            preview/caption/post UI takes over once a photo is selected. */}
        <MomentCapture
          tripId={ctx.tripId} roundId={ctx.roundId} holeNumber={ctx.holeNumber} myGroupId={ctx.myGroupId}
          sideCompContext={{ sideCompId: ctx.sideCompId, entryId: ctx.entryId, leadChangeId: ctx.leadChangeId, compType: ctx.compType, resultValue: ctx.resultValue }}
          autoOpenCamera
          onPosted={onDismiss}
        />

        <button
          onClick={onDismiss}
          style={{
            display: 'block', marginTop: 10, width: '100%', padding: '8px 0',
            background: 'none', border: '1px solid rgba(255,255,255,0.25)', borderRadius: 8,
            color: 'rgba(255,255,255,0.7)', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 12.5, cursor: 'pointer',
          }}
        >
          Skip
        </button>
      </div>
    </div>
  )
}
