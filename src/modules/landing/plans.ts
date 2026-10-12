import { counted } from "../../common/format/counted";
import { numberIn, PKR } from "../../common/format/currency";

/**
 * THE PLANS THE PAGE SELLS ARE THE PLANS THE PRODUCT HAS.
 *
 * The page offered three — Basic at 2,500, "Premium" at 6,000, Enterprise at
 * 15,000 — with points written by hand: "Up to 2 tills" on a plan that allows
 * one, "Online orders & delivery" as if a plan granted it. The product has
 * four, at other prices, and a plan grants no module at all. A shopkeeper who
 * rang about the price on the page was quoted a different one.
 *
 * So these are `PlanSeeder`'s four — the name, the price and every figure —
 * and the points on each card are WRITTEN FROM the figures, not beside them.
 * The line under the name is the only thing that is copy.
 *
 * ── What is listed, and what is not ──────────────────────────────────
 *
 * The six things a buyer asks on the phone, which are the six the ladder
 * differs in: branches, staff, tills, bills a month, history, and selling
 * with no internet — plus how many products, because it is the first ceiling
 * a growing shop meets. Storage and warehouses are real limits and are not
 * here: nobody chooses a plan by them.
 *
 * Modules are not on a card, because no plan has them or lacks them: a
 * capability is switched on per shop, by its trade. They are listed once,
 * under all four, as what every plan comes with.
 *
 * ── Keeping them true ────────────────────────────────────────────────
 *
 * A stylesheet cannot read TypeScript and this file cannot read PHP, so
 * `plans.test.ts` reads the seeder as text and fails — naming the plan and
 * the figure — when the two part. The Super Admin can reprice a plan on a
 * live box; this page is then wrong until it is changed, and says the seeded
 * price. That is the cost of a page that paints without asking a server.
 */
export interface LandingPlan {
  /** The plan's code in the product — `premium` is the one named Standard. */
  code: "basic" | "premium" | "pro" | "enterprise";
  name: string;
  /** A month, in the platform's own currency. */
  price: number;
  /** The one line that is copy. */
  line: string;
  branches: number;
  staff: number;
  tills: number;
  /** Bills a month. Null: not metered. */
  bills: number | null;
  /** Null: no ceiling. */
  products: number | null;
  /** Months of history kept. Null: kept for good. */
  historyMonths: number | null;
  /** Days a till may go on selling with no line. Null: not in this plan. */
  offlineDays: number | null;
  featured?: boolean;
}

export const PLANS: LandingPlan[] = [
  {
    code: "basic", name: "Basic", price: 2499,
    line: "One shop, one counter.",
    branches: 1, staff: 3, tills: 1, bills: 5000, products: 1000, historyMonths: 24, offlineDays: null,
  },
  {
    code: "premium", name: "Standard", price: 4999,
    line: "A few branches and a team.",
    branches: 3, staff: 10, tills: 3, bills: 20000, products: 10000, historyMonths: 60, offlineDays: 3,
    featured: true,
  },
  {
    code: "pro", name: "Pro", price: 7999,
    line: "A chain, with room to grow.",
    branches: 10, staff: 25, tills: 8, bills: 100000, products: null, historyMonths: 120, offlineDays: 7,
  },
  {
    code: "enterprise", name: "Enterprise", price: 15000,
    line: "Sized to the organisation.",
    branches: 50, staff: 200, tills: 50, bills: null, products: null, historyMonths: null, offlineDays: 14,
  },
];

/** A figure with its thousands marked, the way the platform's own prices are: 5,000. */
const grouped = (n: number): string => numberIn(PKR, n, 0);

/** One line on a plan's card. `off`: said, and not included — never left out. */
export interface PlanPoint {
  text: string;
  off?: boolean;
}

/** What a plan gives, in the order a buyer asks. */
export function pointsOf(plan: LandingPlan): PlanPoint[] {
  return [
    { text: counted(plan.branches, "branch", "branches") },
    { text: counted(plan.staff, "staff login") },
    { text: counted(plan.tills, "till") },
    { text: plan.bills === null ? "Bills without a meter" : `${grouped(plan.bills)} bills a month` },
    { text: plan.products === null ? "Products without a ceiling" : `${grouped(plan.products)} products` },
    { text: plan.historyMonths === null ? "History kept for good" : `${counted(plan.historyMonths / 12, "year")} of history` },
    plan.offlineDays === null
      ? { text: "Selling with no internet", off: true }
      : { text: `Sells with no internet — ${counted(plan.offlineDays, "day")}` },
  ];
}

/** The price as it is printed: 2,499. */
export const priceOf = (plan: LandingPlan): string => grouped(plan.price);
