import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { posService } from "../services/posService";
import type { HeldSale } from "../services/posService";

export function useCurrentSession() {
  return useQuery({
    queryKey: ["pos", "session"],
    queryFn: async () => (await posService.currentSession()).data,
  });
}

export function useShiftMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["pos", "session"] });

  const open = useMutation({ mutationFn: (float: number) => posService.openSession(float), onSuccess: invalidate });
  const close = useMutation({
    mutationFn: ({ counted, notes }: { counted: number; notes?: string }) => posService.closeSession(counted, notes),
    onSuccess: invalidate,
  });
  return { open, close };
}

export function useHeldSales() {
  return useQuery({
    queryKey: ["pos", "held"],
    queryFn: async () => (await posService.heldList()).data,
  });
}

export function useHeldMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["pos", "held"] });

  const hold = useMutation({
    mutationFn: (payload: { label?: string; cart: HeldSale["cart"]; total_estimate: number }) => posService.hold(payload),
    onSuccess: invalidate,
  });
  const remove = useMutation({ mutationFn: (id: string) => posService.deleteHeld(id), onSuccess: invalidate });
  return { hold, remove };
}
