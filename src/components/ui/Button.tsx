'use client'

import React, { type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'gold'
type Size    = 'sm' | 'md' | 'lg'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?:   Variant
  size?:      Size
  loading?:   boolean
  fullWidth?: boolean
  icon?:      React.ReactNode
  children?:  React.ReactNode
}

const BASE = [
  'inline-flex items-center justify-center gap-2',
  'font-semibold rounded-xl transition-all duration-150',
  'disabled:opacity-50 disabled:cursor-not-allowed',
  'active:scale-95',
].join(' ')

const VARIANTS: Record<Variant, string> = {
  primary:   'bg-green text-white hover:bg-green-bright shadow-green',
  secondary: 'bg-ivory text-ink border border-parchment-dark hover:bg-cream',
  outline:   'bg-transparent text-green border-2 border-green hover:bg-green hover:text-white',
  ghost:     'bg-transparent text-ink-light hover:text-green hover:bg-cream',
  danger:    'bg-red-50 text-red-700 border border-red-200 hover:bg-red-100',
  gold:      'text-green-deep border-none shadow-gold',
}

const SIZES: Record<Size, string> = {
  sm: 'text-xs px-3 py-2 h-8',
  md: 'text-sm px-4 py-2.5 h-10',
  lg: 'text-base px-6 py-3.5 h-12 tracking-wide',
}

export default function Button({
  variant = 'primary', size = 'md', loading = false,
  fullWidth = false, disabled, children, className, icon, ...props
}: Props) {
  const isGold = variant === 'gold'
  return (
    <button
      disabled={disabled || loading}
      className={cn(
        BASE,
        VARIANTS[variant as Variant],
        SIZES[size as Size],
        fullWidth && 'w-full',
        className,
      )}
      style={
        isGold ? { background: 'linear-gradient(135deg, #c9a84c 0%, #e8c96a 50%, #c9a84c 100%)' }
        : variant === 'primary' ? { background: 'linear-gradient(160deg, #2d7a52 0%, #1a4731 100%)' }
        : {}
      }
      {...props}
    >
      {loading ? (
        <>
          <svg className="animate-spin h-4 w-4 flex-shrink-0" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
          {children}
        </>
      ) : (
        <>
          {icon && <span className="flex-shrink-0">{icon}</span>}
          {children}
        </>
      )}
    </button>
  )
}
