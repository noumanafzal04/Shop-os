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
  /** How many things are in the basket. ONE definition — see below. */
  count: () => number;
  subtotal: () => number;
  /** True when adding from `shopSlug` would discard what is already here. */
  wouldReplace: (shopSlug: string) => boolean;
}

const keyOf = (l: {
  product_id: string;
  variant_id: string | null;
  modifier_option_ids?: string[];
}) =>
  `${l.product_id}:${l.variant_id ?? "base"}:${(l.modifier_option_ids ?? []).slice().sort().join(",") || "-"}`;

/**
 * How many things are in the basket.
 *
 * ── Why this is a function here and not an expression at each call site ──
 *
 * It was both, and they disagreed. The tab bar's badge summed the quantities
 * (two burgers and chips → 3) while the shop page's cart bar counted the lines
 * (→ 2). Those two numbers are drawn ON THE SAME SCREEN, a thumb-width apart,
 * and a basket that cannot say how full it is is a basket nobody trusts at
 * checkout.
 *
 * A weight line counts as ONE. Half a kilo of mangoes is one thing you are
 * buying, and "0.5" in a badge is not a number anyone can act on.
 */
const countOf = (lines: CartLine[]): number =>
  lines.reduce((n, l) => n + (l.sold_by === "weight" ? 1 : l.quantity), 0);

/** Single-shop cart (adding from another shop replaces it). In-memory. */
export const useCartStore = create<CartState>((set, get) => ({
  shopSlug: null,
  lines: [],

  add: (shopSlug, line, qty = 1) =>
    set((state) => {
      const reset = state.shopSlug !== shopSlug;
      const k = keyOf(line);

      const lines = reset
        ? [{ ...line, quantity: round3(qty) }]
        : // Rebuilt, never patched in place. The previous version copied the
          // array and then mutated the line object inside it — and a shallow
          // copy shares its objects, so that edited the state React had already
          // rendered. It happened to look right because the array reference
          // changed anyway; it is the kind of thing that starts failing when
          // something else finally holds on to a line.
          (() => {
            const existing = state.lines.find((l) => keyOf(l) === k);
            if (!existing) return [...state.lines, { ...line, quantity: round3(qty) }];
            return state.lines.map((l) =>
              keyOf(l) === k ? { ...l, quantity: round3(l.quantity + qty) } : l,
            );
          })();

      return { shopSlug, lines };
    }),

  setQty: (key, qty) =>
    set((state) => ({
      lines: state.lines
        .map((l) => (keyOf(l) === key ? { ...l, quantity: round3(Math.max(0, qty)) } : l))
        .filter((l) => l.quantity > 0),
    })),

  clear: () => set({ shopSlug: null, lines: [] }),

  count: () => countOf(get().lines),

  subtotal: () => get().lines.reduce((s, l) => s + l.unit_price * l.quantity, 0),

  /**
   * Asked BEFORE adding, so the person is warned rather than told afterwards.
   *
   * The cart holds one shop at a time — one order, one rider, one delivery fee.
   * That is a reasonable rule and a terrible surprise: tapping a kebab with
   * eight things already in the basket used to empty it without a word.
   */
  wouldReplace: (shopSlug) => {
    const { shopSlug: current, lines } = get();
    return lines.length > 0 && current !== null && current !== shopSlug;
  },
}));

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export const cartKeyOf = keyOf;
export const cartCountOf = countOf;
