import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "../types/api";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => {
        // Never retry client errors (401/403/404/422) — only network/5xx.
        if (error instanceof ApiError && error.status > 0 && error.status < 500) {
          return false;
        }
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: false, // mutations are never auto-retried (no duplicate submits)
    },
  },
});
