'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { parsePresentationChatMessage, sharePath } from '@/lib/sharing/chatMessage'

// Release 3S -- branded card for the automatic "Relive the memories!" post.
// Static artwork only (never a participant photo). "Watch" opens the member
// presentation inside the event; "Copy Link" copies the public share link.
export default function PresentationCard({ tripId, message }: { tripId: string; message: string }) {
  const parsed = parsePresentationChatMessage(message)
  const { data: status } = useQuery<{ published: boolean; publicEnabled?: boolean }>({
    queryKey: ['share-presentation-status', tripId],
    queryFn: async () => {
      const res = await fetch(`/api/trips/${tripId}/share-presentation`, { cache: 'no-store' })
      return res.ok ? res.json() : { published: false }
    },
    // Always read the CURRENT publication state (never the message text), so Copy Link
    // appears/disappears when the organiser switches public sharing on/off. Refetches on
    // mount and focus, and every 15 s while the card is visible (paused in background tabs).
    staleTime: 0,
    refetchInterval: 15000,
  })
  const [copied, setCopied] = useState(false)
  if (!parsed) return null
  const eventName = /from the (.*)\.$/.exec(parsed.body)?.[1] ?? 'our event'

  const copy = async () => {
    const url = /^https?:\/\//.test(parsed.url) ? parsed.url : `${window.location.origin}${sharePath(parsed.token)}`
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000) }
    catch { window.prompt('Copy this link', url) }
  }

  return (
    <div style={{ background: '#0f2d1c', color: '#faf6ed', borderRadius: 14, overflow: 'hidden', border: '1.5px solid #c9a84c' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/logo-new-720.png" alt="" width={96} height={96} style={{ width: 96, height: 'auto', display: 'block', margin: '14px auto 0' }} />
      <div style={{ padding: '10px 14px 14px', textAlign: 'center' }}>
        <p style={{ fontFamily: 'var(--font-display)', fontSize: 20, margin: '0 0 4px' }}>{parsed.title}</p>
        <p style={{ fontSize: 13, opacity: 0.9, margin: '0 0 12px' }}>{parsed.body}</p>
        <p style={{ fontSize: 11, color: '#c9a84c', textTransform: 'uppercase', letterSpacing: 1, margin: '0 0 10px' }}>{eventName}</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href={`/trips/${tripId}/presentation`} style={{ minHeight: 48, display: 'inline-flex', alignItems: 'center', padding: '0 18px', borderRadius: 12, background: '#c9a84c', color: '#0f2d1c', fontWeight: 700, textDecoration: 'none' }}>
            Watch Presentation
          </Link>
          {status?.publicEnabled === true && <button onClick={copy} style={{ minHeight: 48, padding: '0 18px', borderRadius: 12, border: '1px solid #c9a84c', background: 'transparent', color: '#faf6ed', fontSize: 15, cursor: 'pointer' }}>
            {copied ? 'Copied!' : 'Copy Link'}
          </button>}
        </div>
      </div>
    </div>
  )
}
