import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { vehiclesService, type VehicleInput } from "../services/vehiclesService";

export function useVehicles(params: { search?: string; customer_id?: string; page?: number } = {}, enabled = true) {
  return useQuery({
    queryKey: ["vehicles", params],
    // The ENVELOPE, not just its data: `meta.pagination` is how the screen
    // knows there is a page two. Unwrapping here is what made 25 vehicles the
    // most a workshop could ever see.
    queryFn: () => vehiclesService.list(params),
    enabled,
  });
}

/** The till's lookup. Only fires once there's enough of a plate to match on. */
export function useVehicleLookup(search: string) {
  return useQuery({
    queryKey: ["vehicles", "lookup", search],
    queryFn: async () => (await vehiclesService.lookup(search)).data,
    enabled: search.trim().length >= 2,
  });
}

export function useVehicleHistory(id: string | null) {
  return useQuery({
    queryKey: ["vehicles", "history", id],
    queryFn: async () => (await vehiclesService.history(id!)).data,
    enabled: !!id,
  });
}

export function useVehicleMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["vehicles"] });

  return {
    create: useMutation({ mutationFn: (p: VehicleInput) => vehiclesService.create(p), onSuccess: invalidate }),
    quickCreate: useMutation({ mutationFn: (p: VehicleInput) => vehiclesService.quickCreate(p), onSuccess: invalidate }),
    update: useMutation({
      mutationFn: ({ id, ...p }: { id: string } & Partial<VehicleInput>) => vehiclesService.update(id, p),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: (id: string) => vehiclesService.remove(id), onSuccess: invalidate }),
  };
}
