import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface CartLine {
  product_id: string;
  variant_id: string | null;
  name: string;
  unit_price: number;
  quantity: number;
  in_stock: boolean;
  modifier_option_ids?: string[];
  modifiers_label?: string;
}

interface CartState {
  shopSlug: string | null;
  lines: CartLine[];
  add: (shopSlug: string, line: Omit<CartLine, "quantity">) => void;
  setQty: (key: string, qty: number) => void;
  remove: (key: string) => void;
  clear: () => void;
  count: () => number;
  subtotal: () => number;
}

const keyOf = (l: { product_id: string; variant_id: string | null; modifier_option_ids?: string[] }) =>
  `${l.product_id}:${l.variant_id ?? "base"}:${[...(l.modifier_option_ids ?? [])].sort().join(",")}`;

/**
 * Single-shop cart: adding an item from a different shop replaces the cart
 * (you can't check out across shops in one order).
 */
export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      shopSlug: null,
      lines: [],

      add: (shopSlug, line) =>
        set((state) => {
          const reset = state.shopSlug !== shopSlug;
          const lines = reset ? [] : [...state.lines];
          const k = keyOf(line);
          const existing = lines.find((l) => keyOf(l) === k);
          if (existing) {
            existing.quantity += 1;
          } else {
            lines.push({ ...line, quantity: 1 });
          }
          return { shopSlug, lines };
        }),

      setQty: (key, qty) =>
        set((state) => ({
          lines: state.lines
            .map((l) => (keyOf(l) === key ? { ...l, quantity: Math.max(0, qty) } : l))
            .filter((l) => l.quantity > 0),
        })),

      remove: (key) => set((state) => ({ lines: state.lines.filter((l) => keyOf(l) !== key) })),

      clear: () => set({ shopSlug: null, lines: [] }),

      count: () => get().lines.reduce((n, l) => n + l.quantity, 0),
      subtotal: () => get().lines.reduce((s, l) => s + l.unit_price * l.quantity, 0),
    }),
    { name: "shopos-cart" },
  ),
);

export const cartKeyOf = keyOf;
