// Shared mutable test state, reachable from the stubs via globalThis so the
// stubs and the test see the SAME instance regardless of how the module
// graph is loaded.
import type { FakeDb } from './fakeDb'

export interface HarnessState {
  admin: FakeDb
  sessionClient: () => unknown
}

const KEY = '__tiuRouteHarness'

export function setHarness(state: HarnessState): void {
  ;(globalThis as Record<string, unknown>)[KEY] = state
}

export function getHarness(): HarnessState {
  const s = (globalThis as Record<string, unknown>)[KEY] as HarnessState | undefined
  if (!s) throw new Error('route harness not initialised')
  return s
}
