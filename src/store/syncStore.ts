// ─────────────────────────────────────────────────────────────────────────────
// SYNC STORE — Offline queue status
// Drives the sync status indicator shown to players during scoring.
// ─────────────────────────────────────────────────────────────────────────────

import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

type SyncState = 'idle' | 'syncing' | 'synced' | 'error'

interface SyncStoreState {
  // Current sync state
  syncState: SyncState
  pendingCount: number
  lastSyncAt: string | null
  errorMessage: string | null

  // Actions
  setSyncing: (value: boolean) => void
  setSyncComplete: () => void
  setSyncError: (message: string) => void
  setPendingCount: (count: number) => void
  clearError: () => void
}

export const useSyncStore = create<SyncStoreState>()(
  devtools(
    (set) => ({
      syncState: 'idle',
      pendingCount: 0,
      lastSyncAt: null,
      errorMessage: null,

      setSyncing: (value) =>
        set(
          { syncState: value ? 'syncing' : 'idle', errorMessage: null },
          false,
          'setSyncing'
        ),

      setSyncComplete: () =>
        set(
          {
            syncState: 'synced',
            pendingCount: 0,
            lastSyncAt: new Date().toISOString(),
            errorMessage: null,
          },
          false,
          'setSyncComplete'
        ),

      setSyncError: (message) =>
        set({ syncState: 'error', errorMessage: message }, false, 'setSyncError'),

      setPendingCount: (count) =>
        set({ pendingCount: count }, false, 'setPendingCount'),

      clearError: () =>
        set({ errorMessage: null, syncState: 'idle' }, false, 'clearError'),
    }),
    { name: 'SyncStore' }
  )
)

// ─── Selectors ────────────────────────────────────────────────────────────────

export const selectHasPendingScores = (state: SyncStoreState) =>
  state.pendingCount > 0

export const selectSyncLabel = (state: SyncStoreState): string => {
  switch (state.syncState) {
    case 'syncing': return 'Saving...'
    case 'synced':  return 'All scores saved'
    case 'error':   return `${state.pendingCount} score(s) pending`
    default:        return state.pendingCount > 0
                      ? `${state.pendingCount} score(s) pending`
                      : 'All scores saved'
  }
}
