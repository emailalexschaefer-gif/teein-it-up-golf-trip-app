'use client'

// ─────────────────────────────────────────────────────────────────────────────
// REACT QUERY PROVIDER
// Wraps the app with React Query context.
// Client component — used in root layout.
// ─────────────────────────────────────────────────────────────────────────────

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { useState, type ReactNode } from 'react'

export default function ReactQueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Data stays fresh for 1 minute before background refetch
            staleTime: 1000 * 60,
            // Cache kept for 5 minutes after component unmounts
            gcTime: 1000 * 60 * 5,
            // Retry failed queries up to 2 times
            retry: 2,
            retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
            // Refetch when user returns to tab — important for live scoring
            refetchOnWindowFocus: true,
          },
          mutations: {
            retry: 0,
          },
        },
      })
  )

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {process.env.NODE_ENV === 'development' && (
        <ReactQueryDevtools initialIsOpen={false} />
      )}
    </QueryClientProvider>
  )
}
