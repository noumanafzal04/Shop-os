import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  adminService,
  type BillingPeriodInput,
  type PaymentFilters,
  type PlanInput,
  type SubscriptionPaymentInput,
  type TenantFilters,
  type TenantInput,
} from "../services/adminService";

export function useAdminTenants(params: TenantFilters) {
  return useQuery({
    queryKey: ["admin", "tenants", params],
    queryFn: () => adminService.tenants(params),
    placeholderData: keepPreviousData,
  });
}

/**
 * HOW MANY PEOPLE ARE WAITING, for the rail to badge.
 *
 * Polled on a slow timer rather than only on mount: an admin leaves this
 * console open all day, and a queue whose count was fetched once at 9am is a
 * badge that says nobody is waiting for the rest of it.
 *
 * `staleTime` is deliberately shorter than the interval, so a screen that
 * answers a request also refreshes the number rather than showing the count
 * from before it was answered.
 */
export function useAdminInbox(enabled = true) {
  return useQuery({
    queryKey: ["admin", "inbox"],
    queryFn: async () => (await adminService.inbox()).data,
    enabled,
    staleTime: 30 * 1000,
    refetchInterval: 2 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
}

/**
 * Set a shop owner's password, on their behalf, because they cannot.
 *
 * Invalidates the tenant queries because the server revoked every session the
 * owner had, and the detail screen shows their status.
 */
export function useResetOwnerPassword() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...payload
    }: {
      id: string;
      password: string;
      password_confirmation: string;
      user_id?: string;
    }) => adminService.resetOwnerPassword(id, payload),
    onSuccess: (_res, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["admin", "tenant", id] });
    },
  });
}

export function useAdminTenant(id: string | undefined) {
  return useQuery({
    queryKey: ["admin", "tenant", id],
    queryFn: async () => (await adminService.tenant(id!)).data,
    enabled: !!id,
  });
}

export function useBanners() {
  return useQuery({ queryKey: ["admin", "banners"], queryFn: async () => (await adminService.banners()).data });
}

export function useBannerMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin", "banners"] });
  const create = useMutation({ mutationFn: (data: FormData) => adminService.createBanner(data), onSuccess: invalidate });
  const update = useMutation({ mutationFn: ({ id, data }: { id: string; data: FormData }) => adminService.updateBanner(id, data), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: (id: string) => adminService.deleteBanner(id), onSuccess: invalidate });
  return { create, update, remove };
}

export function useAnnouncements() {
  return useQuery({ queryKey: ["admin", "announcements"], queryFn: async () => (await adminService.announcements()).data });
}
export function useAnnouncementMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin", "announcements"] });
  const create = useMutation({ mutationFn: (data: FormData) => adminService.createAnnouncement(data), onSuccess: invalidate });
  const update = useMutation({ mutationFn: ({ id, data }: { id: string; data: FormData }) => adminService.updateAnnouncement(id, data), onSuccess: invalidate });
  const send = useMutation({ mutationFn: (id: string) => adminService.sendAnnouncement(id), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: (id: string) => adminService.deleteAnnouncement(id), onSuccess: invalidate });
  return { create, update, send, remove };
}

export function useModuleCatalog() {
  return useQuery({
    queryKey: ["admin", "module-catalog"],
    queryFn: async () => (await adminService.moduleCatalog()).data,
    staleTime: 60 * 60 * 1000,
  });
}

export function useUpdateModules() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, modules }: { id: string; modules: Record<string, boolean> }) =>
      adminService.updateModules(id, modules),
    onSuccess: (_res, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["admin", "tenant", id] });
      queryClient.invalidateQueries({ queryKey: ["admin", "tenants"] });
    },
  });
}

export function useExtendLimits() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, limits, mode }: { id: string; limits: Record<string, number | null>; mode?: "add" | "set" }) =>
      adminService.extendLimits(id, limits, mode ?? "set"),
    onSuccess: (_res, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["admin", "tenant", id] });
      queryClient.invalidateQueries({ queryKey: ["admin", "tenants"] });
    },
  });
}

export function usePlans() {
  return useQuery({
    queryKey: ["admin", "plans"],
    queryFn: async () => (await adminService.plans()).data,
    staleTime: 30 * 60 * 1000,
  });
}

export function useAdminCities() {
  return useQuery({
    queryKey: ["cities"],
    queryFn: async () => (await adminService.cities()).data,
    staleTime: 30 * 60 * 1000,
  });
}

export function usePlanMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["admin", "plans"] });

  const create = useMutation({
    mutationFn: (payload: PlanInput) => adminService.createPlan(payload),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, ...payload }: { id: string } & Partial<PlanInput>) => adminService.updatePlan(id, payload),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => adminService.deletePlan(id),
    onSuccess: invalidate,
  });

  return { create, update, remove };
}

export function useBillingSummary() {
  return useQuery({
    queryKey: ["admin", "billing", "summary"],
    queryFn: async () => (await adminService.billingSummary()).data,
  });
}

export function usePayments(params: PaymentFilters) {
  return useQuery({
    queryKey: ["admin", "payments", params],
    queryFn: () => adminService.payments(params),
    placeholderData: keepPreviousData,
  });
}

export function useTenantMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["admin"] });
  };

  const create = useMutation({
    mutationFn: (payload: TenantInput) => adminService.createTenant(payload),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, ...payload }: { id: string } & Partial<TenantInput>) => adminService.updateTenant(id, payload),
    onSuccess: invalidate,
  });
  const suspend = useMutation({ mutationFn: (id: string) => adminService.suspendTenant(id), onSuccess: invalidate });
  const activate = useMutation({ mutationFn: (id: string) => adminService.activateTenant(id), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: (id: string) => adminService.deleteTenant(id), onSuccess: invalidate });
  const restore = useMutation({ mutationFn: (id: string) => adminService.restoreTenant(id), onSuccess: invalidate });

  const assignPlan = useMutation({
    mutationFn: ({
      id,
      ...payload
    }: {
      id: string;
      plan_id: string;
      payment?: SubscriptionPaymentInput;
      period?: BillingPeriodInput;
    }) => adminService.assignPlan(id, payload),
    onSuccess: invalidate,
  });

  return { create, update, suspend, activate, remove, restore, assignPlan };
}
