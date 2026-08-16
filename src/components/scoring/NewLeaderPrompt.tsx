'use client'

import MomentCapture from '@/components/moments/MomentCapture'

// Celebratory, but deliberately NOT declaring official leadership — per
// explicit instruction: "Do not yet describe [the player] publicly as
// the official leader." wouldLeadIfVerified is real and worth
// celebrating (it's genuinely a great shot), but it's conditional on the
// marker's confirmation, and the copy says so.
const HEADLINE: Record<string, () => string> = {
  nearest_pin:   () => '🎯 THAT COULD BE THE NTP LEAD!',
  pros_approach: () => '🎯 THAT COULD BE THE LEAD!',
  longest_drive: () => '💥 THAT COULD BE THE LONGEST DRIVE!',
}
const SUBTEXT: Record<string, string> = {
  nearest_pin: 'Grab a photo while you\'re still at the pin — your Playing Partner will confirm it.',
  pros_approach: 'Grab a photo while you\'re still at the pin — your Playing Partner will confirm it.',
  longest_drive: 'Grab a photo at your ball before playing the next shot — your Playing Partner will confirm it.',
}

export interface NewLeaderContext {
  tripId: string
  roundId: string
  holeNumber: number
  myGroupId: string | null
  sideCompId: string
  compType: 'nearest_pin' | 'longest_drive' | 'pros_approach'
  entryId: string | null
  playerName: string
  claimedValue: number | null
}

/**
 * One-shot Capture the Moment prompt, triggered by a claim's
 * wouldLeadIfVerified — not by official leadership, which doesn't exist
 * at claim time anymore (Stage 1). The parent only ever mounts this in
 * direct, immediate reaction to a POST response (see
 * SideCompEntryPanel's onWouldLeadIfVerified) — never from a GET, a
 * poll, or a re-render of unrelated state. Once dismissed (Skip, or a
 * successful post), the parent unmounts it and there is no mechanism
 * anywhere in this component that could bring it back on its own — a
 * refresh re-fetches GET state (current leader, my entry), which never
 * includes "should I show the prompt" at all, so a reload can never
 * reopen it either.
 */
export default function NewLeaderPrompt({ ctx, onDismiss }: { ctx: NewLeaderContext; onDismiss: () => void }) {
  const headline = HEADLINE[ctx.compType]?.() ?? '🏁 THAT COULD BE THE LEAD!'
  const subtext = SUBTEXT[ctx.compType] ?? 'Grab a photo now — your Playing Partner will confirm it.'

  return (
    <div style={{
      background: 'linear-gradient(135deg,#0f2d1c,#1a4731)', border: '1.5px solid #c9a84c',
      borderRadius: 14, padding: '14px 16px', marginBottom: 10, boxShadow: '0 4px 18px rgba(0,0,0,0.25)',
    }}>
      <div style={{ fontFamily: 'var(--font-display)', color: '#fff', fontWeight: 900, fontSize: 14.5, letterSpacing: 0.2 }}>
        {headline}
      </div>
      <div style={{ fontFamily: 'var(--font-body)', color: '#e8c96a', fontWeight: 700, fontSize: 13, marginTop: 2 }}>
        {ctx.playerName}{ctx.claimedValue != null ? ` · ${ctx.claimedValue}m` : ''} · pending verification
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
            preview/caption/post UI takes over once a photo is selected.
            The photo uploads and is preserved immediately regardless of
            verification status — per explicit instruction, the only
            copy of this image is never left sitting locally waiting on
            a marker. What's pending is the ACHIEVEMENT association, not
            the photo itself, which the existing Moments pipeline already
            handles unchanged from before Stage 1/2. */}
        <MomentCapture
          tripId={ctx.tripId} roundId={ctx.roundId} holeNumber={ctx.holeNumber} myGroupId={ctx.myGroupId}
          sideCompContext={{ sideCompId: ctx.sideCompId, entryId: ctx.entryId, leadChangeId: null, compType: ctx.compType, resultValue: ctx.claimedValue }}
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
