import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { branchService, type BranchInput, type PlaceGoing } from "../services/branchService";

export function useBranches(enabled = true) {
  return useQuery({
    queryKey: ["branches"],
    queryFn: async () => (await branchService.list()).data,
    enabled,
  });
}

export function useBranchMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["branches"] });
    // How many places are open rides on the shop's settings, and the menu
    // reads it from there: the screens about "which place" appear with the
    // second one and go with it — not five minutes later.
    qc.invalidateQueries({ queryKey: ["shop-settings"] });
  };

  const create = useMutation({ mutationFn: (p: BranchInput) => branchService.create(p), onSuccess: invalidate });
  const update = useMutation({
    mutationFn: ({ id, ...p }: { id: string } & Partial<BranchInput>) => branchService.update(id, p),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: ({ id, ...going }: { id: string } & PlaceGoing) => branchService.remove(id, going),
    onSuccess: () => {
      invalidate();
      // Deleting a place may have moved its stock and its people.
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["stock-by-place"] });
      qc.invalidateQueries({ queryKey: ["transfers"] });
      qc.invalidateQueries({ queryKey: ["staff"] });
      qc.invalidateQueries({ queryKey: ["inventory"] });
    },
  });

  return { create, update, remove };
}
