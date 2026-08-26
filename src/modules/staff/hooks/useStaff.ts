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

/**
 * One grantable permission as the server describes it. `hint` is null on most
 * of them by design — a hint on every row is noise, and noise on a permission
 * screen is how the wrong box gets ticked.
 */
/**
 * Every axis the staff list can be narrowed by.
 *
 * `status` has been accepted by the server since the list was written and the
 * screen sent a search box — so after somebody leaves, "who is still switched
 * on" could not be asked. The rest are new, and `job` is the one an owner
 * actually thinks in: nobody looks for "the people holding sales.void".
 *
 * These are tenant-side only. The platform staff list uses the same hook with
 * a different base path and simply passes none of them.
 */
export interface StaffFilters {
  search?: string;
  status?: string;
  /** A branch id, or the literal "none" for people pinned to no branch. */
  branch_id?: string;
  /** A job preset code — matched EXACTLY, so one box off reads as Custom. */
  job?: string;
  /** One permission, for "who can refund". */
  permission?: string;
  page?: number;
}

export interface PermissionInfo {
  key: string;
  label: string;
  hint: string | null;
  /**
   * Whether THIS shop can use it — a mart has no kitchen board and no tables.
   *
   * The server flags rather than removes, so the form can still show a
   * permission somebody already HOLDS from a module since switched off.
   * Dropping it from the payload would revoke it the next time anybody
   * corrected that person's phone number. Optional because an older response
   * carries no flag; absent reads as available.
   */
  available?: boolean;
}

export interface StaffInput {
  name: string;
  email?: string;
  phone?: string;
  password?: string;
  status?: "active" | "suspended";
  permissions: string[];
  /**
   * Which branch this person works at. Tenant side only — the platform route
   * REFUSES it (`prohibited`), because a platform staff member belongs to no
   * shop and therefore to no branch of one.
   *
   * `null` clears the pin, which the server reads as "falls back to Main".
   * The server has accepted and written this from the day it was added, and the
   * panel never sent it once: every staff member in every multi-branch shop
   * fell back to Main, so branch two's cashier rang on branch one's stock.
   */
  branch_id?: string | null;
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

  /**
   * The permissions this console can grant, each already carrying its label
   * and any hint. The copy travels with the permission from the server so a
   * newly-added one cannot arrive on the form with nothing but its slug —
   * which is how the platform's most dangerous checkbox once shipped with no
   * explanation at all.
   */
  const usePermissionCatalog = () =>
    useQuery({
      queryKey: [...key, "permissions"],
      queryFn: async () => (await apiGet<PermissionInfo[]>(`${basePath}/permissions`)).data,
      staleTime: 30 * 60 * 1000,
    });

  const useStaffList = (params: StaffFilters) =>
    useQuery({
      queryKey: [...key, params],
      queryFn: () =>
        apiGet<User[]>(basePath, {
          params: {
            search: params.search || undefined,
            status: params.status || undefined,
            branch_id: params.branch_id || undefined,
            job: params.job || undefined,
            permission: params.permission || undefined,
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
