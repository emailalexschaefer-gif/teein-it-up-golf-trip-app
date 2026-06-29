import { cn } from '@/lib/utils'
import { type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes, forwardRef } from 'react'

export function Field({ label, error, hint, required, children }: {
  label: string; error?: string; hint?: string; required?: boolean; children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-text">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-text-subtle">{hint}</p>}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}

const baseInput = 'w-full rounded-xl border px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-transparent placeholder:text-text-subtle border-surface-subtle'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { error?: boolean }>(
  ({ error, className, ...props }, ref) => (
    <input ref={ref} className={cn(baseInput, error && 'border-red-300', className)} {...props} />
  )
)
Input.displayName = 'Input'

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { error?: boolean }>(
  ({ error, className, children, ...props }, ref) => (
    <select ref={ref} className={cn(baseInput, 'appearance-none', error && 'border-red-300', className)} {...props}>
      {children}
    </select>
  )
)
Select.displayName = 'Select'

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { error?: boolean }>(
  ({ error, className, ...props }, ref) => (
    <textarea ref={ref} className={cn(baseInput, 'resize-none', error && 'border-red-300', className)} {...props} />
  )
)
Textarea.displayName = 'Textarea'
