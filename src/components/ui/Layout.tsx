import { cn } from '@/lib/utils'

interface CardProps {
  children: React.ReactNode
  className?: string
  padding?: 'sm' | 'md' | 'lg'
}

export function Card({ children, className, padding = 'md' }: CardProps) {
  return (
    <div
      className={cn(
        'bg-white rounded-2xl shadow-card',
        padding === 'sm' && 'p-3',
        padding === 'md' && 'p-4',
        padding === 'lg' && 'p-6',
        className,
      )}
    >
      {children}
    </div>
  )
}

interface SectionHeaderProps {
  title: string
  subtitle?: string
  action?: React.ReactNode
}

export function SectionHeader({ title, subtitle, action }: SectionHeaderProps) {
  return (
    <div className="flex items-start justify-between mb-3">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-text-muted">
          {title}
        </h2>
        {subtitle && <p className="text-xs text-text-subtle mt-0.5">{subtitle}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
  )
}

interface BadgeProps {
  children: React.ReactNode
  className?: string
}

export function Badge({ children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full',
        className,
      )}
    >
      {children}
    </span>
  )
}

interface EmptyStateProps {
  icon?: string
  title: string
  description?: string
  action?: React.ReactNode
}

export function EmptyState({ icon = '⛳', title, description, action }: EmptyStateProps) {
  return (
    <div className="text-center py-10 px-4">
      <p className="text-4xl mb-3">{icon}</p>
      <h3 className="font-semibold text-text mb-1">{title}</h3>
      {description && <p className="text-sm text-text-muted mb-4 max-w-xs mx-auto">{description}</p>}
      {action}
    </div>
  )
}

interface PageHeaderProps {
  back?: { href: string; label: string }
  title: string
  subtitle?: string
  action?: React.ReactNode
}

export function PageHeader({ back, title, subtitle, action }: PageHeaderProps) {
  return (
    <div className="mb-6">
      {back && (
        <a
          href={back.href}
          className="inline-flex items-center text-sm text-text-muted hover:text-brand-600 transition-colors mb-2"
        >
          ← {back.label}
        </a>
      )}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text">{title}</h1>
          {subtitle && <p className="text-text-muted text-sm mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
    </div>
  )
}
