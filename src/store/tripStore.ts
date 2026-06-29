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

export const useTripStore = create<TripState>()(
  devtools(
    (set) => ({
      activeTripId:  null,
      activeRoundId: null,
      userRole:      null,
      setActiveTrip:  (tripId, role) => set({ activeTripId: tripId, userRole: role, activeRoundId: null }),
      setActiveRound: (roundId)      => set({ activeRoundId: roundId }),
      clearActiveTrip: ()            => set({ activeTripId: null, activeRoundId: null, userRole: null }),
    }),
    { name: 'TripStore' }
  )
)
