import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { manualDiscountRefusal } from "./manualDiscount";

describe("a manual discount the till will not pay against", () => {
  it("#AZ19 a minus raises the bill — refused at the keying", () => {
    expect(manualDiscountRefusal("-50", 150)).toBe("below_nothing");
  });

  it("more than the bill is refused at the keying", () => {
    expect(manualDiscountRefusal("5000", 150)).toBe("past_the_bill");
  });

  it("nothing, a part, or the whole bill may be given", () => {
    for (const ok of ["", "0", "50", "150", "abc"]) expect(manualDiscountRefusal(ok, 150)).toBeNull();
  });

  it("the till says it, holds Done, and will not complete the sale", () => {
    const till = readFileSync(resolve(__dirname, "pages/PosPage.tsx"), "utf8");

    expect(till).toMatch(/const discountRefused = manualDiscountRefusal\(discount, subtotal\);/);
    expect(till).toMatch(/const canCheckout = cart\.length > 0 && canRing && discountRefused === null &&/);
    expect(till).toMatch(/<Button size="sm" onClick=\{discountModal\.closeModal\} disabled=\{discountRefused !== null\}>Done<\/Button>/);
    expect(till).toMatch(/\{discountRefused === "below_nothing" && \(/);
  });
});
