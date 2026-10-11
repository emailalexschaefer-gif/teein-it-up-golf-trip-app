'use client'

import type { CSSProperties, ReactNode } from 'react'
import type { WorkflowStage, WorkflowStageId } from '@/lib/scoring/roundWorkflow'

/**
 * My HQ V2 (10 Oct), Phase C — the compact five-stage progress tracker
 * beneath Event Schedule, per the approved brief ("a compact vertical
 * stepper or responsive progress card is preferred over a crowded
 * five-column navigation bar"). Purely presentational: every stage's
 * status, detail text and which one (if any) is primary come from
 * `deriveRoundWorkflow()` (src/lib/scoring/roundWorkflow.ts) — nothing
 * here recomputes lifecycle state, and no click here mutates anything
 * directly; `onAction` is the caller's existing handler for whichever
 * real action a stage's button represents (open the Begin Round
 * wizard, scroll to the live dashboard, open Close Round's own
 * confirmation, open Makers & Breakers, jump to Review & Present) —
 * this component only decides what to show, never what happens.
 *
 * Phase E (11 Oct), Task #55 — "Organiser Control Centre
 * Consolidation." Renamed from "Guided Workflow" to "Round Control
 * Centre" (dynamic per round name, per the approved brief), and every
 * stage row is now independently expandable/collapsible via a chevron
 * on the row header. `expandedStages`/`onToggleStage` are CONTROLLED
 * from the caller (MyHQClient) rather than owned here, specifically so
 * the caller can auto-expand the current actionable stage once per
 * round selection and can also expand a stage programmatically when
 * its own primary action is pressed (e.g. "Close Round" expanding
 * Stage 2/3 before scrolling to the embedded Close Round control) —
 * this component stays a pure, controlled renderer, same as before.
 * `renderBody`, when supplied, renders the caller's real embedded
 * content for a stage directly beneath its detail text whenever that
 * stage is expanded — still never anything this component invents or
 * owns itself.
 *
 * Visual language, per the approved brief:
 *   - green  = genuinely complete
 *   - gold   = the one current/primary recommended action
 *   - grey   = not yet reached
 *   - amber  = reached but waiting on something (e.g. Close Round
 *              during live play) — NOT a blocker, just not actionable
 *              yet; stays visible the whole time rather than vanishing
 *   - a muted outline = "accessible, but not the primary action" —
 *              Stage 5 while Stage 4 is still outstanding; never
 *              rendered as a second gold/primary row.
 * Colour is never the only signal — every state also has distinct text
 * ("Current", "Waiting", "Complete", "Available") so nothing here
 * depends on colour perception alone.
 */

type VisualState = 'complete' | 'primary' | 'live' | 'waiting' | 'accessible' | 'upcoming'

function visualState(stage: WorkflowStage, primaryStageId: WorkflowStageId | null): VisualState {
  if (stage.complete) return 'complete'
  if (stage.id === primaryStageId) return 'primary'
  if (!stage.reached) return 'upcoming'
  if (stage.id === 'manage') return 'live'
  if (stage.actionable) return 'accessible'
  return 'waiting'
}

const STATE_META: Record<VisualState, { badge: string; circle: string; circleBorder: string; text: string; cardBg: string; cardBorder: string }> = {
  complete:   { badge: 'Complete',  circle: '#16a34a', circleBorder: '#16a34a', text: '#166534', cardBg: '#ffffff', cardBorder: '#eceae3' },
  primary:    { badge: 'Current',   circle: '#a1791f', circleBorder: '#e8c96a', text: '#7a5c00',  cardBg: '#fdf3d9', cardBorder: '#e8c96a' },
  live:       { badge: 'In progress', circle: '#16a34a', circleBorder: '#bbf7d0', text: '#14532d', cardBg: '#ffffff', cardBorder: '#eceae3' },
  waiting:    { badge: 'Waiting',   circle: '#a1791f', circleBorder: '#e8c96a', text: '#7a5c00', cardBg: '#fffaf0', cardBorder: '#f0dca0' },
  accessible: { badge: 'Available', circle: '#9ca3af', circleBorder: '#d8d4c8', text: '#7a7260', cardBg: '#ffffff', cardBorder: '#eceae3' },
  upcoming:   { badge: 'Upcoming',  circle: '#d1d5db', circleBorder: '#e5e7eb', text: '#9ca3af', cardBg: '#ffffff', cardBorder: '#eceae3' },
}

const containerStyle: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 8,
  background: '#ffffff', borderRadius: 14, border: '1px solid #eceae3',
  boxShadow: '0 2px 12px rgba(0,0,0,0.06)', padding: '14px 14px 16px',
}

export default function RoundWorkflowTracker({
  roundName, stages, primaryStageId, onAction, expandedStages, onToggleStage, renderBody,
}: {
  roundName: string
  stages: WorkflowStage[]
  primaryStageId: WorkflowStageId | null
  /** Caller's existing handler for a stage's action button — this component owns no mutation logic. */
  onAction: (stageId: WorkflowStageId) => void
  /** Which stages are currently expanded — controlled by the caller. */
  expandedStages: Set<WorkflowStageId>
  /** Toggle a stage's own expand/collapse — never touches any other stage's state. */
  onToggleStage: (stageId: WorkflowStageId) => void
  /** The caller's real embedded content for a stage, shown only while that stage is expanded. */
  renderBody?: (stageId: WorkflowStageId) => ReactNode
}) {
  return (
    <div style={containerStyle}>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {roundName} — Round Control Centre
      </div>
      {stages.map((stage, index) => {
        const state = visualState(stage, primaryStageId)
        const meta = STATE_META[state]
        const isLast = index === stages.length - 1
        const isExpanded = expandedStages.has(stage.id)
        const body = renderBody?.(stage.id)
        return (
          <div key={stage.id} style={{ display: 'flex', gap: 10 }}>
            {/* Connector rail */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 20 }}>
              <div
                style={{
                  width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                  border: `2px solid ${meta.circleBorder}`,
                  background: state === 'complete' || state === 'primary' || state === 'live' ? meta.circle : '#ffffff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, color: '#ffffff', fontWeight: 800,
                }}
              >
                {state === 'complete' ? '✓' : index + 1}
              </div>
              {!isLast && <div style={{ width: 2, flex: 1, minHeight: 14, background: '#e5e7eb', marginTop: 2 }} />}
            </div>

            <div style={{ flex: 1, minWidth: 0, paddingBottom: isLast ? 0 : 10 }}>
              {/* Row header is its own button (not the whole row) so the
                  existing primary/accessible action buttons below keep
                  working as independent click targets, un-nested inside
                  another button (which the DOM disallows) and un-changed
                  in behaviour. */}
              <button
                onClick={() => onToggleStage(stage.id)}
                aria-expanded={isExpanded}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                  background: 'none', border: 'none', padding: 0, margin: 0, cursor: 'pointer', textAlign: 'left',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
                  <span style={{ color: '#c4c0b4', fontSize: 11, flexShrink: 0, transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s ease' }}>▸</span>
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: 13.5, fontWeight: 700, color: state === 'upcoming' ? '#9ca3af' : '#1a1a16' }}>
                    {stage.label}
                  </span>
                </span>
                <span style={{ fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 800, color: meta.text, textTransform: 'uppercase', letterSpacing: 0.4, flexShrink: 0 }}>
                  {meta.badge}
                </span>
              </button>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: state === 'upcoming' ? '#c4c0b4' : '#7a7260', marginTop: 2, paddingLeft: 17 }}>
                {stage.detail}
              </div>

              {state === 'primary' && stage.actionLabel && (
                <button
                  onClick={() => onAction(stage.id)}
                  style={{
                    marginTop: 8, padding: '9px 16px', borderRadius: 9, border: 'none',
                    background: 'linear-gradient(135deg,#2d7a52,#16a34a)', color: '#ffffff',
                    fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, cursor: 'pointer',
                  }}
                >
                  {stage.actionLabel} →
                </button>
              )}

              {state === 'accessible' && stage.actionLabel && (
                <button
                  onClick={() => onAction(stage.id)}
                  style={{
                    marginTop: 6, padding: '6px 12px', borderRadius: 8, cursor: 'pointer',
                    background: 'none', border: '1px solid #d8d4c8', color: '#7a7260',
                    fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12,
                  }}
                >
                  {stage.actionLabel} →
                </button>
              )}

              {/* Stage 4, once complete, stays revisitable — never a locked terminal row. */}
              {state === 'complete' && stage.id === 'makersBreakers' && (
                <button
                  onClick={() => onAction(stage.id)}
                  style={{
                    marginTop: 4, padding: 0, border: 'none', background: 'none', cursor: 'pointer',
                    fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 11.5, color: '#a1791f', textDecoration: 'underline',
                  }}
                >
                  Review again →
                </button>
              )}

              {isExpanded && body != null && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #f0eee6' }}>
                  {body}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
