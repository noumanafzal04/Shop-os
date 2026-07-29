import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * The branch an owner is currently operating (ringing sales / viewing stock).
 * Sent as X-Branch-Id on every API request; the backend validates it against
 * the tenant's branches and ignores it for pinned staff. Null = let the server
 * decide (staff → their assigned branch; owner → Main).
 */
interface BranchState {
  activeBranchId: string | null;
  setActiveBranch: (id: string | null) => void;
}

export const useBranchStore = create<BranchState>()(
  persist(
    (set) => ({
      activeBranchId: null,
      setActiveBranch: (id) => set({ activeBranchId: id }),
    }),
    { name: "shopos-branch" },
  ),
);
