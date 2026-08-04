import { create } from 'zustand'

interface ScoringFocusState {
  isActive: boolean
  setActive: (active: boolean) => void
}

/**
 * Signals whether the app is currently in "scoring focus mode" — active
 * hole-entry, as opposed to Round Summary or any other screen. AppNav and
 * TripBottomNav subscribe to this and render nothing while active, so the
 * scoring workspace gets the full screen. This is a plain boolean flag,
 * not route-based, because active-scoring vs. Round Summary are two
 * client-side states within the *same* route/component, not two
 * different URLs — there's no pathname to key off of.
 */
export const useScoringFocusStore = create<ScoringFocusState>((set) => ({
  isActive: false,
  setActive: (active) => set({ isActive: active }),
}))
