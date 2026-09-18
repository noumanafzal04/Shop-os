import { money, qtyText } from "@cartze/core/format";
import type { Order } from "../orders/services/ordersService";

/**
 * AN ORDER, AS FIXED-WIDTH TEXT.
 *
 * ── Why text and not a layout ────────────────────────────────────────
 *
 * Because every destination this can go to takes text and nothing else: a
 * WhatsApp message to the kitchen, a Bluetooth thermal printer, a share sheet.
 * A slip laid out with a view hierarchy would have to be rendered to an image
 * for two of those three, and a thermal printer cannot read an image at all
 * without a raster path nobody needs.
 *
 * ── Width is the SHOP's setting, not this app's guess ────────────────
 *
 * `receipt_width` is already a shop setting — `standard`, `thermal_80` or
 * `thermal_58` — set in the panel and used by the till. A phone that picked
 * its own width would produce a slip that does not match the one the counter
 * prints, for the same order.
 *
 * 58mm paper is 32 characters and 80mm is 48. `standard` means A4-ish, where
 * 48 is still readable and 32 looks like a mistake.
 */
export type ReceiptWidth = "standard" | "thermal_80" | "thermal_58";

export const columnsFor = (width: ReceiptWidth | undefined): number =>
  width === "thermal_58" ? 32 : 48;

/** A line with something at each end and dots between — "Total …… Rs 450". */
function spread(left: string, right: string, cols: number): string {
  const gap = cols - left.length - right.length;
  // A name long enough to collide with its price wraps rather than overlapping
  // it: two lines are readable, an overlap is a number nobody can trust.
  return gap >= 1 ? left + " ".repeat(gap) + right : `${left}\n${" ".repeat(Math.max(cols - right.length, 0))}${right}`;
}

/** Centre, without padding the right — trailing spaces waste thermal paper. */
const centre = (text: string, cols: number): string =>
  " ".repeat(Math.max(Math.floor((cols - text.length) / 2), 0)) + text;

const rule = (cols: number) => "-".repeat(cols);

/**
 * Wrap on WORDS, and fall back to hard-cutting a word longer than the paper.
 *
 * A product called "Chicken Handi Family Size" on 32-column paper is three
 * words and two lines; a barcode-ish SKU with no spaces is one word and has to
 * be cut, or the line silently overflows and the printer wraps it at a place
 * nobody chose.
 */
function wrap(text: string, cols: number): string[] {
  const out: string[] = [];
  let line = "";

  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (word.length > cols) {
      if (line) {
        out.push(line);
        line = "";
      }
      for (let i = 0; i < word.length; i += cols) out.push(word.slice(i, i + cols));
      continue;
    }
    if (!line) line = word;
    else if (line.length + 1 + word.length <= cols) line += ` ${word}`;
    else {
      out.push(line);
      line = word;
    }
  }

  if (line) out.push(line);
  return out.length > 0 ? out : [""];
}

export interface SlipOptions {
  shopName: string;
  width?: ReceiptWidth;
  /**
   * A KITCHEN slip, not a customer's.
   *
   * It carries what the kitchen needs — what to make, how many, any note — and
   * deliberately NOT the money. A cook does not price the order, and a total
   * on a kitchen docket is one more thing to read past.
   */
  kitchen?: boolean;
}

export function renderSlip(order: Order, options: SlipOptions): string {
  const cols = columnsFor(options.width);
  const lines: string[] = [];

  lines.push(centre(options.shopName, cols));
  lines.push(centre(options.kitchen ? "KITCHEN" : "ORDER", cols));
  lines.push(rule(cols));

  lines.push(spread(order.order_number, timeOf(order.placed_at), cols));
  lines.push(
    spread(
      order.fulfillment_type === "delivery"
        ? "Delivery"
        : order.fulfillment_type === "pickup"
          ? "Collection"
          : "Dine in",
      order.customer_name,
      cols,
    ),
  );

  if (!options.kitchen && order.customer_phone) lines.push(order.customer_phone);
  if (!options.kitchen && order.delivery_address) lines.push(...wrap(order.delivery_address, cols));

  lines.push(rule(cols));

  for (const item of order.items ?? []) {
    const qty = `${qtyText(item.quantity)}x`;
    const name = item.variant_name ? `${item.product_name} (${item.variant_name})` : item.product_name;

    if (options.kitchen) {
      // Quantity FIRST and loud. A cook reads down the left edge.
      lines.push(...wrap(`${qty} ${name}`, cols));
    } else {
      const wrapped = wrap(`${qty} ${name}`, cols - 10);
      wrapped.forEach((text, i) => {
        lines.push(i === wrapped.length - 1 ? spread(text, money(item.line_total), cols) : text);
      });
    }

    const mods = (item.modifiers ?? [])
      .map((m) => m.option ?? m.name)
      .filter(Boolean)
      .join(", ");
    // Indented under their item, because a modifier belongs to the line above
    // and a flat list reads as another thing to make.
    if (mods) lines.push(...wrap(`  + ${mods}`, cols));
  }

  lines.push(rule(cols));

  if (options.kitchen) {
    if (order.notes) {
      lines.push("NOTE:");
      lines.push(...wrap(order.notes, cols));
    }
  } else {
    lines.push(spread("Subtotal", money(order.subtotal), cols));
    if (Number(order.delivery_fee) > 0) {
      lines.push(spread("Delivery", money(order.delivery_fee), cols));
    }
    lines.push(spread("TOTAL", money(order.total), cols));
    lines.push(
      spread(
        order.payment_method === "cod" ? "Cash on delivery" : "Paid",
        order.payment_status,
        cols,
      ),
    );
    if (order.notes) {
      lines.push(rule(cols));
      lines.push(...wrap(order.notes, cols));
    }
  }

  return lines.join("\n");
}

const timeOf = (iso: string): string => {
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : "";
};
