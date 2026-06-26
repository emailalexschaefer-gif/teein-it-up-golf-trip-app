// ─────────────────────────────────────────────────────────────────────────────
// TRIP STORE — Active trip context
// Holds the currently active trip, round, and the user's role.
// ─────────────────────────────────────────────────────────────────────────────

import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type { TripRole } from '@/types/database'

interface TripState {
  // Active context
  activeTripId: string | null
  activeRoundId: string | null
  activeHoleNumber: number | null

  // User's role on the active trip (trip-scoped)
  userRole: TripRole | null

  // Actions
  setActiveTrip: (tripId: string, role: TripRole) => void
  setActiveRound: (roundId: string) => void
  setActiveHole: (holeNumber: number) => void
  clearActiveTrip: () => void
}

export const useTripStore = create<TripState>()(
  devtools(
    (set) => ({
      activeTripId: null,
      activeRoundId: null,
      activeHoleNumber: null,
      userRole: null,

      setActiveTrip: (tripId, role) =>
        set(
          { activeTripId: tripId, userRole: role, activeRoundId: null, activeHoleNumber: null },
          false,
          'setActiveTrip'
        ),

      setActiveRound: (roundId) =>
        set({ activeRoundId: roundId, activeHoleNumber: 1 }, false, 'setActiveRound'),

      setActiveHole: (holeNumber) =>
        set({ activeHoleNumber: holeNumber }, false, 'setActiveHole'),

      clearActiveTrip: () =>
        set(
          { activeTripId: null, activeRoundId: null, activeHoleNumber: null, userRole: null },
          false,
          'clearActiveTrip'
        ),
    }),
    { name: 'TripStore' }
  )
)

// ─── Selectors ────────────────────────────────────────────────────────────────

export const selectIsOrganiser = (state: TripState) =>
  state.userRole === 'organiser'
