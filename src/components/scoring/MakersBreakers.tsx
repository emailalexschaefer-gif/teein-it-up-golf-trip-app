'use client'

import { useEffect, useState } from 'react'

interface Highlight {
  category: string
  kind: 'maker' | 'breaker'
  icon: string
  title: string
  playerId: string
  playerName: string
  statLine: string
  // P0 field-test fix — the short, reusable, title-only explanation
  // ("High risk. High reward. Anything could happen.") shown once per
  // archetype regardless of who qualified for it — see this component's
  // render below and ARCHETYPE_DEFINITIONS in makersBreakers.ts for the
  // full set. Optional purely so this interface tolerates an older
  // cached API response that predates this field.
  definition?: string
  caption?: string
}

type Stage = 'loading' | 'error' | 'course_report' | 'curating' | 'presenting'

interface CourseReport {
  fieldAverage: number
  easiestHole: { holeNumber: number; par: number; average: number } | null
  hardestHole: { holeNumber: number; par: number; average: number } | null
}

/**
 * Item 4/5/6 — curation, presentation, and the handoff to round results,
 * all in one component since they're one continuous organiser flow
 * (not three separate pages navigated between). Kept intentionally
 * simple per "do not build an elaborate slideshow engine" — plain
 * tap/Next through an ordered array, no transition library.
 */
export default function MakersBreakers({
  tripId, roundId, onProceedToResults,
}: {
  tripId: string; roundId: string; onProceedToResults: () => void
}) {
  const [stage, setStage] = useState<Stage>('loading')
  const [makers, setMakers] = useState<Highlight[]>([])
  const [breakers, setBreakers] = useState<Highlight[]>([])
  const [courseReport, setCourseReport] = useState<CourseReport | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [presentIndex, setPresentIndex] = useState(0)
  const [publishState, setPublishState] = useState<'idle' | 'publishing' | 'done'>('idle')
  const [publishError, setPublishError] = useState('')

  async function publish() {
    setPublishState('publishing')
    setPublishError('')
    try {
      const selMakers = makers.filter(hl => selected.has(hl.category))
      const selBreakers = breakers.filter(hl => selected.has(hl.category))
      const res = await fetch(`/api/trips/${tripId}/rounds/${roundId}/published-highlights`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ highlights: [...selMakers, ...selBreakers] }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setPublishError(body.error ?? "Couldn't publish. Please try again.")
        setPublishState('idle')
        return
      }
      setPublishState('done')
    } catch {
      setPublishError('Connection issue — please try again.')
      setPublishState('idle')
    }
  }

  useEffect(() => {
    let cancelled = false
    fetch(`/api/trips/${tripId}/rounds/${roundId}/highlights`)
      .then(async res => {
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body.error ?? 'Could not generate highlights.')
        return body as { makers: Highlight[]; breakers: Highlight[]; courseReport: CourseReport }
      })
      .then(body => {
        if (cancelled) return
        setMakers(body.makers)
        setBreakers(body.breakers)
        setCourseReport(body.courseReport)
        // Target presentation set: 3 makers + 3 breakers by default
        // (item 4), capped to however many actually generated — the
        // organiser can still adjust from here, this is just a sensible
        // starting selection, not a hard rule.
        const defaultSelection = new Set([
          ...body.makers.slice(0, 3).map(h => h.category),
          ...body.breakers.slice(0, 3).map(h => h.category),
        ])
        setSelected(defaultSelection)
        setStage('course_report')
      })
      .catch(() => { if (!cancelled) setStage('error') })
    return () => { cancelled = true }
  }, [tripId, roundId])

  function toggle(category: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })
  }

  // Alternate makers/breakers where practical (item 5) — a simple
  // interleave of the two selected lists, not a full shuffle.
  function buildPresentationOrder(): Highlight[] {
    const selMakers = makers.filter(h => selected.has(h.category))
    const selBreakers = breakers.filter(h => selected.has(h.category))
    const order: Highlight[] = []
    const max = Math.max(selMakers.length, selBreakers.length)
    for (let i = 0; i < max; i++) {
      if (selMakers[i]) order.push(selMakers[i])
      if (selBreakers[i]) order.push(selBreakers[i])
    }
    return order
  }

  if (stage === 'loading') {
    return <div style={{ textAlign: 'center', padding: '40px 0', fontFamily: 'var(--font-body)', color: '#9ca3af', fontSize: 13 }}>Reviewing the round…</div>
  }

  if (stage === 'error') {
    return (
      <div style={{ textAlign: 'center', padding: '32px 16px' }}>
        <p style={{ fontFamily: 'var(--font-body)', color: '#9ca3af', fontSize: 13, marginBottom: 12 }}>Could not generate highlights for this round.</p>
        <button onClick={onProceedToResults} style={{ padding: '9px 18px', borderRadius: 10, background: '#14532d', color: '#fff', border: 'none', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
          Present Round Results →
        </button>
      </div>
    )
  }

  // Item 2 — the standard opening screen before the candidate lists.
  // "Very short factual summary" — three lines, no elaboration.
  if (stage === 'course_report' && courseReport) {
    return (
      <div style={{ textAlign: 'center', padding: '24px 16px' }}>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#9ca3af', marginBottom: 4 }}>
          Field average: {courseReport.fieldAverage.toFixed(1)} pts
        </div>
        {courseReport.easiestHole && (
          <div style={{ marginTop: 16, fontFamily: 'var(--font-body)' }}>
            <div style={{ fontSize: 20, marginBottom: 2 }}>😇 Easiest Hole</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#14532d' }}>Hole {courseReport.easiestHole.holeNumber}, Par {courseReport.easiestHole.par}</div>
            <div style={{ fontSize: 12, color: '#9ca3af' }}>Field average: {courseReport.easiestHole.average.toFixed(1)} pts</div>
          </div>
        )}
        {courseReport.hardestHole && (
          <div style={{ marginTop: 16, fontFamily: 'var(--font-body)' }}>
            <div style={{ fontSize: 20, marginBottom: 2 }}>😈 Hardest Hole</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#14532d' }}>Hole {courseReport.hardestHole.holeNumber}, Par {courseReport.hardestHole.par}</div>
            <div style={{ fontSize: 12, color: '#9ca3af' }}>Field average: {courseReport.hardestHole.average.toFixed(1)} pts</div>
          </div>
        )}
        <button
          onClick={() => setStage('curating')}
          style={{ marginTop: 24, padding: '11px 24px', borderRadius: 10, background: '#14532d', color: '#fff', border: 'none', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
        >
          Find Makers &amp; Breakers →
        </button>
      </div>
    )
  }

  if (stage === 'curating') {
    return (
      <div>
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 30, marginBottom: 6 }}>🏁</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 800, color: '#14532d' }}>Round Complete</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, color: '#a1791f', marginTop: 2 }}>Makers &amp; Breakers</div>
          <p style={{ fontFamily: 'var(--font-body)', fontStyle: 'italic', fontSize: 12.5, color: '#7a7260', marginTop: 6 }}>
            The numbers don&apos;t tell the whole story. But they do tell some good ones...
          </p>
        </div>

        <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#9ca3af', textAlign: 'center', marginBottom: 14 }}>
          {makers.length} Makers found · {breakers.length} Breakers found — tap to choose what to present
        </p>

        {/* Four sections by kind x scope, per the explicit requirement
            — "our whole design depends on having the four balanced
            buckets." Filtered from the same makers/breakers arrays
            already fetched; not a second query or a different data
            shape, just grouped by the scope field every Highlight
            already carries. */}
        <HighlightGroup title="⭐ Individual Makers" items={makers.filter(h => h.scope === 'individual')} selected={selected} onToggle={toggle} />
        <HighlightGroup title="⭐ Group Makers" items={makers.filter(h => h.scope === 'group')} selected={selected} onToggle={toggle} />
        <HighlightGroup title="💀 Individual Breakers" items={breakers.filter(h => h.scope === 'individual')} selected={selected} onToggle={toggle} />
        <HighlightGroup title="💀 Group Breakers" items={breakers.filter(h => h.scope === 'group')} selected={selected} onToggle={toggle} />

        <button
          onClick={() => { setPresentIndex(0); setStage('presenting') }}
          disabled={selected.size === 0}
          style={{
            display: 'block', width: '100%', marginTop: 16, padding: 13, borderRadius: 10,
            background: selected.size === 0 ? '#e5e7eb' : 'linear-gradient(135deg,#2d7a52,#16a34a)',
            color: selected.size === 0 ? '#9ca3af' : '#fff', border: 'none',
            fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14,
            cursor: selected.size === 0 ? 'not-allowed' : 'pointer',
          }}
        >
          Present {selected.size} Highlight{selected.size === 1 ? '' : 's'} →
        </button>
      </div>
    )
  }

  if (stage === 'presenting') {
    const order = buildPresentationOrder()
    const current = order[presentIndex]
    // Reached the end of the presentation order — render the 'done' UI
    // directly here rather than calling setStage during render (a React
    // anti-pattern that can trigger extra re-render warnings). stage
    // itself never needs to become 'done' as a separate value; this
    // condition already fully determines it.
    if (!current) {
      return (
        <div style={{ textAlign: 'center', padding: '32px 16px' }}>
          <div style={{ fontSize: 30, marginBottom: 8 }}>🍻</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 800, color: '#14532d' }}>That&apos;s the Round</div>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 13.5, color: '#7a7260', marginTop: 6, marginBottom: 18 }}>Now for the winners...</p>
          {/* Publish Lifecycle, item 2/3 — the explicit organiser action
              that turns the SELECTED set (makers/breakers filtered by
              `selected`, exactly what buildPresentationOrder already
              shows) into the official, persisted Round story. Never
              publishes every qualifying candidate — only what actually
              made it into this presentation. */}
          {publishState === 'done' ? (
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: '#166534', fontWeight: 700, marginBottom: 14 }}>✅ Published — players can now see their Round Highlights in My Golf</p>
          ) : (
            <>
              <button
                onClick={() => void publish()}
                disabled={publishState === 'publishing'}
                style={{
                  padding: '12px 24px', borderRadius: 10, background: '#a1791f', color: '#fff', border: 'none',
                  fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14, cursor: publishState === 'publishing' ? 'default' : 'pointer',
                  opacity: publishState === 'publishing' ? 0.7 : 1, marginBottom: 10, display: 'block', width: '100%', maxWidth: 280, margin: '0 auto 10px',
                }}
              >
                {publishState === 'publishing' ? 'Publishing…' : 'Finish & Publish'}
              </button>
              {publishError && <p style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: '#dc2626', marginBottom: 10 }}>{publishError}</p>}
            </>
          )}
          <button
            onClick={onProceedToResults}
            style={{ padding: '12px 24px', borderRadius: 10, background: '#14532d', color: '#fff', border: 'none', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
          >
            Present Round Results →
          </button>
        </div>
      )
    }

    return (
      <div style={{
        background: current.kind === 'maker' ? 'linear-gradient(135deg,#14532d,#1a6b3a)' : 'linear-gradient(135deg,#3a1a1a,#5c2626)',
        borderRadius: 18, padding: '32px 22px', textAlign: 'center', minHeight: 320,
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
      }}>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', color: current.kind === 'maker' ? '#e8c96a' : '#f0a8a8' }}>
          {current.kind === 'maker' ? '🔥 Maker' : '💥 Breaker'}
        </div>
        <div style={{ fontSize: 44, margin: '14px 0 6px' }}>{current.icon}</div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 800, color: '#fff', letterSpacing: 0.5 }}>
          {current.title.toUpperCase()}
        </div>
        {/* P0 field-test fix — the archetype's own short, reusable
            explanation, shown right under the title before any
            player-specific detail. Per the exact requested structure:
            title → what the archetype means → who qualified → the
            evidence that qualified them. The organiser (or any player)
            should understand why "Maverick"/"Mailman"/"Iceman" is
            funny or relevant without having to infer it purely from a
            stats line. */}
        {current.definition && (
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 13.5, color: 'rgba(255,255,255,0.85)', marginTop: 8, lineHeight: 1.4, maxWidth: 280, marginLeft: 'auto', marginRight: 'auto' }}>
            {current.definition}
          </div>
        )}
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, color: '#e8c96a', marginTop: 14 }}>
          {current.playerName}
        </div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 15, color: 'rgba(255,255,255,0.9)', marginTop: 6 }}>
          {current.statLine}
        </div>
        {current.caption && (
          <div style={{ fontFamily: 'var(--font-body)', fontStyle: 'italic', fontSize: 13, color: 'rgba(255,255,255,0.65)', marginTop: 10 }}>
            {current.caption}
          </div>
        )}

        <button
          onClick={() => setPresentIndex(i => i + 1)}
          style={{
            marginTop: 28, padding: '11px 24px', borderRadius: 10, background: '#e8c96a', border: 'none',
            fontFamily: 'var(--font-body)', fontWeight: 800, fontSize: 14, color: '#0f2d1c', cursor: 'pointer',
            alignSelf: 'center',
          }}
        >
          {presentIndex === order.length - 1 ? 'Finish →' : 'Next →'}
        </button>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 10 }}>
          {presentIndex + 1} of {order.length}
        </div>
      </div>
    )
  }

  // Every Stage value is handled by a preceding branch above (loading,
  // error, curating, presenting — which itself covers its own "reached
  // the end" case internally) — this is only reachable if stage somehow
  // holds an unexpected value, which TypeScript's control-flow analysis
  // can't fully prove without a switch/exhaustiveness check.
  return null
}

function HighlightGroup({
  title, items, selected, onToggle,
}: { title: string; items: Highlight[]; selected: Set<string>; onToggle: (category: string) => void }) {
  if (items.length === 0) return null
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700, color: '#a1791f', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map(h => {
          const isSelected = selected.has(h.category)
          return (
            <button
              key={h.category}
              onClick={() => onToggle(h.category)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                padding: '9px 12px', borderRadius: 10, cursor: 'pointer',
                background: isSelected ? '#fdf3d9' : '#ffffff',
                border: isSelected ? '1.5px solid #e8c96a' : '1px solid #eceae3',
              }}
            >
              <span style={{ fontSize: 18 }}>{h.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, color: '#1a1a16' }}>{h.title} — {h.playerName}</div>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: '#7a7260' }}>{h.statLine}</div>
              </div>
              <span style={{ fontSize: 16, flexShrink: 0 }}>{isSelected ? '✅' : '⬜'}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
