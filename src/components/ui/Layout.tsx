import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

export function Card({ children, className, padding = 'md' }: {
  children: ReactNode; className?: string; padding?: 'sm' | 'md' | 'lg'
}) {
  return (
    <div className={cn(
      'bg-white rounded-2xl shadow-card',
      padding === 'sm' && 'p-3',
      padding === 'md' && 'p-4',
      padding === 'lg' && 'p-6',
      className,
    )}>
      {children}
    </div>
  )
}

export function SectionHeader({ title, subtitle, action }: {
  title: string; subtitle?: string; action?: ReactNode
}) {
  return (
    <div className="flex items-start justify-between mb-3">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted">{title}</h2>
        {subtitle && <p className="text-xs text-text-subtle mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full', className)}>
      {children}
    </span>
  )
}

export function EmptyState({ icon = '⛳', title, description, action }: {
  icon?: string; title: string; description?: string; action?: ReactNode
}) {
  return (
    <div className="text-center py-10 px-4">
      <p className="text-4xl mb-3">{icon}</p>
      <h3 className="font-semibold text-text mb-1">{title}</h3>
      {description && <p className="text-sm text-text-muted mb-4 max-w-xs mx-auto">{description}</p>}
      {action}
    </div>
  )
}
