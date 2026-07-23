import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { reservationsService } from "../services/reservationsService";

export function useReservations(params: { status?: string; page?: number }) {
  return useQuery({
    queryKey: ["reservations", params],
    queryFn: () => reservationsService.list(params),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000, // new reservations appear without a manual refresh
  });
}

export function useReservationMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["reservations"] });
    queryClient.invalidateQueries({ queryKey: ["products"] });
    queryClient.invalidateQueries({ queryKey: ["inventory"] });
    queryClient.invalidateQueries({ queryKey: ["sales"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const accept = useMutation({
    mutationFn: (id: string) => reservationsService.accept(id),
    onSuccess: invalidate,
  });

  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      reservationsService.reject(id, reason),
    onSuccess: invalidate,
  });

  const complete = useMutation({
    mutationFn: ({ id, ...payment }: { id: string; payment_method: string; amount_paid: number }) =>
      reservationsService.complete(id, payment),
    onSuccess: invalidate,
  });

  return { accept, reject, complete };
}
