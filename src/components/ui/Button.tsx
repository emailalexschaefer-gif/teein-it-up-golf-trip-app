import { cn } from '@/lib/utils'
import type { ButtonHTMLAttributes } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  fullWidth?: boolean
}

export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  disabled,
  children,
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center font-semibold rounded-xl transition-colors',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        // Sizes
        size === 'sm' && 'text-xs px-3 py-2',
        size === 'md' && 'text-sm px-4 py-3',
        size === 'lg' && 'text-base px-6 py-3.5',
        // Variants
        variant === 'primary'   && 'bg-brand-600 text-white hover:bg-brand-700',
        variant === 'secondary' && 'bg-surface-subtle text-text hover:bg-surface',
        variant === 'ghost'     && 'bg-transparent text-text-muted hover:text-brand-600 hover:bg-brand-50',
        variant === 'danger'    && 'bg-red-50 text-red-600 hover:bg-red-100',
        // Width
        fullWidth && 'w-full',
        className,
      )}
      {...props}
    >
      {loading ? (
        <span className="flex items-center gap-2">
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
          {children}
        </span>
      ) : children}
    </button>
  )
}
