import type { Locator, Page } from "@playwright/test";
import { expect, settled } from "./kit";

/**
 * WHAT THE JOURNEY'S SHOP SELLS — one list, read by every stage.
 *
 * The figures are chosen so that a bill can be worked out by hand and so that
 * no two rules give the same answer by accident: three different tax paths
 * (a group, the item's own rate, the shop default), a sale price, a trade
 * price, a quantity break, a weighed item and a service.
 */

export const DEFAULT_TAX = 5;

export const TAX_GROUPS = [
  { name: "GST 18", rate: 18 },
  { name: "Reduced 10", rate: 10 },
] as const;

export interface Item {
  key: string;
  name: string;
  type?: "service";
  category?: string;
  price: number;
  salePrice?: number;
  cost?: number;
  taxGroup?: string;
  /** The item's OWN rate. 0 is "exempt", which is not the same as unset. */
  taxRate?: number;
  stock?: number;
  lowAt?: number;
  sku?: string;
  barcode?: string;
  unit?: string;
  weighed?: boolean;
  wholesale?: number;
  tiers?: Array<{ min: number; price: number }>;
  /** The rate a bill is taxed at, for the stages that add bills up. */
  effectiveTax: number;
}

export const ITEMS: Item[] = [
  {
    key: "oil", name: "QA Cooking Oil 5L", category: "Food & Beverages", price: 2850, cost: 2500,
    taxGroup: "GST 18", stock: 40, lowAt: 5, sku: "QA-OIL-5L", barcode: "8964000100017", effectiveTax: 18,
  },
  {
    // No group and no rate of its own: the shop default.
    key: "rice", name: "QA Basmati Rice 5kg", category: "Food & Beverages", price: 1950, cost: 1600,
    stock: 60, lowAt: 10, sku: "QA-RICE-5K", wholesale: 1800, tiers: [{ min: 10, price: 1900 }],
    effectiveTax: DEFAULT_TAX,
  },
  {
    // Its own rate, and the rate is ZERO. Exempt — not "use the default".
    key: "sugar", name: "QA Sugar Loose", category: "Food & Beverages", price: 160, cost: 140,
    taxRate: 0, stock: 200, sku: "QA-SUGAR", unit: "KG", weighed: true, effectiveTax: 0,
  },
  {
    key: "tea", name: "QA Tea 950g", category: "Food & Beverages", price: 1450, salePrice: 1299, cost: 1100,
    taxGroup: "Reduced 10", stock: 30, lowAt: 5, sku: "QA-TEA-950", effectiveTax: 10,
  },
  {
    key: "soap", name: "QA Bath Soap", category: "Personal Care", price: 120, cost: 90,
    stock: 150, lowAt: 20, sku: "QA-SOAP", effectiveTax: DEFAULT_TAX,
  },
  {
    key: "delivery", name: "QA Home Delivery", type: "service", price: 150, effectiveTax: DEFAULT_TAX,
  },
];

export const item = (key: string): Item => {
  const found = ITEMS.find((i) => i.key === key);
  if (!found) throw new Error(`no journey item "${key}"`);

  return found;
};

/** What a line of one of these costs before tax: the sale price when there is one. */
export const selling = (i: Item): number => (i.salePrice !== undefined && i.salePrice < i.price ? i.salePrice : i.price);

// ── the product editor ───────────────────────────────────────────────

/** The editor's dialog, whichever product it is open on. */
//
// Found by its HEADING. It was found by its "Codes & packs" tab, which a
// service does not have — so the moment the type was switched to Service the
// editor "disappeared" from under the helper.
export const editor = (page: Page): Locator =>
  page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: /^(Add item|Edit )/ }) });

const num = (dialog: Locator, label: string) => dialog.getByLabel(label, { exact: true });

/**
 * Add one item through the editor, the way a shopkeeper does: open it, fill
 * what they know, press Create.
 */
export async function addItem(page: Page, i: Item): Promise<void> {
  await page.goto("/tenant/products/new");
  const dialog = editor(page);
  await expect(dialog.getByRole("heading", { name: "Add item" })).toBeVisible({ timeout: 20_000 });

  if (i.type === "service") await dialog.getByRole("button", { name: "Service", exact: true }).click();

  await num(dialog, "Name *").fill(i.name);
  if (i.category) await num(dialog, "Category").selectOption({ label: i.category });
  await num(dialog, "Price *").fill(String(i.price));
  if (i.salePrice !== undefined) await num(dialog, "Sale price (optional)").fill(String(i.salePrice));
  if (i.cost !== undefined) await num(dialog, "Cost (optional)").fill(String(i.cost));
  if (i.taxGroup) {
    const group = num(dialog, "Tax group (optional)");
    const label = (await group.locator("option").allTextContents()).find((t) => t.includes(i.taxGroup!));
    expect(label, `tax group ${i.taxGroup} is not offered on the item form`).toBeTruthy();
    await group.selectOption({ label: label! });
  }
  if (i.taxRate !== undefined) await num(dialog, "Tax rate % (optional)").fill(String(i.taxRate));
  if (i.stock !== undefined) await num(dialog, "Opening stock").fill(String(i.stock));
  if (i.lowAt !== undefined) await num(dialog, "Low-stock alert at").fill(String(i.lowAt));

  const description = num(dialog, "Description *");
  if (await description.isVisible().catch(() => false)) await description.fill(`${i.name} — added by the QA journey.`);

  if (i.sku || i.barcode || i.unit || i.weighed || i.wholesale !== undefined || i.tiers) {
    await dialog.getByRole("button", { name: "Codes & packs" }).click();
    if (i.sku) await num(dialog, "SKU").fill(i.sku);
    if (i.barcode) await num(dialog, "Barcode").fill(i.barcode);
    if (i.unit) await dialog.getByRole("button", { name: i.unit, exact: true }).click();
    if (i.weighed) await num(dialog, "Sold by").selectOption({ label: "Weight / measure (0.5, 1.25…)" });
    if (i.wholesale !== undefined) await num(dialog, "Wholesale price (optional)").fill(String(i.wholesale));
    for (const [n, tier] of (i.tiers ?? []).entries()) {
      await dialog.getByRole("button", { name: "+ Add tier" }).click();
      await dialog.getByLabel(`Tier ${n + 1}: from quantity`).fill(String(tier.min));
      await dialog.getByLabel(`Tier ${n + 1}: price each`).fill(String(tier.price));
    }
  }

  const create = dialog.getByRole("button", { name: "Create item" });
  await expect(create, `the form will not let ${i.name} be created`).toBeEnabled();
  await create.click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  await settled(page);
}

/** The Products list, narrowed to one item by name. */
export async function findOnShelf(page: Page, name: string): Promise<Locator> {
  await page.goto("/tenant/products");
  await page.getByPlaceholder("Search name or SKU…").fill(name);
  const row = page.getByRole("row").filter({ hasText: name }).first();
  await expect(row, `${name} is not on the Products list`).toBeVisible({ timeout: 20_000 });

  return row;
}

// ── who the shop buys from and sells to ──────────────────────────────

export const SUPPLIERS = [
  { name: "QA Oil Mills", contact: "Tariq", phone: "0421110001" },
  { name: "QA Rice Traders", contact: "Imran", phone: "0421110002" },
  { name: "QA General Supply", contact: "Nadia", phone: "0421110003" },
] as const;

/** One purchase order: what was bought, and what it does to the shelf. */
export const PURCHASE = {
  supplier: "QA Oil Mills",
  lines: [
    { item: "oil", quantity: 20, cost: 2450 },
    { item: "rice", quantity: 30, cost: 1550 },
  ],
  total: 20 * 2450 + 30 * 1550, // 95,500
} as const;

export const GROUPS = [
  { name: "QA Members", level: "Retail price", pct: 10 },
  { name: "QA Trade", level: "Wholesale price", pct: 0 },
] as const;

export const CUSTOMERS = [
  { key: "walkin", name: "QA Ali Raza", phone: "03001110001" },
  { key: "member", name: "QA Sara Khan", phone: "03001110002", group: "QA Members" },
  { key: "trader", name: "QA Bilal Traders", phone: "03001110003", group: "QA Trade", creditLimit: 50000 },
] as const;

export const customer = (key: string) => {
  const found = CUSTOMERS.find((c) => c.key === key);
  if (!found) throw new Error(`no journey customer "${key}"`);

  return found;
};

// ── offers, and money that is not a sale ─────────────────────────────

/** Ten percent off, never more than Rs 200, on a bill of Rs 1,000 or more. */
export const COUPON = { code: "QAEID10", pct: 10, minSpend: 1000, cap: 200 } as const;

/**
 * Twenty percent off soap, and ONLY soap. Scoped to one product so that every
 * other bill in the journey is the bill its items make, and the one bill that
 * has soap on it shows the promotion doing exactly what it says.
 */
export const PROMOTION = { name: "QA Soap 20 off", pct: 20, item: "soap" } as const;

export const EXPENSES = [
  { category: "Rent", description: "QA October shop rent", amount: 25000, paidBy: "Bank transfer" },
  { category: "Utilities", description: "QA electricity bill", amount: 8400, paidBy: "Bank transfer" },
] as const;

export const INCOMES = [
  { category: "Rent Received", description: "QA shelf space rented out", amount: 5000, receivedBy: "Bank transfer" },
] as const;

// ── people and places ────────────────────────────────────────────────

export const BRANCH = { name: "QA Gulberg", code: "QGB", phone: "0425550002", address: "45 Main Boulevard, Gulberg" } as const;

export const CASHIER = { name: "QA Cashier Hina", job: "Cashier", password: "Cashier-pass-1" } as const;
