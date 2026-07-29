import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { branchService, type BranchInput } from "../services/branchService";

export function useBranches(enabled = true) {
  return useQuery({
    queryKey: ["branches"],
    queryFn: async () => (await branchService.list()).data,
    enabled,
  });
}

export function useBranchMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["branches"] });

  const create = useMutation({ mutationFn: (p: BranchInput) => branchService.create(p), onSuccess: invalidate });
  const update = useMutation({
    mutationFn: ({ id, ...p }: { id: string } & Partial<BranchInput>) => branchService.update(id, p),
    onSuccess: invalidate,
  });
  const remove = useMutation({ mutationFn: (id: string) => branchService.remove(id), onSuccess: invalidate });

  return { create, update, remove };
}
