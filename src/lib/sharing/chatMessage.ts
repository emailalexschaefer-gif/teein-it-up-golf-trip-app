// Release 3S -- the automatic Event Chat post. The card is rendered from the
// message text itself so the existing chat table and permission model are
// unchanged (an ordinary organiser announcement to everyone).
import { SHARE_TOKEN_LENGTH } from './token'

export const CHAT_TITLE = 'Relive the memories! ⛳🏆'
export const CHAT_CTA = 'Watch our Event Presentation'

export function sharePath(token: string): string { return `/s/${token}` }

export function buildPresentationChatMessage(eventName: string, publicUrl: string): string {
  return `${CHAT_TITLE}\nWhat a great event! Revisit the highlights, winners, laughs and unforgettable Moments from the ${eventName}.\n${CHAT_CTA}\n${publicUrl}`
}

export interface ParsedPresentationMessage { title: string; body: string; token: string; url: string }

const URL_RE = new RegExp(`(https?://[^\\s]+)?/s/([A-Za-z0-9_-]{${SHARE_TOKEN_LENGTH}})(?![A-Za-z0-9_-])`)

/** Returns null unless the text is exactly an automatic presentation post. */
export function parsePresentationChatMessage(text: string): ParsedPresentationMessage | null {
  const lines = text.split('\n')
  if (lines.length < 4 || lines[0] !== CHAT_TITLE || lines[2] !== CHAT_CTA) return null
  const m = URL_RE.exec(lines[3] ?? '')
  if (!m) return null
  return { title: lines[0], body: lines[1], token: m[2], url: m[0] }
}
