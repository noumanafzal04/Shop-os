import { useMutation, useQueryClient } from "@tanstack/react-query";
import { branchService, type BranchInput, type PlaceGoing } from "../services/branchService";
import { useKeptQuery } from "../../../common/kept/useKeptQuery";

/**
 * How long the list of places is trusted without asking.
 *
 * The header's branch switcher reads it on every screen, so it was asked on
 * every load. A place is opened or closed a few times in a shop's life, and
 * doing it on this device refreshes the list there and then (`invalidate`
 * below) — so the list is kept (common/kept), and a load inside this asks
 * nothing.
 */
export const PLACES_TRUSTED_FOR = 5 * 60_000;

export function useBranches(enabled = true) {
  return useKeptQuery("branches", {
    queryKey: ["branches"],
    queryFn: async () => (await branchService.list()).data,
    staleTime: PLACES_TRUSTED_FOR,
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
