import { get, getAll, getSingleton } from "../db/repo";
import { STORE } from "../db/schema";
import { deviceId } from "../device/deviceId";
import { priceCart, type CartLine } from "../pricing/priceCart";
import type { CatalogItem, CatalogTaxGroup } from "../sync/catalogService";
import { canSellOffline, refusalsFor, type OfflineCart } from "./canSellOffline";
import { enqueue, newRow } from "./outbox";
import { nextOfflineNumber } from "./receiptNumber";

/**
 * Completing a sale with no server.
 *
 * The cashier presses Complete, the drawer opens, the slip prints, the customer
 * leaves. Nothing about that may wait for a network — so everything this does
 * is local, and the only thing it needs to be right about is that the sale is
 * SAFELY WRITTEN before the cashier is told it succeeded.
 *
 * ── Why the totals here are a receipt and not an answer ─────────────────
 *
 * The figures are computed by the same engine Phase 2 spent a fortnight
 * proving, so the slip a customer carries out is right. They are still not
 * authoritative: on sync the server prices the cart again from its own catalog
 * and its figure is the one that goes in the books. That is deliberate and it
 * is why no price is ever sent — see `PosSyncController`.
 *
 * A disagreement between the two would be a Phase 2 failure showing up late,
 * which is exactly what the shadow tally was built to make impossible to miss.
 *
 * ── The order of the three writes ───────────────────────────────────────
 *
 *   1. take the next receipt number      (persisted before it is used)
 *   2. write the sale to the outbox      (the money is now safe)
 *   3. tell the cashier                  (only now)
 *
 * Reversed, a crash between 2 and 3 would leave the shop holding a sale the
 * cashier believed had failed — and they would ring it again.
 */

export interface OfflineSaleInput {
  /** Exactly the payload the online path would have POSTed. */
  sale: Record<string, unknown>;
  /** The cart, in the shape the local pricing engine takes. */
  lines: CartLine[];
  /** Whole-bill discount, as the cashier keyed it. */
  cartDiscount: number;
  /** For the allow-list, and for the words the cashier is shown. */
  guard: OfflineCart;
  /** The lane this till stands at, for the receipt number. */
  registerName: string | null;
  /** When this device last reached the server. */
  offlineSince: string | null;
  /**
   * Was the shift this till is standing at a PRACTICE one?
   *
   * Recorded because the server will not take the shift's word alone for a
   * synced sale: a shift id named by a client, hours after the fact, would
   * otherwise be enough to make a real sale take no stock and earn no
   * revenue, with none of the warnings a cashier sees online. Both have to
   * agree. This can only withhold practice, never grant it.
   */
  training: boolean;
}

/** What the POS gets back — deliberately the shape of a server sale. */
export interface OfflineSale {
  id: string;
  invoice_number: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  payment_method: string | null;
  /** The flag every server-dependent step downstream checks. */
  offline: true;
}

export class OfflineRefused extends Error {
  constructor(public readonly reasons: string[]) {
    super(reasons[0] ?? "This sale can't be rung while the internet is down.");
    this.name = "OfflineRefused";
  }
}

/**
 * Price the cart from what this till actually holds.
 *
 * The same path the shadow check has been exercising on every sale since Phase
 * 2 — which is the point. By the time a till is allowed to sell offline, this
 * function has already been run thousands of times against a server that
 * disagreed with it zero times.
 */
export async function priceLocally(
  lines: CartLine[],
  cartDiscount: number,
): Promise<{ subtotal: number; discount: number; tax: number; total: number }> {
  const settings = await getSingleton<Record<string, unknown>>(STORE.SETTINGS);
  if (settings === undefined) {
    throw new OfflineRefused([
      "This till hasn't finished downloading the shop's settings, so it can't price a sale yet.",
    ]);
  }

  const priced = priceCart(
    lines,
    {
      default_tax_rate: Number(settings.default_tax_rate ?? 0),
      tax_inclusive: Boolean(settings.tax_inclusive),
    },
    cartDiscount,
  );

  return {
    subtotal: priced.subtotal,
    discount: priced.discount,
    tax: priced.tax,
    total: priced.total,
  };
}

/**
 * Build the priced lines from the till's own catalog.
 *
 * Anything the till has not been told about stops the sale rather than being
 * guessed at. A cart priced from a gap is a wrong receipt, and a wrong receipt
 * offline is discovered by a customer, days later, with no way to check.
 */
export interface CatalogPricing {
  lines: CartLine[];
  /**
   * The same lines as the allow-list sees them.
   *
   * Read HERE rather than carried down from the POS cart, because
   * `offline_ok` is the server's own verdict and the local catalog is where it
   * arrives. Threading it through the cart would mean every place that adds a
   * line has to remember to bring it, and the one that forgets sells a
   * medicine offline.
   */
  guardLines: Array<{ name: string; offline_ok?: boolean }>;
}

export async function linesFromCatalog(
  items: Array<{
    product_id: string;
    variant_id?: string | null;
    quantity: number;
    price_level?: "retail" | "wholesale";
    discountValue?: number;
    discountMode?: "amt" | "pct";
    modifierDelta?: number;
  }>,
): Promise<CatalogPricing> {
  const taxGroups = new Map(
    (await getAll<CatalogTaxGroup>(STORE.TAX_CONFIG)).map((g) => [g.id, g.rate]),
  );

  const lines: CartLine[] = [];
  const guardLines: CatalogPricing["guardLines"] = [];
  for (const line of items) {
    const item = await get<CatalogItem>(STORE.CATALOG, line.product_id);
    if (item === undefined) {
      throw new OfflineRefused([
        "One of these items hasn't reached this till yet, so it can't be priced offline.",
      ]);
    }

    const variant = line.variant_id
      ? item.variants.find((v) => v.id === line.variant_id)
      : undefined;
    if (line.variant_id && variant === undefined) {
      throw new OfflineRefused([
        "One of these items' options hasn't reached this till yet, so it can't be priced offline.",
      ]);
    }

    lines.push({
      item: {
        price: variant ? variant.price : item.price,
        // A sale price is product-level and does not apply to a variant —
        // the server's rule, mirrored rather than approximated.
        discount_price: variant ? null : item.discount_price,
        wholesale_price: variant ? null : item.wholesale_price,
        price_tiers: variant ? null : item.price_tiers,
        tax_rate: item.tax_rate,
        tax_group_rate: item.tax_group_id ? (taxGroups.get(item.tax_group_id) ?? null) : null,
      },
      quantity: line.quantity,
      priceLevel: line.price_level ?? "retail",
      modifierDelta: line.modifierDelta ?? 0,
      lineDiscountPct: line.discountMode === "pct" ? (line.discountValue ?? null) : null,
      lineDiscount: line.discountMode === "amt" ? (line.discountValue ?? null) : null,
    });

    guardLines.push({ name: item.name, offline_ok: item.offline_ok });
  }

  return { lines, guardLines };
}

/**
 * Ring it, queue it, and hand back something the POS can print.
 *
 * Throws `OfflineRefused` when this cart is not one a single till may decide.
 * That refusal has to reach the cashier BEFORE the drawer opens, which is why
 * it is thrown rather than reported.
 */
export async function completeOffline(input: OfflineSaleInput): Promise<OfflineSale> {
  if (!canSellOffline(input.guard)) {
    throw new OfflineRefused(refusalsFor(input.guard).map((r) => r.reason));
  }

  const totals = await priceLocally(input.lines, input.cartDiscount);
  const op = crypto.randomUUID();
  const offlineNumber = await nextOfflineNumber(input.registerName, deviceId());

  // The money is safe from here. Everything after this is presentation.
  await enqueue(
    newRow(
      op,
      new Date().toISOString(),
      offlineNumber,
      input.sale,
      input.offlineSince,
      input.training,
    ),
  );

  return {
    id: op,
    invoice_number: offlineNumber,
    ...totals,
    payment_method: (input.sale.payment_method as string | undefined) ?? null,
    offline: true,
  };
}
