import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SavedState {
  ids: string[];
  toggle: (productId: string) => void;
  has: (productId: string) => boolean;
  clear: () => void;
}

/**
 * THINGS SOMEBODY MEANT TO COME BACK TO.
 *
 * Deliberately in the browser rather than on the server, and worth saying why
 * out loud so nobody "fixes" it by accident and nobody assumes it syncs.
 *
 * `customer_favorites` on the server is user↔SHOP: it answers "which shops do
 * I follow", not "which items did I like". There is no product favourite table,
 * and inventing one is a migration, an endpoint and a permission story — none
 * of which a shopper should have to wait for before a heart works.
 *
 * The cost is honest and bounded: it is per browser, it does not follow a
 * customer to their phone, and it survives a sign-out because it never knew
 * who they were. That is the same deal as the cart beside it. If it later gets
 * a server, this store is the seam — every caller asks `has`/`toggle` and none
 * of them knows where the answer lives.
 */
export const useSavedStore = create<SavedState>()(
  persist(
    (set, get) => ({
      ids: [],

      toggle: (productId) =>
        set((state) => ({
          ids: state.ids.includes(productId)
            ? state.ids.filter((id) => id !== productId)
            : [...state.ids, productId],
        })),

      has: (productId) => get().ids.includes(productId),

      clear: () => set({ ids: [] }),
    }),
    { name: "cartze-saved" },
  ),
);
