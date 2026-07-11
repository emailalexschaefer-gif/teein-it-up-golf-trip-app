import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

type SyncState = 'idle' | 'syncing' | 'synced' | 'error'

interface SyncStoreState {
  syncState: SyncState
  pendingCount: number
  lastSyncAt: string | null
  errorMessage: string | null
  setSyncing: (v: boolean) => void
  setSyncComplete: () => void
  setSyncError: (msg: string) => void
  setPendingCount: (n: number) => void
  clearError: () => void
}

type SetFn = (partial: Partial<SyncStoreState>) => void

export const useSyncStore = create<SyncStoreState>()(
  devtools(
    (set: SetFn) => ({
      syncState:    'idle' as SyncState,
      pendingCount: 0,
      lastSyncAt:   null,
      errorMessage: null,
      setSyncing:      (v: boolean) => set({ syncState: v ? 'syncing' : 'idle', errorMessage: null }),
      setSyncComplete: ()           => set({ syncState: 'synced', pendingCount: 0, lastSyncAt: new Date().toISOString() }),
      setSyncError:    (msg: string)=> set({ syncState: 'error', errorMessage: msg }),
      setPendingCount: (n: number)  => set({ pendingCount: n }),
      clearError:      ()           => set({ errorMessage: null, syncState: 'idle' }),
    }),
    { name: 'SyncStore' }
  )
)

export const selectSyncLabel = (s: SyncStoreState): string => {
  if (s.syncState === 'syncing') return 'Saving…'
  if (s.pendingCount > 0)       return `${s.pendingCount} score(s) pending`
  return 'All scores saved'
}
