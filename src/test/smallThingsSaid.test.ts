import { describe, expect, it } from "vitest";

/**
 * THE P3s FROM THE TRADE ROUNDS — each a small thing a screen said wrong, or
 * did not say. Held as text: every one sits behind a shop session.
 */
const read = (glob: Record<string, unknown>): string => Object.values(glob).join("\n");
const pos = read(import.meta.glob("../modules/pos/pages/PosPage.tsx", { query: "?raw", import: "default", eager: true }));
const attention = read(import.meta.glob("../modules/dashboard/components/shop/AttentionPanel.tsx", { query: "?raw", import: "default", eager: true }));
const tiles = read(import.meta.glob("../modules/dashboard/components/shop/InventoryTiles.tsx", { query: "?raw", import: "default", eager: true }));
const disposals = read(import.meta.glob("../modules/inventory/pages/DisposalsPage.tsx", { query: "?raw", import: "default", eager: true }));
const sales = read(import.meta.glob("../modules/sales/pages/SalesPage.tsx", { query: "?raw", import: "default", eager: true }));
const products = read(import.meta.glob("../modules/catalog/pages/ProductsPage.tsx", { query: "?raw", import: "default", eager: true }));
const tab = read(import.meta.glob("../modules/dinein/pages/TabPage.tsx", { query: "?raw", import: "default", eager: true }));
const approval = read(import.meta.glob("../modules/sales/components/RefundApproval.tsx", { query: "?raw", import: "default", eager: true }));

describe("small things, said right", () => {
  it("#AD8 the till carries the read-only strip the shell carries", () => {
    expect(pos).toMatch(/<ReadOnlyBanner \/>/);
  });

  it("#PH2 the dashboard quotes the window it counted in, not 30 days", () => {
    expect(attention).toMatch(/`Within \$\{data\.inventory\.expiring_within_days \?\? 30\} days/);
    expect(tiles).toMatch(/`batches within \$\{inventory\.expiring_within_days \?\? 30\} days`/);
    expect(attention + tiles).not.toMatch(/"Within 30 days|"batches within 30 days"/);
  });

  it("#PH3 a disposal's dates are the shop's, not the API's", () => {
    expect(disposals).toMatch(/exp \$\{shopDate\(d\.expiry_date\.slice\(0, 10\)\)\}/);
    expect(disposals).toMatch(/\{shopDate\(d\.credit_received_at\.slice\(0, 10\)\)\}/);
  });

  it("#PH7 a sale's line says which pack", () => {
    expect(sales).toMatch(/\$\{item\.unit_name \? ` · \$\{item\.unit_name\}` : ""\}/);
    expect(sales).toMatch(/\{item\.unit_name && <span className="text-gray-400"> · \{item\.unit_name\}<\/span>\}/);
  });

  it("#RS6 a sold-out dish says so in the status column", () => {
    expect(products).toMatch(/\{!p\.is_active \? "Inactive" : p\.sold_out \? "Sold out" : "Active"\}/);
  });

  it("#RS7 the waiter's menu says when it is cut", () => {
    expect(tab).toMatch(/\(products\.data\?\.missing \?\? 0\) > 0 &&/);
  });

  it("#RS9 the PIN pointer names where the PIN is", () => {
    expect(approval).toMatch(/Settings → Point of sale → Staff PINs/);
    expect(approval).not.toMatch(/sets one under Security/);
  });
});

const dayPage = read(import.meta.glob("../modules/day/pages/DayPage.tsx", { query: "?raw", import: "default", eager: true }));

it("#RS11 the day's cash figure is named for what it counts", () => {
  expect(dayPage).toMatch(/<Stat label="Cash through drawers" value=\{money\(running!\.cash_sales\)\} hint="Cash sales on a shift, less cash refunds" \/>/);
  expect(dayPage).not.toMatch(/label="Cash takings"/);
});

const form = read(import.meta.glob("../modules/catalog/pages/ProductFormPage.tsx", { query: "?raw", import: "default", eager: true }));

it("#SV3 a warranty is offered without a serial, and on a service", () => {
  expect(form).toMatch(/warranty_months: \(isPhysical \|\| isService\) && warrantyMonths \? Number\(warrantyMonths\)/);
  expect(form).toMatch(/<WarrantyField value=\{warrantyMonths\} onChange=\{setWarrantyMonths\} serial=\{trackSerial\} \/>/);
  expect(form).toMatch(/\{isService && \(\s*<Section title="Warranty">/);
  expect(form).not.toMatch(/\{trackSerial && \(\s*<div>\s*<Label>Default warranty/);
});

it("#RS3 #RS4 the table's settle sheet offers a discount, a coupon and a split between people", () => {
  expect(tab).toMatch(/askOf\(unsettled, settleQty, method, splitMethod, splitAmount, tip, canDiscount \? billDiscount : "", coupon\)/);
  expect(tab).toMatch(/\{canDiscount && \(\s*<div>\s*<Label>Discount/);
  expect(tab).toMatch(/const shares = sharesOf\(worth\.due, people\);/);
});

it("#OF5 the till does not search a server it knows it cannot reach", () => {
  expect(pos).toMatch(/for_sale: true, page, per_page: POS_PAGE_SIZE \}, connected\);/);
});

it("A-to-Z B7: an offline till prices its promotion itself and asks no server", () => {
  expect(pos).toMatch(/if \(!connected\) \{\s*void fromTheTill\(\);\s*\} else \{\s*promotionsService\s*\.preview\(/);
  expect(pos).toMatch(/\.catch\(fromTheTill\);/);
  expect(pos).toMatch(/\}, \[promoKey, hasOffers, connected\]\);/);
});

it("A-to-Z B6: a discount past the bill is said at the keying", () => {
  expect(pos).toMatch(/\{subtotal > 0 && \(Number\(discount\) \|\| 0\) > subtotal && \(\s*<p data-discount-past-bill/);
});
