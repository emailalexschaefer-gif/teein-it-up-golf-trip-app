import { cn } from '@/lib/utils'
import { type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes, forwardRef } from 'react'

// ─── Shared field wrapper ─────────────────────────────────────────────────────

interface FieldProps {
  label: string
  error?: string
  hint?: string
  required?: boolean
  children: React.ReactNode
}

export function Field({ label, error, hint, required, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-text">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-text-subtle">{hint}</p>}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}

// ─── Input ────────────────────────────────────────────────────────────────────

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ error, className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'w-full rounded-xl border px-4 py-3 text-sm bg-white',
        'focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-transparent',
        'placeholder:text-text-subtle',
        error
          ? 'border-red-300 focus:ring-red-400'
          : 'border-surface-subtle',
        className,
      )}
      {...props}
    />
  )
)
Input.displayName = 'Input'

// ─── Select ───────────────────────────────────────────────────────────────────

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ error, className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'w-full rounded-xl border px-4 py-3 text-sm bg-white appearance-none',
        'focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-transparent',
        error
          ? 'border-red-300 focus:ring-red-400'
          : 'border-surface-subtle',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  )
)
Select.displayName = 'Select'

// ─── Textarea ─────────────────────────────────────────────────────────────────

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ error, className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'w-full rounded-xl border px-4 py-3 text-sm bg-white resize-none',
        'focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-transparent',
        'placeholder:text-text-subtle',
        error
          ? 'border-red-300 focus:ring-red-400'
          : 'border-surface-subtle',
        className,
      )}
      {...props}
    />
  )
)
Textarea.displayName = 'Textarea'
