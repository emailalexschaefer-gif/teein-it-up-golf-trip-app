// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, formatDistanceToNow, parseISO, isAfter, isBefore, isToday } from 'date-fns'

// ─── className helper ─────────────────────────────────────────────────────────

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

export function formatTripDate(dateStr: string): string {
  return format(parseISO(dateStr), 'd MMM yyyy')
}

export function formatTripDateRange(startStr: string, endStr: string): string {
  const start = parseISO(startStr)
  const end = parseISO(endStr)

  if (start.getFullYear() === end.getFullYear()) {
    if (start.getMonth() === end.getMonth()) {
      return `${format(start, 'd')}–${format(end, 'd MMM yyyy')}`
    }
    return `${format(start, 'd MMM')} – ${format(end, 'd MMM yyyy')}`
  }
  return `${format(start, 'd MMM yyyy')} – ${format(end, 'd MMM yyyy')}`
}

export function formatRelativeTime(dateStr: string): string {
  return formatDistanceToNow(parseISO(dateStr), { addSuffix: true })
}

export function isTripActive(startDate: string, endDate: string): boolean {
  const now = new Date()
  const start = parseISO(startDate)
  const end = parseISO(endDate)
  return !isBefore(now, start) && !isAfter(now, end)
}

export function isTripUpcoming(startDate: string): boolean {
  return isAfter(parseISO(startDate), new Date())
}

export function isTripPast(endDate: string): boolean {
  return isBefore(parseISO(endDate), new Date())
}

// ─── String helpers ───────────────────────────────────────────────────────────

export function generateInviteCode(): string {
  // 6-character alphanumeric, uppercase
  // Note: server-side generation is preferred (DB function).
  // This is a client-side fallback for optimistic UI only.
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // exclude ambiguous chars
  return Array.from({ length: 6 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join('')
}

export function generateUUID(): string {
  // Used for client_id on offline score entries
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  // Fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export function truncate(str: string, length: number): string {
  if (str.length <= length) return str
  return str.slice(0, length) + '…'
}

export function initials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

// ─── Number helpers ───────────────────────────────────────────────────────────

export function formatHandicap(handicap: number | null): string {
  if (handicap === null) return '—'
  return handicap >= 0 ? `+${handicap}` : `${handicap}`
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}
