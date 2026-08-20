import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "../../../common/api/client";
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

export function useNotifications(page = 1) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return useQuery({
    // Fifteen a page. Without a page number the bell showed the fifteen newest
    // and everything older was gone from the product — which matters more here
    // than on most lists, because an expiry warning is spoken ONCE per lot per
    // stage and is never repeated. Missing it in the fifteen meant missing it.
    queryKey: ["notifications", page],
    queryFn: () => apiGet<AppNotification[]>("/notifications", { params: { page } }),
    enabled: isAuthenticated,
    // Near-real-time bell without websockets.
    refetchInterval: 30_000,
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
