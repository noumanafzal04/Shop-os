import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { apiDelete, apiGet, apiPost, apiPut } from "../../../common/api/client";
import type { User } from "../../auth/types";

/**
 * A job worth offering this shop. Purely a starting point — nothing is stored
 * against the user but the resulting permissions, so a preset leaves no trace
 * and can never become a shadow role.
 */
export interface JobPreset {
  code: string;
  label: string;
  description: string;
  permissions: string[];
}

export interface StaffInput {
  name: string;
  email?: string;
  phone?: string;
  password?: string;
  status?: "active" | "suspended";
  permissions: string[];
}

/**
 * Staff CRUD scoped to a base path: "/admin/staff" (platform) or "/staff"
 * (tenant). Both expose the same shape, so one hook serves both consoles.
 */
export function useStaffModule(basePath: string) {
  const queryClient = useQueryClient();
  const key = ["staff", basePath];
  const invalidate = () => queryClient.invalidateQueries({ queryKey: key });

  /**
   * "What job does this person do?" — presets that tick the boxes below.
   *
   * Tenant-side only: the platform console manages Anthropic-side staff and has
   * no shop to filter jobs against. The server returns only the jobs that make
   * sense for THIS shop's modules and trade.
   */
  const useJobPresets = () =>
    useQuery({
      queryKey: [...key, "presets"],
      queryFn: async () => (await apiGet<JobPreset[]>(`${basePath}/presets`)).data,
      enabled: basePath === "/staff",
      staleTime: 30 * 60 * 1000,
    });

  const usePermissionCatalog = () =>
    useQuery({
      queryKey: [...key, "permissions"],
      queryFn: async () => (await apiGet<string[]>(`${basePath}/permissions`)).data,
      staleTime: 30 * 60 * 1000,
    });

  const useStaffList = (params: { search?: string; status?: string; page?: number }) =>
    useQuery({
      queryKey: [...key, params],
      queryFn: () =>
        apiGet<User[]>(basePath, {
          params: {
            search: params.search || undefined,
            status: params.status || undefined,
            page: params.page ?? 1,
          },
        }),
      placeholderData: keepPreviousData,
    });

  const create = useMutation({
    mutationFn: (payload: StaffInput) => apiPost<User>(basePath, payload),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, ...payload }: { id: string } & Partial<StaffInput>) =>
      apiPut<User>(`${basePath}/${id}`, payload),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiDelete<null>(`${basePath}/${id}`),
    onSuccess: invalidate,
  });

  return { usePermissionCatalog, useJobPresets, useStaffList, create, update, remove };
}
