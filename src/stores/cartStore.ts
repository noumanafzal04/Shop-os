import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface CartLine {
  /** Which shop this line is bought FROM. A basket can hold several. */
  shop_slug: string;
  shop_name: string;
  product_id: string;
  variant_id: string | null;
  /** The size, spelled out — "Large", "XL", "42". Shown on the line. */
  variant_name?: string | null;
  name: string;
  image?: string | null;
  unit_price: number;
  quantity: number;
  in_stock: boolean;
  modifier_option_ids?: string[];
  modifiers_label?: string;
}

/** One shop's slice of the basket. */
export interface CartGroup {
  shop_slug: string;
  shop_name: string;
  lines: CartLine[];
  subtotal: number;
}

interface CartState {
  lines: CartLine[];
  add: (line: Omit<CartLine, "quantity">, quantity?: number) => void;
  setQty: (key: string, qty: number) => void;
  remove: (key: string) => void;
  clear: () => void;
  clearShop: (shopSlug: string) => void;
  count: () => number;
  subtotal: () => number;
  groups: () => CartGroup[];
  qtyOf: (line: Pick<CartLine, "product_id" | "variant_id"> & { modifier_option_ids?: string[] }) => number;
}

/**
 * WHAT MAKES TWO LINES THE SAME LINE.
 *
 * The shop is part of it now. Two shops can sell a product whose id differs
 * anyway, so it changes no answer today — but the key is what `setQty` and
 * `remove` address a line by, and a key that cannot name the shop is a key
 * that stops working the moment anything is grouped by one.
 */
const keyOf = (l: {
  shop_slug?: string;
  product_id: string;
  variant_id: string | null;
  modifier_option_ids?: string[];
}) =>
  [
    l.shop_slug ?? "",
    l.product_id,
    l.variant_id ?? "base",
    [...(l.modifier_option_ids ?? [])].sort().join(","),
  ].join(":");

/**
 * THE BASKET, ACROSS SHOPS.
 *
 * It used to hold one shop at a time, and adding anything from a second shop
 * silently emptied it. That is defensible in a single-shop storefront and
 * indefensible in a marketplace: the whole point of an aisle that spans every
 * shop is that a customer fills one basket from it, and a customer who adds a
 * second thing and loses the first will not add a third.
 *
 * An ORDER is still per shop — the backend places one order against one
 * tenant, with that tenant's own delivery fee, minimum and prep time, which is
 * the truth about how the goods actually arrive. So checkout walks the groups
 * and places one order each, and the cart page shows the split rather than
 * hiding it: three shops means three deliveries, and a customer should be told
 * that before they pay, not after.
 */
export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      lines: [],

      add: (line, quantity = 1) =>
        set((state) => {
          const lines = [...state.lines];
          const k = keyOf(line);
          const existing = lines.find((l) => keyOf(l) === k);
          if (existing) {
            existing.quantity += quantity;
          } else {
            lines.push({ ...line, quantity });
          }
          return { lines };
        }),

      setQty: (key, qty) =>
        set((state) => ({
          lines: state.lines
            .map((l) => (keyOf(l) === key ? { ...l, quantity: Math.max(0, qty) } : l))
            .filter((l) => l.quantity > 0),
        })),

      remove: (key) => set((state) => ({ lines: state.lines.filter((l) => keyOf(l) !== key) })),

      clear: () => set({ lines: [] }),

      clearShop: (shopSlug) =>
        set((state) => ({ lines: state.lines.filter((l) => l.shop_slug !== shopSlug) })),

      count: () => get().lines.reduce((n, l) => n + l.quantity, 0),

      subtotal: () => get().lines.reduce((s, l) => s + l.unit_price * l.quantity, 0),

      groups: () => {
        const by = new Map<string, CartGroup>();
        for (const line of get().lines) {
          const group = by.get(line.shop_slug) ?? {
            shop_slug: line.shop_slug,
            shop_name: line.shop_name,
            lines: [],
            subtotal: 0,
          };
          group.lines.push(line);
          group.subtotal += line.unit_price * line.quantity;
          by.set(line.shop_slug, group);
        }
        return [...by.values()];
      },

      /**
       * How many of this are already in the basket.
       *
       * The card asks, so a product already added shows a stepper instead of
       * an "Add" button that would look like it had never been pressed.
       * Matched on product + size + options, ACROSS shops: the same tin from
       * two shops is two lines, and the card only knows about its own.
       */
      qtyOf: (line) => {
        const mods = [...(line.modifier_option_ids ?? [])].sort().join(",");

        return get()
          .lines.filter(
            (l) =>
              l.product_id === line.product_id &&
              l.variant_id === (line.variant_id ?? null) &&
              [...(l.modifier_option_ids ?? [])].sort().join(",") === mods,
          )
          .reduce((n, l) => n + l.quantity, 0);
      },
    }),
    {
      name: "shopos-cart",
      version: 2,
      /**
       * A BASKET FROM BEFORE THE MARKETPLACE.
       *
       * v1 stored `{ shopSlug, lines }` with the shop held once for the whole
       * cart. Dropping it would empty a returning customer's basket without
       * saying so; crashing on it would be worse. The shop moves onto each
       * line, which is the only thing that actually changed.
       */
      migrate: (persisted: unknown, version: number) => {
        if (version >= 2 || persisted === null || typeof persisted !== "object") {
          return persisted as { lines: CartLine[] };
        }

        const old = persisted as { shopSlug?: string | null; lines?: CartLine[] };
        const slug = old.shopSlug ?? null;

        return {
          lines: (old.lines ?? []).map((l) => ({
            ...l,
            shop_slug: l.shop_slug ?? slug ?? "",
            // The old shape never stored a name. The slug is what we have, and
            // it is recognisable — it is in the shop's own url.
            shop_name: l.shop_name ?? slug ?? "This shop",
          })).filter((l) => l.shop_slug !== ""),
        };
      },
    },
  ),
);

export const cartKeyOf = keyOf;
