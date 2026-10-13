import { sizePrice } from "../catalog/pricing";
import type { Product, ProductVariant } from "../catalog/types";
import { catalogReader, sizesOf, whyNotSellable } from "../pos/availability";
import { taxFieldsOf } from "../pos/taxFields";
import { tillBill } from "../pos/tillBill";

/**
 * WHAT GOES OUT IN AN EXCHANGE — and in which size.
 *
 * The till's own notes count six doors into a cart and give them one rule.
 * The exchange sheet was a seventh, and it asked nothing: it listed PRODUCTS,
 * took the product's price, and sent the product's id. So for anything sold
 * in sizes — which in a clothing shop is everything, and an exchange for
 * another size is the commonest thing such a shop does after a sale —
 *
 *     the sheet offered "Lawn Kurta · Rs 2,500", never a size
 *     the server answered "say which size this is for"
 *     and there was nowhere on the sheet to say it.
 *
 * It also worked the money out for itself, tag against tag, with no tax: a
 * Medium bought for 2,625 going back for a Large at 2,835 was "collect 200",
 * and the sale that followed was refused for being ten rupees short.
 *
 * So what can be handed over is the till's question, asked the till's way —
 * each size its own row, with the till's own reason when it cannot go — and
 * what it comes to is the till's own bill.
 */

/** One thing the search can hand over: a product, or one size of it. */
export interface Offer {
  /** The product, and which size of it. Two sizes of one design are two rows. */
  key: string;
  product_id: string;
  variant_id: string | null;
  /** As the sale will name it: "Lawn Kurta (Blue / L)". */
  name: string;
  price: number;
  tracks_serial: boolean;
  tax_rate: number | null;
  tax_group_rate: number | null;
  /** How many are on the shelf, where the shop counts this. Null where it does not. */
  left: number | null;
  /** Why it cannot be handed over, in the till's words — or null. */
  whyNot: string | null;
}

/** An offer that was taken, and how many of it. */
export interface Replacement extends Omit<Offer, "left" | "whyNot"> {
  quantity: number;
  /** The numbers of the units going out, for things sold by their number. */
  serials: string[];
}

type Searched = Pick<Product, "id" | "name" | "type" | "price" | "discount_price" | "track_inventory"> & {
  sold_out?: boolean;
  tracks_serial?: boolean;
  stock_quantity?: number | string | null;
  variants?: ProductVariant[] | null;
};

/** The price a product goes out at: its sale price where it has a real one. */
const shelfPrice = (p: Pick<Product, "price" | "discount_price">): number => {
  const price = Number(p.price);
  const sale = Number(p.discount_price);

  return sale > 0 && sale < price ? sale : price;
};

/**
 * What a searched product offers: itself — or, when it comes in sizes, each
 * size and never the design on its own.
 */
export function offersOf(p: Searched): Offer[] {
  const counted = p.type === "product" && p.track_inventory === true;
  const tax = taxFieldsOf(p);
  const offer = (variant: ProductVariant | null): Offer => ({
    key: variant ? `${p.id}:${variant.id}` : p.id,
    product_id: p.id,
    variant_id: variant?.id ?? null,
    name: variant ? `${p.name} (${variant.name})` : p.name,
    // A size is charged at the size's price — the same figure the till's sheet shows.
    price: variant ? sizePrice(p, variant) : shelfPrice(p),
    tracks_serial: !!p.tracks_serial,
    ...tax,
    left: counted ? catalogReader(p, variant) : null,
    whyNot: whyNotSellable(p, variant),
  });

  const sizes = sizesOf(p);

  return sizes.length > 0 ? sizes.map((v) => offer(v)) : [offer(null)];
}

/** The list after an offer is tapped: one more of it, or a new row. */
export function taken(rows: Replacement[], offer: Offer): Replacement[] {
  if (offer.whyNot !== null) return rows;

  if (rows.some((r) => r.key === offer.key)) {
    return rows.map((r) => (r.key === offer.key ? { ...r, quantity: r.quantity + 1 } : r));
  }

  const { left: _left, whyNot: _whyNot, ...kept } = offer;
  void _left;
  void _whyNot;

  return [...rows, { ...kept, quantity: 1, serials: [] }];
}

/** One more or one fewer of a row; a row at nothing is taken off the list. */
export function changed(rows: Replacement[], key: string, by: number): Replacement[] {
  return rows
    .map((r) => (r.key === key ? { ...r, quantity: r.quantity + by } : r))
    .filter((r) => r.quantity > 0);
}

export interface ExchangeLine {
  product_id: string;
  variant_id?: string;
  quantity: number;
  serials?: string[];
}

/** What is sent: the product, the SIZE where there is one, and the numbers where there are any. */
export function linesOut(rows: Replacement[]): ExchangeLine[] {
  return rows
    .filter((r) => r.quantity > 0)
    .map((r) => {
      // The numbers of the units going out — for the units there are.
      const serials = r.serials.slice(0, r.quantity).map((n) => n.trim()).filter(Boolean);

      return {
        product_id: r.product_id,
        ...(r.variant_id !== null ? { variant_id: r.variant_id } : {}),
        quantity: r.quantity,
        ...(r.tracks_serial && serials.length > 0 ? { serials } : {}),
      };
    });
}

/**
 * What the replacements come to — the till's bill, not a sum of tags.
 *
 * An exchange is paid with the credit and, where it falls short, the
 * customer's own money: two tenders, which settle exactly and are never
 * rounded to a coin.
 */
export function replacementsTotal(rows: Replacement[], shop: { defaultTaxRate: number; taxInclusive: boolean }): number {
  return tillBill({
    lines: rows.map((r) => ({ unit_price: r.price, quantity: r.quantity, tax_rate: r.tax_rate, tax_group_rate: r.tax_group_rate })),
    group: null,
    defaultTaxRate: shop.defaultTaxRate,
    taxInclusive: shop.taxInclusive,
    discount: 0,
    tenders: ["other", "cash"],
    cashRounding: 0,
  }).total;
}

/** What is still to settle once the credit is taken off: positive to collect, negative to hand back. */
export const differenceOf = (total: number, credit: number): number => Math.round((total - credit) * 100) / 100;
