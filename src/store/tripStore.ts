import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type { TripRole } from '@/types/database'

interface TripState {
  activeTripId: string | null
  activeRoundId: string | null
  userRole: TripRole | null
  setActiveTrip: (tripId: string, role: TripRole) => void
  setActiveRound: (roundId: string) => void
  clearActiveTrip: () => void
}

type SetFn = (partial: Partial<TripState>) => void

export const useTripStore = create<TripState>()(
  devtools(
    (set: SetFn) => ({
      activeTripId:  null,
      activeRoundId: null,
      userRole:      null,
      setActiveTrip:   (tripId: string, role: TripRole) => set({ activeTripId: tripId, userRole: role, activeRoundId: null }),
      setActiveRound:  (roundId: string)                => set({ activeRoundId: roundId }),
      clearActiveTrip: ()                               => set({ activeTripId: null, activeRoundId: null, userRole: null }),
    }),
    { name: 'TripStore' }
  )
)
