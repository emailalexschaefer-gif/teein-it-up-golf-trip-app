'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import StepIndicator from '@/components/trips/wizard/StepIndicator'
import StepDetails   from '@/components/trips/wizard/StepDetails'
import StepRounds    from '@/components/trips/wizard/StepRounds'
import StepReview    from '@/components/trips/wizard/StepReview'
import { useCreateTrip } from '@/lib/queries/trips'
import { generateUUID } from '@/lib/utils'
import type { WizardTripDetails, WizardRound } from '@/types/app'

const STEPS = ['Details', 'Rounds', 'Review']

const defaultDetails = (): WizardTripDetails => ({
  name: '', event_type: 'golf_trip', location: '',
  start_date: '', end_date: '', description: '',
})

const defaultRound = (startDate = ''): WizardRound => ({
  id: generateUUID(), name: 'Round 1', course_name: '',
  play_date: startDate, tee_time: '', holes: 18, scoring_format: 'stableford',
})

export default function NewTripPage() {
  const router     = useRouter()
  const createTrip = useCreateTrip()

  const [step, setStep]             = useState(1)
  const [tripDetails, setDetails]   = useState<WizardTripDetails>(defaultDetails())
  const [rounds, setRounds]         = useState<WizardRound[]>([defaultRound()])
  const [error, setError]           = useState<string | null>(null)

  function handleDetailsChange(d: WizardTripDetails) {
    setDetails(d)
    if (d.start_date && !rounds[0].play_date) {
      setRounds(rounds.map((r, i) => i === 0 ? { ...r, play_date: d.start_date } : r))
    }
  }

  async function handleCreate() {
    setError(null)
    try {
      const { tripId } = await createTrip.mutateAsync({
        name:        tripDetails.name,
        event_type:  tripDetails.event_type,
        location:    tripDetails.location,
        start_date:  tripDetails.start_date,
        end_date:    tripDetails.end_date,
        description: tripDetails.description,
        rounds: rounds.map((r) => ({
          name: r.name, course_name: r.course_name, play_date: r.play_date,
          tee_time: r.tee_time, holes: r.holes, scoring_format: r.scoring_format,
        })),
      })
      router.push(`/trips/${tripId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    }
  }

  return (
    <div>
      <div className="mb-6">
        <a href="/dashboard" className="inline-flex items-center text-sm text-text-muted hover:text-brand-600 transition-colors mb-2">
          ← My Trips
        </a>
        <h1 className="text-2xl font-bold text-text">Create a trip</h1>
      </div>

      <StepIndicator current={step} steps={STEPS} />

      {step === 1 && (
        <StepDetails data={tripDetails} onChange={handleDetailsChange} onNext={() => setStep(2)} />
      )}
      {step === 2 && (
        <StepRounds
          tripDetails={tripDetails} rounds={rounds} onChange={setRounds}
          onNext={() => setStep(3)} onBack={() => setStep(1)}
        />
      )}
      {step === 3 && (
        <StepReview
          tripDetails={tripDetails} rounds={rounds}
          onBack={() => setStep(2)} onCreate={handleCreate}
          loading={createTrip.isPending} error={error}
        />
      )}
    </div>
  )
}
