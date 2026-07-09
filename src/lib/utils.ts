import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, parseISO, formatDistanceToNow } from 'date-fns'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ─── App URL — NO env var required ───────────────────────────────────────────
// Derive the app origin from the browser or Vercel's automatic env vars.
// This avoids needing a NEXT_PUBLIC_APP_URL environment variable entirely.

export function getAppUrl(): string {
  if (typeof window !== 'undefined') {
    return window.location.origin
  }
  // Vercel sets these automatically — no manual configuration needed
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`
  }
  return 'http://localhost:3000'
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

export function formatTripDate(dateStr: string): string {
  return format(parseISO(dateStr), 'd MMM yyyy')
}

export function formatTripDateRange(startStr: string, endStr: string): string {
  const start = parseISO(startStr)
  const end   = parseISO(endStr)
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

// ─── String helpers ───────────────────────────────────────────────────────────

export function initials(name: string): string {
  return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
}

export function truncate(str: string, len: number): string {
  return str.length <= len ? str : str.slice(0, len) + '…'
}

export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

export function formatHandicap(handicap: number | null): string {
  if (handicap === null) return '—'
  return handicap >= 0 ? `+${handicap}` : `${handicap}`
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

// ─── Avatar color ─────────────────────────────────────────────────────────────
// Deterministic color from a string — matches the demo's colored player circles

const AVATAR_COLORS = [
  '#1C6B38', // forest green
  '#C0392B', // red
  '#7D3C98', // purple  
  '#2471A3', // blue
  '#B7770D', // amber
  '#0E6655', // teal
  '#884EA0', // violet
  '#1A5276', // navy
  '#B03A2E', // dark red
  '#196F3D', // dark green
]

export function avatarColor(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash)
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}
