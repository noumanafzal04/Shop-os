import { create } from "zustand";

export interface CartLine {
  product_id: string;
  variant_id: string | null;
  name: string;
  unit_price: number;
  quantity: number;
  /** Weight items step by 0.25 and allow fractions. */
  sold_by?: "unit" | "weight";
  unit_label?: string | null;
  /** Food choices — the same product with different options is a separate line. */
  modifier_option_ids?: string[];
  modifiers_label?: string;
}

interface CartState {
  shopSlug: string | null;
  lines: CartLine[];
  add: (shopSlug: string, line: Omit<CartLine, "quantity">, qty?: number) => void;
  setQty: (key: string, qty: number) => void;
  clear: () => void;
  count: () => number;
  subtotal: () => number;
}

const keyOf = (l: {
  product_id: string;
  variant_id: string | null;
  modifier_option_ids?: string[];
}) =>
  `${l.product_id}:${l.variant_id ?? "base"}:${(l.modifier_option_ids ?? []).slice().sort().join(",") || "-"}`;

/** Single-shop cart (adding from another shop replaces it). In-memory. */
export const useCartStore = create<CartState>((set, get) => ({
  shopSlug: null,
  lines: [],

  add: (shopSlug, line, qty = 1) =>
    set((state) => {
      const reset = state.shopSlug !== shopSlug;
      const lines = reset ? [] : [...state.lines];
      const k = keyOf(line);
      const existing = lines.find((l) => keyOf(l) === k);
      if (existing) existing.quantity = round3(existing.quantity + qty);
      else lines.push({ ...line, quantity: round3(qty) });
      return { shopSlug, lines };
    }),

  setQty: (key, qty) =>
    set((state) => ({
      lines: state.lines
        .map((l) => (keyOf(l) === key ? { ...l, quantity: round3(Math.max(0, qty)) } : l))
        .filter((l) => l.quantity > 0),
    })),

  clear: () => set({ shopSlug: null, lines: [] }),

  count: () => get().lines.length,
  subtotal: () => get().lines.reduce((s, l) => s + l.unit_price * l.quantity, 0),
}));

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export const cartKeyOf = keyOf;
