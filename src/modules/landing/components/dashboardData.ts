/**
 * THE ONE DAY THE LANDING PAGE SHOWS, held in one place.
 *
 * Two things draw it now — the app window in the hero and the bare dashboard
 * further down — and the moment each held its own copy they would start
 * disagreeing about what the shop took. A visitor who notices the same shop
 * reporting two different totals on one page has learned something true about
 * how carefully this was built.
 *
 * Al-Saeed Mart's evening, which is when a mart earns. Rupees throughout.
 */
export type Hour = { at: string; amount: number };

export const HOURS: Hour[] = [
  { at: "10", amount: 4200 },
  { at: "11", amount: 7800 },
  { at: "12", amount: 11400 },
  { at: "1", amount: 9600 },
  { at: "2", amount: 6100 },
  { at: "3", amount: 5400 },
  { at: "4", amount: 8900 },
  { at: "5", amount: 14200 },
  { at: "6", amount: 19800 },
  { at: "7", amount: 24600 },
  { at: "8", amount: 21300 },
  { at: "9", amount: 12700 },
];

export const PEAK = Math.max(...HOURS.map((h) => h.amount));

export type SoldItem = { name: string; sold: string; amount: number };

export const TOP: SoldItem[] = [
  { name: "Cooking Oil 5 L", sold: "23 packs", amount: 71300 },
  { name: "Sugar", sold: "84 kg", amount: 15120 },
  { name: "Tea 500g", sold: "11 packs", amount: 12650 },
  { name: "Basmati Rice", sold: "46 kg", amount: 11040 },
];

export type Kpi = {
  label: string;
  value: string;
  foot: string;
  tone?: "plain" | "warn" | "good";
};

export const KPIS: Kpi[] = [
  { label: "Takings", value: "Rs 146,000", foot: "Cash 88,400 · card 57,600" },
  { label: "Sales", value: "312", foot: "Average Rs 468" },
  { label: "Khata owed", value: "Rs 64,250", foot: "9 customers, 2 over limit", tone: "warn" },
  { label: "Running out", value: "7 items", foot: "3 already at zero", tone: "warn" },
];

/** The one row that is not a number: the shop telling you something. */
export const ALERT = {
  title: "Cooking Oil 5 L is down to 4 packs",
  body: "It sold 23 today. Whoever can order it has already been told.",
};

/** The shop this whole picture belongs to. */
export const SHOP = {
  name: "Al-Saeed Mart",
  initials: "AS",
  branch: "Zamzama",
};
