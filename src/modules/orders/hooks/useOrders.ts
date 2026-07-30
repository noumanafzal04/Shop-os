import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { ordersService, type OrderStatus, type PlaceOrderPayload } from "../services/ordersService";
import { uuid } from "../../../common/uuid";

export function useMyOrders(page = 1) {
  return useQuery({
    queryKey: ["orders", "mine", page],
    queryFn: () => ordersService.myOrders(page),
    placeholderData: keepPreviousData,
  });
}

export function usePlaceOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: PlaceOrderPayload) =>
      ordersService.place({ idempotency_key: uuid(), ...payload }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["orders", "mine"] }),
  });
}

export function useCancelMyOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => ordersService.cancelMine(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["orders", "mine"] }),
  });
}

// owner
export function useShopOrders(params: { status?: string; page?: number }) {
  return useQuery({
    queryKey: ["orders", "shop", params],
    queryFn: () => ordersService.shopOrders(params),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000, // new orders surface without manual refresh
  });
}

export function useOrderActions() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["orders"] });
    queryClient.invalidateQueries({ queryKey: ["products"] });
    queryClient.invalidateQueries({ queryKey: ["inventory"] });
    queryClient.invalidateQueries({ queryKey: ["sales"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const advance = useMutation({
    mutationFn: ({ id, status }: { id: string; status: OrderStatus }) => ordersService.advance(id, status),
    onSuccess: invalidate,
  });
  const cancel = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => ordersService.cancel(id, reason),
    onSuccess: invalidate,
  });
  const assignRider = useMutation({
    mutationFn: ({ id, riderId }: { id: string; riderId: string | null }) => ordersService.assignRider(id, riderId),
    onSuccess: invalidate,
  });

  return { advance, cancel, assignRider };
}

export function useRiders() {
  return useQuery({
    queryKey: ["riders"],
    queryFn: async () => (await ordersService.riders()).data,
  });
}

export function useRiderMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["riders"] });
    queryClient.invalidateQueries({ queryKey: ["orders"] });
  };
  const create = useMutation({
    mutationFn: (payload: { name: string; phone?: string }) => ordersService.createRider(payload),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, ...payload }: { id: string; name?: string; phone?: string; is_active?: boolean }) =>
      ordersService.updateRider(id, payload),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => ordersService.deleteRider(id),
    onSuccess: invalidate,
  });
  return { create, update, remove };
}
