import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "../../../common/api/client";
import { WATCHER_NETWORK_MODE } from "../../../common/api/queryClient";
import { useKeptQuery } from "../../../common/kept/useKeptQuery";
import type { ApiEnvelope } from "../../../common/types/api";
import { useAuthStore } from "../../../stores/authStore";

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
}

/** How often the bell is asked, and so how long its last answer is trusted. */
export const BELL_EVERY = 30_000;

export function useNotifications(page = 1) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // KEPT ON THE DEVICE (common/kept). The bell is on every screen, so every
  // load asked it — a moment after the last screen had. It still asks every
  // half minute; what it no longer does is ask AGAIN because a screen was
  // opened inside that half minute. Only its first page: that is the one the
  // shell shows, and older pages are read once and left.
  return useKeptQuery<ApiEnvelope<AppNotification[]>>("notifications", {
    kept: page === 1,
    // Fifteen a page. Without a page number the bell showed the fifteen newest
    // and everything older was gone from the product — which matters more here
    // than on most lists, because an expiry warning is spoken ONCE per lot per
    // stage and is never repeated. Missing it in the fifteen meant missing it.
    queryKey: ["notifications", page],
    queryFn: () => apiGet<AppNotification[]>("/notifications", { params: { page } }),
    enabled: isAuthenticated,
    staleTime: BELL_EVERY,
    // Near-real-time bell without websockets.
    refetchInterval: BELL_EVERY,
    // …and not into a dead line: paused offline, asked once when it is back (#AZ2).
    networkMode: WATCHER_NETWORK_MODE,
    refetchOnWindowFocus: true,
  });
}

export function useNotificationActions() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["notifications"] });

  const markRead = useMutation({
    mutationFn: (id: string) => apiPost(`/notifications/${id}/read`),
    onSuccess: invalidate,
  });

  const markAllRead = useMutation({
    mutationFn: () => apiPost("/notifications/read-all"),
    onSuccess: invalidate,
  });

  return { markRead, markAllRead };
}
