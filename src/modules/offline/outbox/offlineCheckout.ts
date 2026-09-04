import { get, getAll, getSingleton } from "../db/repo";
import { STORE } from "../db/schema";
import { driftMs, shopNow } from "../clock";
import { hoursSinceContact } from "../contact";
import { deviceId } from "../device/deviceId";
import { priceCart, type CartLine } from "../pricing/priceCart";
import type { CatalogItem, CatalogPromotion, CatalogTaxGroup } from "../sync/catalogService";
import { unsupportedPromotions } from "../pricing/bestPromotion";
import {
  canSellOffline,
  OFFLINE_SELLING_OFF,
  OFFLINE_TOO_LONG,
  PROMOTION_TOO_NEW,
  refusalsFor,
  type OfflineCart,
} from "./canSellOffline";
import { enqueue, newRow } from "./outbox";
import { nextOfflineNumber } from "./receiptNumber";
import { uuid } from "../../../common/uuid";

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
  /**
   * WHICH SHOP is signed in as this is rung.
   *
   * Stamped on the row so a browser used for two tenants can never flush one
   * shop's sales into the other's books — see `belongsHere` in the outbox.
   */
  tenantId: string | null;
  /**
   * WHO is standing at this till.
   *
   * Not the same person who will send it. A sale rung by the morning cashier
   * is routinely flushed by the evening one, or by a manager clearing a queue
   * after a week's outage — and the server stamps `created_by` from whoever
   * is authenticated, so without this one cashier's whole day lands in
   * another's staff report. Recorded at the moment Complete is pressed,
   * because that is the only moment it is known.
   */
  rungBy: string | null;
  /**
   * When the cashier started building this cart, in epoch ms.
   *
   * Only the hard stop reads it, and only so that a ceiling reached mid-cart
   * does not refuse a sale with the goods already on the counter. Null when the
   * caller does not track it, which reads as "judge it from now".
   */
  cartStartedAt: number | null;
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
 * Has this shop been granted offline selling at all?
 *
 * Read from the catalog's settings, which is where the switch arrives — the
 * one call a till makes WHILE IT STILL HAS a connection, and therefore the only
 * moment the answer can change hands.
 *
 * `=== true` and a swallowed error both fall the same way: OFF. A till that
 * cannot read its own settings has no business deciding it may trade blind,
 * and a shop that has not been granted this must never get it by accident.
 */
export async function offlineSellingAllowed(): Promise<boolean> {
  try {
    const settings = await getSingleton<Record<string, unknown>>(STORE.SETTINGS);

    return settings?.offline_selling === true;
  } catch {
    return false;
  }
}

/**
 * Has this till been away longer than the shop is willing to trade blind for?
 *
 * ── Judged from when the CART was started, not from now ─────────────────
 *
 * The cashier has the goods on the counter and the customer in front of them.
 * A ceiling that trips between the first scan and Complete would refuse a sale
 * halfway through, with no way to finish it and nothing the cashier can do —
 * the exact failure offline selling exists to prevent. So the question asked is
 * "was this shop still allowed to trade when this cart began", and a cart that
 * was allowed to start is always allowed to finish.
 *
 * `cartStartedAt` of null means the caller does not track it, and then this is
 * judged from now. That is the honest reading of "we don't know when this
 * began" and it is what a test calling `completeOffline` directly gets.
 *
 * ── Which way the doubts fall, and why it is the OTHER way ──────────────
 *
 * Every other guard on this path falls towards refusing. This one falls
 * towards SELLING: no ceiling set, an unreadable setting, a till that has never
 * heard from the server at all — each means "no ceiling I can prove", and a
 * counter closed over a number nobody chose is a loss with no risk behind it.
 * The risk this guards against is a stale catalog, which is real but slow; the
 * risk of refusing wrongly arrives immediately, at the counter.
 */
export async function pastHardStop(cartStartedAt: number | null = null): Promise<boolean> {
  try {
    const settings = await getSingleton<Record<string, unknown>>(STORE.SETTINGS);
    const days = Number(settings?.offline_hard_stop_days);
    if (!Number.isFinite(days) || days <= 0) return false;

    const hours = hoursSinceContact(cartStartedAt ?? Date.now());
    if (hours === null) return false;

    return hours > days * 24;
  } catch {
    return false;
  }
}

/**
 * A live promotion this till cannot work out.
 *
 * Checked per sale rather than once at boot, because a promotion can be
 * switched on from the office in the middle of a trading day and the catalog
 * pull that carries it is the till's only warning.
 *
 * Judged against SERVER time with the till's drift applied, and the shop's own
 * timezone — the same clock the engine itself uses, or a shop could be refused
 * over an evening promotion at two in the afternoon.
 */
export async function unpriceableOffer(): Promise<boolean> {
  try {
    const settings = await getSingleton<Record<string, unknown>>(STORE.SETTINGS);
    const promotions = await getAll<CatalogPromotion>(STORE.PROMOTIONS);

    return (
      unsupportedPromotions(promotions, await shopNow(), String(settings?.timezone ?? "Asia/Karachi"))
        .length > 0
    );
  } catch {
    // A till that cannot read its own promotions cannot promise it applies
    // them. Same direction as every other doubt on this path.
    return true;
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
      // The shop's automatic promotions, judged against SERVER time with this
      // till's measured drift applied — never the tablet's own clock, which
      // would run a flash sale that ended on Tuesday.
      promotions: await getAll<CatalogPromotion>(STORE.PROMOTIONS),
      now: await shopNow(),
      timezone: String(settings.timezone ?? "Asia/Karachi"),
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
    /** Money named instead of a quantity — see CartLine.amountAsked. */
    amountAsked?: number;
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
        // Which product and category — the promotion rules scope by one or the
        // other, and a line that cannot say what it is matches nothing.
        id: item.id,
        category_id: item.category_id,
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
      amountAsked: line.amountAsked ?? null,
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
  // The shop's own switch, checked before the cart's contents. It is not a
  // fact about this sale — it is whether these tills may sell with no server
  // at all — so answering "your cart contains a medicine" to a shop that was
  // never granted offline selling would send a cashier removing items to fix
  // something no cart can fix.
  if (!(await offlineSellingAllowed())) {
    throw new OfflineRefused([`${OFFLINE_SELLING_OFF.reason} ${OFFLINE_SELLING_OFF.fix}`]);
  }

  // A promotion the engine cannot evaluate is not a smaller discount — it is
  // a receipt wrong on every cart it touches. Refused for the SHOP, like the
  // switch above, because no cart can be rearranged to fix it.
  if (await unpriceableOffer()) {
    throw new OfflineRefused([`${PROMOTION_TOO_NEW.reason} ${PROMOTION_TOO_NEW.fix}`]);
  }

  // The shop's own ceiling on trading blind, measured from when this cart was
  // STARTED — a cart that was allowed to begin is always allowed to finish.
  if (await pastHardStop(input.cartStartedAt)) {
    throw new OfflineRefused([`${OFFLINE_TOO_LONG.reason} ${OFFLINE_TOO_LONG.fix}`]);
  }

  if (!canSellOffline(input.guard)) {
    throw new OfflineRefused(refusalsFor(input.guard).map((r) => r.reason));
  }

  const totals = await priceLocally(input.lines, input.cartDiscount);
  // `uuid()`, never `crypto.randomUUID()` directly. That API exists only in a
  // SECURE CONTEXT, so on a shop served over plain http it is undefined and
  // this line throws — before the sale is queued, with the goods already on the
  // counter. The helper falls back to `getRandomValues`, which works over http.
  const op = uuid();
  const offlineNumber = await nextOfflineNumber(input.registerName, deviceId());

  // ── The moment, on two clocks ─────────────────────────────────────────
  //
  // `at` is the shop's, and it is the one that becomes `sold_at` — the trading
  // day, the shift, the cashier's figures, the day-close check. A tablet three
  // days out would otherwise file every sale of the outage into days that were
  // counted and banked before the cut even started.
  //
  // `clientAt` is the tablet's own, uncorrected, and it is kept for the shop
  // rather than for the books: a correction nobody can see is a clock that
  // never gets set. `offlineSince` moves by the same offset because it was
  // stamped from the same wrong clock, and it is the FLOOR the server measures
  // this sale against — leaving one corrected and the other not would hand the
  // server two numbers that no longer describe the same day.
  const drift = await driftMs();
  const clientAt = Date.now();

  // The money is safe from here. Everything after this is presentation.
  await enqueue(
    newRow(
      op,
      new Date(clientAt + drift).toISOString(),
      offlineNumber,
      input.sale,
      input.offlineSince === null
        ? null
        : new Date(new Date(input.offlineSince).getTime() + drift).toISOString(),
      {
        training: input.training,
        tenantId: input.tenantId,
        clientAt: new Date(clientAt).toISOString(),
        rungBy: input.rungBy,
      },
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
