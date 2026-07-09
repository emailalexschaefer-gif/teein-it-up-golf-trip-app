'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
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
  expected_players: 0, players_per_group: 4, organiser_is_playing: false,
})

const defaultRound = (startDate = ''): WizardRound => ({
  id: generateUUID(), name: 'Round 1', course_name: '',
  play_date: startDate, tee_time: '', holes: 18, scoring_format: 'stableford',
})

function NewTripForm() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const createTrip   = useCreateTrip()

  // Pre-fill from query params when editing — these are URL-encoded JSON
  const prefill = searchParams.get('prefill')
  const parsed  = prefill ? (() => { try { return JSON.parse(decodeURIComponent(prefill)) } catch { return null } })() : null

  const [step, setStep]     = useState(1)
  const [details, setDet]   = useState<WizardTripDetails>(parsed?.details ?? defaultDetails())
  const [rounds, setRounds] = useState<WizardRound[]>(parsed?.rounds ?? [defaultRound()])
  const [error, setError]   = useState<string | null>(null)

  // If editing an existing trip
  const editingTripId: string | null = searchParams.get('editTripId')
  const isEditing = !!editingTripId

  function handleDetailsChange(d: WizardTripDetails) {
    setDet(d)
    if (d.start_date && rounds[0].play_date === '' && !isEditing) {
      setRounds(rounds.map((r, i) => i === 0 ? { ...r, play_date: d.start_date } : r))
    }
  }

  async function handleCreate() {
    setError(null)
    try {
      if (isEditing) {
        // PATCH existing trip
        const res = await fetch(`/api/trips/${editingTripId}`, {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            ...details,
            rounds: rounds.map((r) => ({
              name: r.name, course_name: r.course_name, play_date: r.play_date,
              tee_time: r.tee_time, holes: r.holes, scoring_format: r.scoring_format,
            })),
          }),
        })
        if (!res.ok) {
          const d = await res.json().catch(() => ({}))
          throw new Error(d.error ?? 'Failed to update trip')
        }
        router.push(`/trips/${editingTripId}`)
        return
      }

      const { tripId } = await createTrip.mutateAsync({
        name:                 details.name,
        event_type:           details.event_type,
        location:             details.location,
        start_date:           details.start_date,
        end_date:             details.end_date,
        description:          details.description,
        expected_players:     details.expected_players,
        players_per_group:    details.players_per_group,
        organiser_is_playing: details.organiser_is_playing,
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
        <a href={isEditing ? `/trips/${editingTripId}` : '/dashboard'}
          className="inline-flex items-center text-sm text-text-muted hover:text-brand-600 transition-colors mb-2">
          ← {isEditing ? 'Back to trip' : 'My Trips'}
        </a>
        <h1 className="text-2xl font-bold text-text">
          {isEditing ? 'Edit trip' : 'Create a trip'}
        </h1>
      </div>

      <StepIndicator current={step} steps={STEPS} />

      {step === 1 && (
        <StepDetails data={details} onChange={handleDetailsChange} onNext={() => setStep(2)} />
      )}
      {step === 2 && (
        <StepRounds
          tripDetails={details} rounds={rounds} onChange={setRounds}
          onNext={() => setStep(3)} onBack={() => setStep(1)}
        />
      )}
      {step === 3 && (
        <StepReview
          tripDetails={details} rounds={rounds}
          onBack={() => setStep(2)} onCreate={handleCreate}
          loading={createTrip.isPending} error={error}
          isEditing={isEditing}
        />
      )}
    </div>
  )
}

export default function NewTripPage() {
  return (
    <Suspense fallback={<div className="py-12 text-center text-text-muted text-sm">Loading…</div>}>
      <NewTripForm />
    </Suspense>
  )
}
