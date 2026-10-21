import type { Locator, Page } from "@playwright/test";

/**
 * Choose how the bill is paid on the pay sheet. The shop's default tender is
 * the one button; every other is in the "Pay another way" list beside it (the
 * user, 2026-10-21). A spec names the tender, not where the sheet put it.
 */
export async function payBy(scope: Page | Locator, label: "Cash" | "Card" | "Wallet" | "Khata" | "Split" | string): Promise<void> {
  const methods = scope.getByRole("group", { name: "Payment method" });
  const button = methods.getByRole("button", { name: new RegExp(`^${label}`) });

  if (await button.count()) await button.click();
  else await methods.getByRole("combobox", { name: "Pay another way" }).selectOption({ label });
}

/** Is this tender offered at all — as the button or in the list? */
export function offers(scope: Page | Locator, label: string): Locator {
  const methods = scope.getByRole("group", { name: "Payment method" });

  return methods.getByRole("button", { name: new RegExp(`^${label}`) }).or(methods.getByRole("option", { name: label, exact: true }));
}
