import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { taxGroupsService, type TaxGroupInput } from "../services/taxGroupsService";

export function useTaxGroups() {
  return useQuery({
    queryKey: ["tax-groups"],
    queryFn: async () => (await taxGroupsService.list()).data,
  });
}

export function useTaxGroupMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["tax-groups"] });
    qc.invalidateQueries({ queryKey: ["products"] });
  };

  return {
    create: useMutation({ mutationFn: (p: TaxGroupInput) => taxGroupsService.create(p), onSuccess: invalidate }),
    update: useMutation({
      mutationFn: ({ id, ...p }: { id: string } & Partial<TaxGroupInput>) => taxGroupsService.update(id, p),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: (id: string) => taxGroupsService.remove(id), onSuccess: invalidate }),
  };
}
