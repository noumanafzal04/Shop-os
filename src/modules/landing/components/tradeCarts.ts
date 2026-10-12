import type { TradeCode } from "./tradeIcon";

/**
 * WHAT EACH TRADE GETS — and what its own till looks like.
 *
 * The landing page's claim is that this thing knows the difference between a
 * restaurant and a tyre shop. A grid of icons under a sentence saying so is
 * the claim; showing the till change is the evidence — and it costs a visitor
 * one tap to check.
 *
 * ── The till is a photograph now ─────────────────────────────────────
 *
 * It was a drawing: a dark card built out of divs with three invented lines
 * on it ("Haircut — 1 hr"). The owner's word for it was the right one —
 * "jo mobile khud bana rahe wo acha nahi laga" — and the hero had already
 * made the argument: a drawing of the product is not the product. So each
 * trade carries the phone screen of a real shop of that trade
 * (`public/landing/trade-<code>.webp`), taken by `scripts/landing-shots.mjs`.
 * A finance office has no till, and is not given one: its picture is its
 * books.
 *
 * Everything a trade says about itself lives here — its name, the one line
 * only it needs, what the product does for it, and what its picture shows.
 * It was split across this file and the page before, which is how a trade
 * ends up with a pharmacy's picture under a tyre shop's heading.
 */
export type TradeCart = {
  /** What a shopkeeper in this trade would call themselves. */
  label: string;
  /**
   * The same in a word — what fits under an icon on a tile. Nine tiles stand
   * in one row, and "Wholesale & distribution" is wider than a ninth of it.
   * Always the first word or two of `label`, so the tile's visible name is
   * inside the name a screen reader is given.
   */
  short: string;
  /**
   * The place, as a phrase that can follow "What it does". Written out per
   * trade rather than derived from the label: chopping "Restaurant & café"
   * down to its first word and adding "shop" produced "in a restaurant shop",
   * and on the forecourt it produced "in a petrol pump shop".
   */
  where: string;
  /** The one detail that belongs to this trade and no other. */
  note: string;
  /** What it does here that a general till does not do anywhere. */
  does: string[];
  /** What the photograph shows, for whoever cannot see it. */
  shows: string;
};

export const TRADE_CART: Record<TradeCode, TradeCart> = {
  food: {
    label: "Restaurant & café",
    short: "Restaurant",
    where: "in a restaurant",
    note: "Sent to the kitchen as KOT #24",
    does: [
      "Tables and tabs — a bill belongs to the waiter who opened it",
      "The kitchen sees the order on its own screen, not on paper",
      "A large karahi uses more chicken, and the recipe knows it",
      "Sold out is one tap, and every door respects it",
    ],
    shows: "A restaurant's till on a phone: dishes as tiles, three on the bill, the tax worked out, the total and the Pay button.",
  },
  mart: {
    label: "Mart & grocery",
    short: "Mart",
    where: "in a grocery",
    note: "Weighed on the counter scale",
    does: [
      "Loose weight and sealed packs off the same stock",
      "Barcode in, price out — including your own printed labels",
      "Khata that adds up, with a statement the customer can read",
      "Deals and buy-one-get-one that the till applies itself",
    ],
    shows: "A grocery's till on a phone: packs by the kilo with their stock, three in the basket with an offer taken off, the total and the Pay button.",
  },
  pharmacy: {
    label: "Pharmacy",
    short: "Pharmacy",
    where: "in a pharmacy",
    note: "Batch B-7741 · expires Mar 2027",
    does: [
      "Every strip carries its batch, and its batch carries an expiry",
      "Nearest expiry leaves first, without anyone choosing it",
      "Schedule-controlled medicine needs the prescription — at the counter and online",
      "You are told once per lot that it is nearing expiry, not every morning",
    ],
    shows: "A pharmacy's till on a phone: medicines by strength with their stock, a sold-out one offering the same salt instead, three in the sale and the total.",
  },
  retail: {
    label: "Retail store",
    short: "Retail",
    where: "on a shop floor",
    note: "Size and colour counted separately",
    does: [
      "Size and colour are stock in their own right, each with its own code",
      "Serial and IMEI captured as it is sold, and again when it comes back",
      "Warranty desk that can find the sale from the serial alone",
      "Returns and exchanges that put the right size back on the shelf",
    ],
    shows: "A clothing shop's till on a phone: designs with their stock, three sold by size with an offer taken off, the total, and a Quote button.",
  },
  wholesale: {
    label: "Wholesale & distribution",
    short: "Wholesale",
    where: "in a wholesale market",
    note: "On Madina Store's account — limit Rs 500,000",
    does: [
      "A carton has its own price and its own barcode, and counts as twelve on the shelf",
      "Buy more, pay less: quantity breaks apply themselves",
      "Every dealer has an account, a limit, and a statement you can hand over",
      "Stock comes into the warehouse and goes out to where it is sold",
    ],
    shows: "A wholesaler's till on a phone: fifty-kilo bags with their stock, three in the sale with a quantity discount, the total, and a Quote button.",
  },
  services: {
    // SERVICES — not "Salon & services". A salon is one of them; so is the
    // tailor, the laundry, the AC man and the repair counter, and the trade
    // in the product is called Services. The owner: "salon ni, services hain".
    label: "Services",
    short: "Services",
    where: "in a service business",
    note: "A job is sold like a thing — and never runs out",
    does: [
      "Sell time the same way you sell a thing — no stock to run out of",
      "Parts and materials used on the job still come off the shelf",
      "Who did the work, and what they are owed for it",
      "Regulars, their history, and what they usually ask for",
    ],
    shows: "A service centre's till on a phone: jobs such as an AC service, a laundry wash and suit stitching, three on the bill, the total, and a Quote button.",
  },
  automotive: {
    label: "Auto & tyre",
    short: "Auto",
    where: "in a workshop",
    note: "Oldest DOT stock leaves first",
    does: [
      "The vehicle is the record — every job it has ever had, under its number",
      "Tyres age on the shelf, so the oldest DOT week is the one that sells",
      "A trade-in is money taken off the bill, not a discount off the price",
      "A bay board that shows what is on the ramp and what is waiting",
    ],
    shows: "A workshop's till on a phone: parts for a Suzuki Mehran with their stock, three on the bill, the total, and a Quote button.",
  },
  petroleum: {
    label: "Petrol pump",
    short: "Petrol pump",
    where: "on a forecourt",
    note: "Meter 84,219 → 84,237",
    does: [
      "Litres come off the meter roll, not off somebody's memory",
      "Tank dips at open and close, with the difference explained",
      "Tomorrow's rate takes effect tomorrow, never tonight",
      "Shift handover that hands over the cash as well as the pump",
    ],
    shows: "A petrol pump's till on a phone: petrol, diesel and hi-octane priced by the litre above the shop's engine oils, three in the sale and the total.",
  },
  finance: {
    label: "Finance & office",
    short: "Finance",
    where: "in an office",
    note: "Posted to this month's ledger",
    does: [
      "Every rupee in and out, against the job it belongs to",
      "Recurring fees that fall due and post themselves",
      "Expenses with the receipt attached, and a budget to answer to",
      "Your own tax year — July to June — beside the calendar one",
    ],
    shows: "A finance office's home screen on a phone: record income, record expense, reports and the cashbook, and the month's money in, a bar a day.",
  },
};
