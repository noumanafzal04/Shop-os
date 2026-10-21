import type { Locator, Page } from "@playwright/test";

const VALUE: Record<string, string> = { Cash: "cash", Card: "card", Wallet: "wallet", Khata: "credit", Split: "split" };

/**
 * Choose how the bill is paid on the pay sheet: one "Payment method" list, the
 * shop's default already chosen (the user, 2026-10-21). A spec names the
 * tender; this picks it.
 */
export async function payBy(scope: Page | Locator, label: "Cash" | "Card" | "Wallet" | "Khata" | "Split" | string): Promise<void> {
  await scope.getByRole("combobox", { name: "Payment method" }).selectOption(VALUE[label] ?? label);
}

/** Is this tender offered at all? */
export function offers(scope: Page | Locator, label: string): Locator {
  return scope.getByRole("combobox", { name: "Payment method" }).locator(`option[value="${VALUE[label] ?? label}"]`);
}
