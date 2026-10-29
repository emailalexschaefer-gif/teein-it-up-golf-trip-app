// SCRATCH HARNESS: minimal stand-in for @tanstack/react-query (not installable offline). Only what AmbroseHQSection uses.
import { useEffect, useState } from 'react'
export function useQuery<T>(o: { queryKey: unknown[]; queryFn: () => Promise<T>; staleTime?: number; enabled?: boolean }) {
  const [s, set] = useState<{ data: T | undefined; isLoading: boolean; isError: boolean }>({ data: undefined, isLoading: true, isError: false })
  useEffect(() => { if (o.enabled === false) return; o.queryFn().then(data => set({ data, isLoading: false, isError: false })).catch(() => set({ data: undefined, isLoading: false, isError: true })) // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return s
}
