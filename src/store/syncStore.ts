import { create } from 'zustand'
import type { OfflineScoreEntry } from '@/types/app'
import type { SyncPhase, FailureKind } from '@/lib/db/syncStatus'

export interface SyncStoreState {
  syncState:    SyncPhase
  /** Everything still owed to the server: pending, failed-but-retrying and in-flight. */
  pendingCount: number
  lastSyncAt:   string | null
  errorMessage: string | null
  /** Why the most recent failed pass failed — drives the player-facing wording. */
  lastFailure:  FailureKind | null
  /** Browser's own online flag. Necessary but NOT sufficient: a phone can say
   * "online" with no usable connection, which is why lastFailure also exists. */
  online:       boolean
  /** Entries the server permanently refused. Kept on the device. */
  rejectedCount:   number
  rejectedEntries: OfflineScoreEntry[]
  setSyncing:      (v: boolean)  => void
  setSyncComplete: ()            => void
  setSyncError:    (msg: string, kind?: FailureKind) => void
  setPendingCount: (n: number)   => void
  setOnline:       (v: boolean)  => void
  setRejected:     (entries: OfflineScoreEntry[]) => void
  setRejectedCount:(n: number)   => void
  clearError:      ()            => void
}

// Explicit set signature that satisfies Zustand v5 strict mode
type Setter = (partial: Partial<SyncStoreState> | ((s: SyncStoreState) => Partial<SyncStoreState>)) => void

export const useSyncStore = create<SyncStoreState>()((set: Setter) => ({
  syncState:    'idle' as SyncPhase,
  pendingCount: 0,
  lastSyncAt:   null,
  errorMessage: null,
  lastFailure:  null,
  online:       true,
  rejectedCount:   0,
  rejectedEntries: [],
  setSyncing:      (v: boolean)  => set({ syncState: v ? 'syncing' : 'idle', errorMessage: null }),
  setSyncComplete: ()            => set({ syncState: 'synced', pendingCount: 0, lastSyncAt: new Date().toISOString(), lastFailure: null, errorMessage: null }),
  setSyncError:    (msg: string, kind?: FailureKind) => set({ syncState: 'error', errorMessage: msg, lastFailure: kind ?? 'server' }),
  setPendingCount: (n: number)   => set({ pendingCount: n }),
  setOnline:       (v: boolean)  => set({ online: v }),
  setRejected:     (entries: OfflineScoreEntry[]) => set({ rejectedEntries: entries, rejectedCount: entries.length }),
  setRejectedCount:(n: number)   => set({ rejectedCount: n }),
  clearError:      ()            => set({ errorMessage: null, syncState: 'idle' }),
}))
