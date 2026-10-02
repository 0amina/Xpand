import { QueryClient } from '@tanstack/react-query';

import { ApiError } from '@/lib/api';

/**
 * Shared query client.
 *
 * Tuned for a Mini App used in bursts on a phone: data goes stale quickly (a colleague may
 * have logged something a minute ago), refetching on focus is *wanted* because the app is
 * backgrounded constantly, and retries are conservative so a genuine 4xx surfaces at once
 * rather than after three round-trips.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry(failureCount, error) {
        // A 4xx will not fix itself — the input, the id, or the permission is wrong.
        if (error instanceof ApiError && error.statusCode < 500) return false;
        return failureCount < 2;
      },
    },
    mutations: {
      // Never silently repeat a write: a retried POST /transactions is a duplicate entry.
      retry: false,
    },
  },
});
