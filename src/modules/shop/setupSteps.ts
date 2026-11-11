import type { ShopSettings } from "./services/shopService";

/**
 * THE FIRST TIME A SHOP IS OPENED — a few steps, each with a way past it.
 *
 * The setup screen asked for one thing (where the shop is) and let the owner
 * in; the money, the tax, the receipt and how the counter behaves were left
 * on defaults they met only at their first sale — a receipt on the wrong
 * paper, prices that should have included tax, an online shop "closed" at
 * every hour. The owner asked (2026-11-11) for Next and Back through the
 * settings a shop needs on day one, every step after the first skippable.
 * A skipped step changes nothing: the shop keeps the defaults it was made
 * with, and every one of them is in Settings later.
 */
export type SetupStep = "shop" | "money" | "counter" | "online";

/**
 * Which steps this business is asked. Where it is, always. Its money, always
 * — a currency is fixed at the first sale. The counter only where there IS
 * one, and opening hours and online orders only where it sells online or
 * delivers: a books-only office is asked two things.
 */
export function setupSteps(hasCounter: boolean, sellsOnline: boolean): SetupStep[] {
  return [
    "shop",
    "money",
    ...(hasCounter ? (["counter"] as const) : []),
    ...(sellsOnline ? (["online"] as const) : []),
  ];
}

/** One day's hours, as the server keeps them (0 = Sunday). */
export interface DayHours {
  day: number;
  open: string;
  close: string;
}

/** What the owner answered. `undefined` = not touched: the default stands. */
export interface SetupAnswers {
  // money
  timezone?: string;
  default_tax_rate?: number;
  tax_inclusive?: boolean;
  invoice_ntn?: string;
  invoice_strn?: string;
  // counter
  receipt_width?: ShopSettings["receipt_width"];
  pos_auto_print?: boolean;
  pos_require_shift?: boolean;
  pos_default_payment?: ShopSettings["pos_default_payment"];
  invoice_footer?: string;
  // online
  business_hours?: DayHours[];
  pickup_enabled?: boolean;
  delivery_enabled?: boolean;
  delivery_fee?: number;
  min_order_amount?: number | null;
}

/** Settings (PUT /shop/settings) each step may change. */
const SETTINGS: Record<Exclude<SetupStep, "shop">, readonly (keyof SetupAnswers & keyof ShopSettings)[]> = {
  money: ["default_tax_rate", "tax_inclusive", "invoice_ntn", "invoice_strn"],
  counter: ["receipt_width", "pos_auto_print", "pos_require_shift", "pos_default_payment", "invoice_footer"],
  online: ["pickup_enabled", "delivery_enabled", "min_order_amount"],
};

/** What travels with the setup itself (PUT /shop/setup), by step. */
const WITH_SETUP: Record<Exclude<SetupStep, "shop">, readonly (keyof SetupAnswers)[]> = {
  money: ["timezone"],
  counter: [],
  online: ["business_hours", "delivery_fee"],
};

const counts = (step: SetupStep, skipped: ReadonlySet<SetupStep>, steps: readonly SetupStep[]) =>
  step !== "shop" && steps.includes(step) && !skipped.has(step);

/**
 * The settings to save — only what was answered, and nothing from a step that
 * was skipped or a step this business is not asked. Nothing answered saves
 * nothing, so finishing straight away is exactly the old one-screen setup.
 */
export function settingsToSave(answers: SetupAnswers, skipped: ReadonlySet<SetupStep>, steps: readonly SetupStep[]): Partial<ShopSettings> {
  const out: Record<string, unknown> = {};
  for (const step of ["money", "counter", "online"] as const) {
    if (!counts(step, skipped, steps)) continue;
    for (const key of SETTINGS[step]) {
      if (answers[key] !== undefined) out[key] = answers[key];
    }
  }

  return out as Partial<ShopSettings>;
}

/**
 * What the setup request carries beyond where the shop is — the clock (only
 * when it was changed), the opening hours and the delivery charge.
 */
export function setupExtras(
  answers: SetupAnswers,
  skipped: ReadonlySet<SetupStep>,
  steps: readonly SetupStep[],
  currentZone: string | undefined,
): { timezone?: string; business_hours?: DayHours[]; delivery_fee?: number } {
  const out: { timezone?: string; business_hours?: DayHours[]; delivery_fee?: number } = {};
  if (counts("money", skipped, steps) && answers.timezone !== undefined && answers.timezone !== currentZone) {
    out.timezone = answers.timezone;
  }
  if (counts("online", skipped, steps)) {
    if (answers.business_hours !== undefined) out.business_hours = answers.business_hours;
    if (answers.delivery_fee !== undefined) out.delivery_fee = answers.delivery_fee;
  }

  return out;
}

/** Skipping a step forgets what was typed on it — "skip" means "leave it as it was". */
export function forgetStep(answers: SetupAnswers, step: SetupStep): SetupAnswers {
  if (step === "shop") return answers;
  const next = { ...answers };
  for (const key of [...SETTINGS[step], ...WITH_SETUP[step]]) delete next[key];

  return next;
}

/** Same hours on the chosen days — the shape the server keeps. */
export function hoursFor(days: readonly number[], open: string, close: string): DayHours[] {
  return [...days].sort((a, b) => a - b).map((day) => ({ day, open, close }));
}

/**
 * Why these answers cannot be saved yet, in words — or null. The server
 * refuses the same two things; saying it here keeps the owner on the step
 * that can fix it instead of failing at Finish.
 */
export function whyNot(step: SetupStep, answers: SetupAnswers, defaults: { pickup: boolean; delivery: boolean }): string | null {
  if (step !== "online") return null;
  const pickup = answers.pickup_enabled ?? defaults.pickup;
  const delivery = answers.delivery_enabled ?? defaults.delivery;
  if (!pickup && !delivery) return "Customers need a way to get their order — keep collecting or delivery on.";
  const hours = answers.business_hours;
  if (hours !== undefined && hours.length > 0 && hours.some((h) => h.close <= h.open)) {
    return "Closing time must be after opening time. (Open past midnight? Set that day in Settings.)";
  }

  return null;
}
