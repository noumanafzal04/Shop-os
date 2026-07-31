import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customerGroupsService, type CustomerGroupInput } from "../services/customerGroupsService";

export function useCustomerGroups() {
  return useQuery({
    queryKey: ["customer-groups"],
    queryFn: async () => (await customerGroupsService.list()).data,
  });
}

export function useCustomerGroupMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["customer-groups"] });
    qc.invalidateQueries({ queryKey: ["customers"] });
  };

  return {
    create: useMutation({ mutationFn: (p: CustomerGroupInput) => customerGroupsService.create(p), onSuccess: invalidate }),
    update: useMutation({
      mutationFn: ({ id, ...p }: { id: string } & Partial<CustomerGroupInput>) => customerGroupsService.update(id, p),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: (id: string) => customerGroupsService.remove(id), onSuccess: invalidate }),
  };
}
