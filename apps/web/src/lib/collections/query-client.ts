/**
 * Shared QueryClient for all TanStack DB collections
 *
 * Extracted into its own module to avoid circular dependencies.
 * Collections import queryClient from here instead of from the barrel index.
 */

import { QueryClient } from '@tanstack/query-core';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data considered fresh for 5 minutes
      staleTime: 1000 * 60 * 5,

      // Keep inactive data in cache for 30 minutes
      gcTime: 1000 * 60 * 30,

      // Retry failed requests 3 times with exponential backoff
      retry: 3,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    },
  },
});
