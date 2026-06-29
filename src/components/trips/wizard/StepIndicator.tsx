export default function StepIndicator({ current, steps }: { current: number; steps: string[] }) {
  return (
    <div className="flex items-center mb-6">
      {steps.map((label, i) => {
        const n = i + 1
        const done   = n < current
        const active = n === current
        return (
          <div key={n} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center">
              <div className={[
                'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors',
                done   ? 'bg-brand-600 text-white' :
                active ? 'bg-brand-600 text-white ring-4 ring-brand-100' :
                         'bg-surface-subtle text-text-muted',
              ].join(' ')}>
                {done ? '✓' : n}
              </div>
              <span className={[
                'text-xs mt-1 hidden sm:block',
                active ? 'text-brand-600 font-medium' : 'text-text-muted',
              ].join(' ')}>
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={[
                'flex-1 h-0.5 mx-1 mb-3',
                done ? 'bg-brand-600' : 'bg-surface-subtle',
              ].join(' ')} />
            )}
          </div>
        )
      })}
    </div>
  )
}
