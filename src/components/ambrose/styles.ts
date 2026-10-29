import type React from 'react'
// Shared inline styles for the Ambrose screens (same visual language as the existing scoring cards; A-grade polish comes later).
export const GREEN = '#14532d'
export const card: React.CSSProperties = { background: '#ffffff', border: '1px solid #eceae3', borderRadius: 14, padding: 16, marginBottom: 16 }
export const h2: React.CSSProperties = { fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 800, color: GREEN, margin: '0 0 4px' }
export const body: React.CSSProperties = { fontFamily: 'var(--font-body)', fontSize: 13, color: '#6b6b60', margin: 0, lineHeight: 1.45 }
export const btn: React.CSSProperties = { minHeight: 44, padding: '0 16px', borderRadius: 10, fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14, cursor: 'pointer' }
export const btnPrimary: React.CSSProperties = { ...btn, border: 'none', background: GREEN, color: '#fff' }
export const btnOutline: React.CSSProperties = { ...btn, border: `1.5px solid ${GREEN}`, background: '#fff', color: GREEN }
export const SHADES = [
  { bg: '#e8f3ec', fg: '#14532d', border: '#b7d9c3' },
  { bg: '#eef2fb', fg: '#1e3a8a', border: '#c3cff0' },
]
