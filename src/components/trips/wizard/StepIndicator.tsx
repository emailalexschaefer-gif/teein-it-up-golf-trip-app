interface StepIndicatorProps {
  currentStep: 1 | 2 | 3
  steps: string[]
}

export default function StepIndicator({ currentStep, steps }: StepIndicatorProps) {
  return (
    <div className="flex items-center gap-0 mb-6">
      {steps.map((label, index) => {
        const stepNum = index + 1
        const isComplete = stepNum < currentStep
        const isActive   = stepNum === currentStep

        return (
          <div key={stepNum} className="flex items-center flex-1 last:flex-none">
            {/* Circle */}
            <div className="flex flex-col items-center">
              <div
                className={[
                  'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors',
                  isComplete ? 'bg-brand-600 text-white' :
                  isActive   ? 'bg-brand-600 text-white ring-4 ring-brand-100' :
                               'bg-surface-subtle text-text-muted',
                ].join(' ')}
              >
                {isComplete ? '✓' : stepNum}
              </div>
              <span
                className={[
                  'text-xs mt-1 hidden sm:block',
                  isActive ? 'text-brand-600 font-medium' : 'text-text-muted',
                ].join(' ')}
              >
                {label}
              </span>
            </div>

            {/* Connector line */}
            {index < steps.length - 1 && (
              <div
                className={[
                  'flex-1 h-0.5 mx-1 mb-3 sm:mb-4',
                  isComplete ? 'bg-brand-600' : 'bg-surface-subtle',
                ].join(' ')}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
