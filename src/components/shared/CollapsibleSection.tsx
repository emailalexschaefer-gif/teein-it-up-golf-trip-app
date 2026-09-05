'use client'

import { useState, type ReactNode } from 'react'

/**
 * My Golf + My HQ UX Cleanup brief (5 Sep) — the single, shared
 * accordion/disclosure pattern used consistently across both pages,
 * per the explicit "prefer reuse... rather than creating multiple
 * inconsistent implementations" instruction. This project had several
 * one-off expand/collapse implementations scattered across earlier
 * work (MyBadgesSection's badge-type rows, RoundHighlightsSection's
 * header, WelcomeBrochure's CollapsedWelcomeCard) but no single shared
 * component — this is that component, going forward.
 *
 * Deliberately presentation-only: renders whatever `children` already
 * is, unmodified, when expanded. Never fetches data itself, never owns
 * any business state — an existing section can be moved into this
 * wrapper without changing what it renders or how its own data loads,
 * matching the explicit "expanded content behaves exactly as it did
 * previously" requirement.
 */
export default function CollapsibleSection({
  icon, title, count, statusBadge, defaultExpanded = false, children,
}: {
  icon: string
  title: string
  /** Optional "(4)" style count shown right after the title. */
  count?: number
  /**
   * "Collapsed must never mean an important problem is invisible" —
   * rendered in the collapsed header itself, not only inside the
   * expanded content — e.g. "2 need attention ⚠️". Purely
   * presentational; the caller decides what this says and when.
   */
  statusBadge?: ReactNode
  defaultExpanded?: boolean
  children: ReactNode
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  return (
    <div style={{ background: '#fff', border: '1px solid #eceae3', borderRadius: 14, marginBottom: 12, overflow: 'hidden' }}>
      <button
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
          // The WHOLE header row is the tap target, not just the
          // chevron or title text — "entire sensible header area
          // tappable" and "large enough mobile touch target" are both
          // literal sizing requirements, not just descriptions.
          padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', gap: 10,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
          <span style={{ fontSize: 17, flexShrink: 0 }}>{icon}</span>
          {/* minWidth: 0 is the actual fix for "long Event/player/group
              names must not break layout" — without it, a flex
              child's own default min-width silently defeats
              text-overflow:ellipsis and forces horizontal overflow on
              the whole card instead of truncating cleanly. */}
          <span style={{
            fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 15, color: '#14532d',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
          }}>
            {title}{count !== undefined ? ` (${count})` : ''}
          </span>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {statusBadge}
          <span style={{ fontSize: 13, color: '#9ca3af', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }}>
            ▾
          </span>
        </span>
      </button>
      {expanded && (
        <div style={{ padding: '0 16px 16px', borderTop: '1px solid #f3f4f1' }}>
          <div style={{ paddingTop: 14 }}>{children}</div>
        </div>
      )}
    </div>
  )
}
