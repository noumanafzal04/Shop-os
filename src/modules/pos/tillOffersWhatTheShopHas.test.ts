import { describe, expect, it } from "vitest";

/**
 * THE TILL OFFERS ONLY WHAT THE SHOP HAS.
 *
 * Reported from a mart: *"This module is not enabled for your shop — Quote
 * and Advance, so why is it showing if not enabled?"*
 *
 * The sidebar, the dashboard, the reports tabs and the settings tabs are all
 * held to the shop's modules by `offeredIsReachable.test.ts`, which reads the
 * LINKS a screen renders. The till offers nothing by link — its doors are
 * buttons that open sheets that call the API — so that guard walked straight
 * past it, and the till showed every control to every shop.
 *
 * By default four of the eight trades have no `documents`, five have no
 * `promotions`, and none has `bank_offers`. So this was most shops.
 *
 * Read as source, like the rest of the till's guards: the page cannot be
 * rendered without a shift, a catalog, an outbox and a scanner, and what is
 * being asked is simply "is this control inside the question".
 */

const SOURCE = Object.values(
  import.meta.glob("./pages/PosPage.tsx", { query: "?raw", import: "default", eager: true }),
)[0] as string;
const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

describe("each module the till can reach for is asked about first", () => {
  it("knows the four it depends on", () => {
    expect(code).toMatch(/const sellsQuotes = has\("documents"\);/);
    expect(code).toMatch(/const hasOffers = has\("promotions"\);/);
    expect(code).toMatch(/const hasKhata = has\("customers"\);/);
    expect(code).toMatch(/const hasBankOffers = has\("bank_offers"\);/);
  });

  it("Quotes & Advances: the sheet and the button are inside the question", () => {
    expect(code).toMatch(/\{sellsQuotes && <ParkAsDocumentModal/);
    expect(code).toMatch(/\{sellsQuotes && <button\s+onClick=\{documentModal\.openModal\}/);
    // …and nowhere else opens it unasked.
    const opens = code.match(/documentModal\.openModal/g) ?? [];
    expect(opens.length, "a new door to the quote sheet — is it gated?").toBe(2);
  });

  it("Coupons & Promotions: no preview is asked for, and no coupon box is drawn", () => {
    expect(code).toMatch(/if \(billLines\.length === 0 \|\| !hasOffers\) \{ setPromo\(null\); return; \}/);
    expect(code).toMatch(/\{hasOffers && \(\s*<div>\s*<label[^>]*>Coupon code<\/label>/);
  });

  it("Customers & Khata: nobody is looked up, and nothing can be put on credit", () => {
    expect(code).toMatch(/if \(phone\.length < 7 \|\| !hasKhata\)/);
    expect(code).toMatch(/\.filter\(\(m\) => m !== "credit" \|\| hasKhata\)/);
    expect(code).toMatch(/\{hasKhata && <option value="credit">/);
    // Every `<option value="credit">` on the page is the gated one.
    expect((code.match(/<option value="credit">/g) ?? []).length).toBe(1);
  });

  it("Bank Card Offers: the row is not mounted, so it never asks", () => {
    expect(code).toMatch(/\{hasBankOffers && <BankOfferRow/);
    expect((code.match(/<BankOfferRow/g) ?? []).length).toBe(1);
  });
});
