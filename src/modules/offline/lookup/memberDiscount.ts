import { getAll } from "../db/repo";
import { STORE } from "../db/schema";
import type { CatalogCustomer, CatalogCustomerGroup } from "../sync/catalogService";

/**
 * Does the customer at the counter belong to a group that owes them a discount?
 *
 * ── The hole this closes ────────────────────────────────────────────────
 *
 * The server ships `customer_group_id` on every cached customer and the groups
 * themselves with their `discount_percent`, and says exactly why:
 *
 *     "The group is here only because pricing cannot work without it."
 *
 * The till stored both and **nothing ever read them.** `priceCart` says
 * customer-group discounts are absent — deliberately, as part of the offline
 * allow-list — but `canSellOffline` never refused a member either. So a
 * customer in a 10%-off group served during an outage was charged the full
 * price, on a printed receipt, and nobody found out.
 *
 * It is a PARTIAL implementation, which is worse than none: a group's price
 * LEVEL is honoured (`priceCart` prices wholesale correctly), so groups look
 * handled right up until the one that carries a percentage.
 *
 * ── Why this refuses rather than pricing it ─────────────────────────────
 *
 * The same answer the bank offer got, one field away in the same file, for the
 * same reason: *a receipt wrong by the whole discount is discovered by the
 * customer days later, with no way to check.* The refusal is about what this
 * till currently KNOWS, not about what the rule permits — a group percentage is
 * a rule the shop wrote down in advance and could one day be mirrored, exactly
 * as promotions were.
 *
 * ── Why only groups with a PERCENTAGE ───────────────────────────────────
 *
 * A group that merely sets a price level prices correctly offline today.
 * Refusing every group member would take wholesale customers off the till
 * during an outage for no reason at all — and a refusal nobody needed is how
 * the whole offline feature gets a reputation for not working.
 */

/** A phone reduced to its digits, so 0300-1234567 and +923001234567 agree. */
const digits = (phone: string): string => phone.replace(/\D/g, "");

/**
 * The percentage this phone number's group owes, or 0.
 *
 * Matched on the last 10 digits: a shop types 0300… and the record may hold
 * +92300…, and a customer standing at the counter is not going to be told
 * their discount vanished over a country code.
 */
export async function memberDiscountFor(phone: string | null | undefined): Promise<number> {
  const wanted = digits(phone ?? "");
  if (wanted.length < 7) return 0;

  const tail = wanted.slice(-10);

  const customers = await getAll<CatalogCustomer>(STORE.CUSTOMERS);
  const match = customers.find(
    (c) => c.phone != null && digits(c.phone).slice(-10) === tail,
  );

  if (match?.customer_group_id == null) return 0;

  const groups = await getAll<CatalogCustomerGroup>(STORE.CUSTOMER_GROUPS);
  const group = groups.find((g) => g.id === match.customer_group_id);

  return Number(group?.discount_percent ?? 0) || 0;
}
