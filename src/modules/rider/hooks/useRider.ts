import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "../../../stores/authStore";
import { riderService, type ApplyInput } from "../services/riderService";

/**
 * ── Why this polls instead of listening ──────────────────────────────
 *
 * There is no websocket server in this product yet: Reverb is not installed
 * and standing one up is its own piece of work with its own deployment. What a
 * rider actually needs is that the board is never more than a few seconds
 * stale and that a pull refreshes it now — and a fifteen-second poll on ONE
 * endpoint gives that, on a patchy mobile connection, with no new
 * infrastructure and no reconnection logic to get wrong.
 *
 * The interval is deliberately different per screen: a rider staring at a job
 * board wants seconds, a customer watching one order wants ten, and neither
 * wants a phone that never sleeps. `refetchIntervalInBackground` is left off
 * everywhere, so the timer stops when the app does.
 */
export const RIDER_BOARD_POLL_MS = 15_000;

/** Does this account have a rider hat at all? Null is a real answer. */
export function useRiderProfile() {
  const signedIn = useAuthStore((s) => s.status === "authenticated");

  return useQuery({
    queryKey: ["rider", "me"],
    queryFn: async () => (await riderService.me()).data.profile,
    enabled: signedIn,
    staleTime: 60_000,
  });
}

export function useRiderBoard(enabled = true) {
  return useQuery({
    queryKey: ["rider", "board"],
    queryFn: async () => (await riderService.board()).data,
    enabled,
    refetchInterval: enabled ? RIDER_BOARD_POLL_MS : false,
    staleTime: 5_000,
  });
}

export function useRiderEarnings(from?: string, to?: string) {
  return useQuery({
    queryKey: ["rider", "earnings", from ?? null, to ?? null],
    queryFn: async () => (await riderService.earnings(from, to)).data,
  });
}

/**
 * Everything that changes a rider's world.
 *
 * They all invalidate the same two keys, because they all do: accepting a job
 * changes the board AND the profile's idea of how busy it is, and a screen
 * that refreshed only what it touched would show a stale duty switch beside a
 * fresh job list.
 */
export function useRiderActions() {
  const qc = useQueryClient();
  const after = () => {
    qc.invalidateQueries({ queryKey: ["rider"] });
    // A rider's own delivery is also a customer's order somewhere.
    qc.invalidateQueries({ queryKey: ["orders"] });
  };

  const apply = useMutation({
    mutationFn: (body: ApplyInput) => riderService.apply(body),
    onSuccess: after,
  });

  const uploadDocument = useMutation({
    mutationFn: (v: { type: string; file: { uri: string; name: string; type: string } }) =>
      riderService.uploadDocument(v.type, v.file),
    onSuccess: after,
  });

  const submit = useMutation({ mutationFn: () => riderService.submit(), onSuccess: after });

  const setOnline = useMutation({
    mutationFn: (v: { is_online: boolean; at?: { latitude: number; longitude: number } }) =>
      riderService.setOnline(v.is_online, v.at),
    onSuccess: after,
  });

  const accept = useMutation({ mutationFn: (id: string) => riderService.accept(id), onSuccess: after });
  const decline = useMutation({ mutationFn: (id: string) => riderService.decline(id), onSuccess: after });
  const pickUp = useMutation({ mutationFn: (id: string) => riderService.pickUp(id), onSuccess: after });
  const deliver = useMutation({
    mutationFn: (v: { id: string; code: string }) => riderService.deliver(v.id, v.code),
    onSuccess: after,
  });

  return { apply, uploadDocument, submit, setOnline, accept, decline, pickUp, deliver };
}
