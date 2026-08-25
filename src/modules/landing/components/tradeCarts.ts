import type { TradeCode } from "./tradeIcon";

/**
 * WHAT EACH TRADE'S TILL ACTUALLY HAS ON IT.
 *
 * The landing page's claim is that this thing knows the difference between a
 * restaurant and a tyre shop. A grid of eight icons under a sentence saying so
 * is the claim; showing the till change is the evidence — and it costs a
 * visitor one tap to check.
 *
 * Real items at real Pakistani prices, in each trade's own units. A pharmacy
 * sells a strip, a pump sells litres, a salon sells an hour. The unit is the
 * tell: it is the first thing a shopkeeper looks at to decide whether whoever
 * built this has ever stood behind a counter.
 *
 * Everything a trade says about itself lives here — its name, its cart, the
 * one line only it needs, and what the product does for it. It was split
 * across this file and the page before, which is how a trade ends up with a
 * pharmacy's cart under a tyre shop's heading.
 */
export type Line = { name: string; qty: string; price: number };

export type TradeCart = {
  /** What a shopkeeper in this trade would call themselves. */
  label: string;
  /**
   * The place, as a phrase that can follow "What it does". Written out per
   * trade rather than derived from the label: chopping "Restaurant & café"
   * down to its first word and adding "shop" produced "in a restaurant shop",
   * and on the forecourt it produced "in a petrol pump shop".
   */
  where: string;
  register: string;
  lines: Line[];
  /** The one detail that belongs to this trade and no other. */
  note: string;
  /** What it does here that a general till does not do anywhere. */
  does: string[];
};

export const TRADE_CART: Record<TradeCode, TradeCart> = {
  food: {
    label: "Restaurant & café",
    where: "in a restaurant",
    register: "Counter 1",
    lines: [
      { name: "Chicken Karahi", qty: "1 plate", price: 1450 },
      { name: "Garlic Naan", qty: "4 pcs", price: 320 },
      { name: "Mineral Water", qty: "2 btl", price: 160 },
    ],
    note: "Sent to the kitchen as KOT #24",
    does: [
      "Tables and tabs — a bill belongs to the waiter who opened it",
      "The kitchen sees the order on its own screen, not on paper",
      "A large karahi uses more chicken, and the recipe knows it",
      "Sold out is one tap, and every door respects it",
    ],
  },
  mart: {
    label: "Mart & grocery",
    where: "in a grocery",
    register: "Lane 2",
    lines: [
      { name: "Sugar", qty: "2 kg", price: 360 },
      { name: "Tea (500g)", qty: "1 pack", price: 1150 },
      { name: "Cooking Oil", qty: "5 L", price: 3100 },
    ],
    note: "Weighed on the counter scale",
    does: [
      "Loose weight and sealed packs off the same stock",
      "Barcode in, price out — including your own printed labels",
      "Khata that adds up, with a statement the customer can read",
      "Deals and buy-one-get-one that the till applies itself",
    ],
  },
  pharmacy: {
    label: "Pharmacy",
    where: "in a pharmacy",
    register: "Dispensary",
    lines: [
      { name: "Panadol 500mg", qty: "2 strips", price: 90 },
      { name: "Cough Syrup", qty: "1 btl", price: 260 },
      { name: "ORS Sachet", qty: "6 pcs", price: 210 },
    ],
    note: "Batch B-7741 · expires Mar 2027",
    does: [
      "Every strip carries its batch, and its batch carries an expiry",
      "Nearest expiry leaves first, without anyone choosing it",
      "Schedule-controlled medicine needs the prescription — at the counter and online",
      "You are told once per lot that it is nearing expiry, not every morning",
    ],
  },
  retail: {
    label: "Retail store",
    where: "on a shop floor",
    register: "Till 1",
    lines: [
      { name: "Cotton Shirt — L", qty: "2 pcs", price: 4800 },
      { name: "Denim Jeans — 32", qty: "1 pc", price: 3800 },
      { name: "Leather Belt", qty: "1 pc", price: 1500 },
    ],
    note: "Size and colour counted separately",
    does: [
      "Size and colour are stock in their own right, each with its own code",
      "Serial and IMEI captured as it is sold, and again when it comes back",
      "Warranty desk that can find the sale from the serial alone",
      "Returns and exchanges that put the right size back on the shelf",
    ],
  },
  services: {
    label: "Salon & services",
    where: "in a salon",
    register: "Chair 2",
    lines: [
      { name: "Haircut", qty: "1 hr", price: 800 },
      { name: "Beard Trim", qty: "30 min", price: 400 },
      { name: "Head Massage", qty: "1 hr", price: 1200 },
    ],
    note: "An hour is stock too",
    does: [
      "Sell time the same way you sell a thing — no stock to run out of",
      "Products used on the chair still come off the shelf",
      "Who did the work, and what they are owed for it",
      "Regulars, their history, and what they usually ask for",
    ],
  },
  automotive: {
    label: "Auto & tyre",
    where: "in a workshop",
    register: "Bay 1",
    lines: [
      { name: "Tyre 195/65 R15", qty: "2 pcs", price: 29000 },
      { name: "Engine Oil", qty: "4 L", price: 6800 },
      { name: "Fitting", qty: "1 job", price: 1200 },
    ],
    note: "Oldest DOT stock leaves first",
    does: [
      "The vehicle is the record — every job it has ever had, under its number",
      "Tyres age on the shelf, so the oldest DOT week is the one that sells",
      "A trade-in is money taken off the bill, not a discount off the price",
      "A bay board that shows what is on the ramp and what is waiting",
    ],
  },
  petroleum: {
    label: "Petrol pump",
    where: "on a forecourt",
    register: "Pump 3",
    lines: [
      { name: "Petrol", qty: "18.4 L", price: 5005 },
      { name: "Engine Oil", qty: "1 L", price: 1900 },
    ],
    note: "Meter 84,219 → 84,237",
    does: [
      "Litres come off the meter roll, not off somebody's memory",
      "Tank dips at open and close, with the difference explained",
      "Tomorrow's rate takes effect tomorrow, never tonight",
      "Shift handover that hands over the cash as well as the pump",
    ],
  },
  finance: {
    label: "Finance & office",
    where: "in an office",
    register: "Desk",
    lines: [
      { name: "Tax Filing", qty: "1 job", price: 15000 },
      { name: "Book-keeping", qty: "1 month", price: 25000 },
    ],
    note: "Posted to this month's ledger",
    does: [
      "Every rupee in and out, against the job it belongs to",
      "Recurring fees that fall due and post themselves",
      "Expenses with the receipt attached, and a budget to answer to",
      "Your own tax year — July to June — beside the calendar one",
    ],
  },
};

/** One formatter, so no two places round a rupee differently. */
export function rupees(n: number): string {
  return n.toLocaleString("en-PK");
}

export function cartTotal(cart: TradeCart): number {
  return cart.lines.reduce((sum, line) => sum + line.price, 0);
}
