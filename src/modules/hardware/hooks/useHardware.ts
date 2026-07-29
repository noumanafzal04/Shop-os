import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hardwareService, type HardwareDeviceInput } from "../services/hardwareService";
import { useAuthStore } from "../../../stores/authStore";

export function useHardwareDevices() {
  const role = useAuthStore((s) => s.user?.role);
  const isShop = role === "shop_owner" || role === "staff";
  return useQuery({
    queryKey: ["hardware-devices"],
    queryFn: async () => (await hardwareService.list()).data,
    enabled: isShop,
  });
}

export function useHardwareMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["hardware-devices"] });

  return {
    create: useMutation({ mutationFn: (p: HardwareDeviceInput) => hardwareService.create(p), onSuccess: invalidate }),
    update: useMutation({
      mutationFn: ({ id, ...p }: { id: string } & Partial<HardwareDeviceInput>) => hardwareService.update(id, p),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: (id: string) => hardwareService.remove(id), onSuccess: invalidate }),
  };
}
