import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fuelService, type CloseShiftInput } from "../services/fuelService";

const KEY = ["fuel"] as const;

export function useFuelTanks() {
  return useQuery({
    queryKey: [...KEY, "tanks"],
    queryFn: async () => (await fuelService.tanks()).data,
  });
}

export function useFuelPumps() {
  return useQuery({
    queryKey: [...KEY, "pumps"],
    queryFn: async () => (await fuelService.pumps()).data,
  });
}

/**
 * The shift the forecourt is running right now. Everything the close screen
 * needs — which meters to read, which tanks to dip — comes from here, so it is
 * refetched after every write rather than trusted to go stale gracefully.
 */
export function useCurrentShift() {
  return useQuery({
    queryKey: [...KEY, "shift", "current"],
    queryFn: async () => (await fuelService.currentShift()).data,
  });
}

export function useShifts(params: { page?: number; status?: string }) {
  return useQuery({
    queryKey: [...KEY, "shifts", params],
    queryFn: async () => {
      const res = await fuelService.shifts(params);
      return { rows: res.data, pagination: res.meta?.pagination };
    },
    placeholderData: keepPreviousData,
  });
}

export function useShift(id: string | undefined) {
  return useQuery({
    queryKey: [...KEY, "shift", id],
    queryFn: async () => (await fuelService.shift(id!)).data,
    enabled: !!id,
  });
}

export function useDeliveries(params: { page?: number } = {}) {
  return useQuery({
    queryKey: [...KEY, "deliveries", params],
    queryFn: async () => {
      const res = await fuelService.deliveries(params);
      return { rows: res.data, pagination: res.meta?.pagination };
    },
    placeholderData: keepPreviousData,
  });
}

export function usePriceChanges(params: { page?: number } = {}) {
  return useQuery({
    queryKey: [...KEY, "prices", params],
    queryFn: async () => {
      const res = await fuelService.prices(params);
      return { rows: res.data, pagination: res.meta?.pagination };
    },
    placeholderData: keepPreviousData,
  });
}

/**
 * Every write here moves stock, a tank dip or a meter, so the invalidation is
 * deliberately broad: a stale tank reading on screen is the input to the next
 * reconciliation.
 */
export function useFuelMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: KEY });
    qc.invalidateQueries({ queryKey: ["products"] });
  };

  return {
    createTank: useMutation({ mutationFn: fuelService.createTank, onSuccess: invalidate }),
    updateTank: useMutation({
      mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => fuelService.updateTank(id, body),
      onSuccess: invalidate,
    }),
    deleteTank: useMutation({ mutationFn: fuelService.deleteTank, onSuccess: invalidate }),

    createPump: useMutation({ mutationFn: fuelService.createPump, onSuccess: invalidate }),
    deletePump: useMutation({ mutationFn: fuelService.deletePump, onSuccess: invalidate }),
    createNozzle: useMutation({
      mutationFn: ({ pumpId, body }: { pumpId: string; body: Record<string, unknown> }) =>
        fuelService.createNozzle(pumpId, body),
      onSuccess: invalidate,
    }),
    deleteNozzle: useMutation({
      mutationFn: ({ pumpId, id }: { pumpId: string; id: string }) => fuelService.deleteNozzle(pumpId, id),
      onSuccess: invalidate,
    }),

    openShift: useMutation({ mutationFn: fuelService.openShift, onSuccess: invalidate }),
    closeShift: useMutation({
      mutationFn: ({ id, body }: { id: string; body: CloseShiftInput }) => fuelService.closeShift(id, body),
      onSuccess: invalidate,
    }),

    createDelivery: useMutation({ mutationFn: fuelService.createDelivery, onSuccess: invalidate }),
    createPrice: useMutation({ mutationFn: fuelService.createPrice, onSuccess: invalidate }),
  };
}
