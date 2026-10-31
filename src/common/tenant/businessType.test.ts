import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { tracksSerials } from "./businessType";

/**
 * #AZ8 — a mobile-repair shop (`services`) could put no serial and no warranty
 * on the battery it sold, though the server took both (201, read back).
 */
describe("who may record a serial and a warranty on a part", () => {
  it.each(["retail", "wholesale", "automotive", "petroleum", "services"])("%s may", (trade) => {
    expect(tracksSerials(trade)).toBe(true);
  });

  it.each(["grocery", "pharmacy", "restaurant", null, undefined])("%s may not", (trade) => {
    expect(tracksSerials(trade)).toBe(false);
  });

  it("the item form and the sidebar ask the same helper", () => {
    const form = readFileSync(resolve(__dirname, "../../modules/catalog/pages/ProductFormPage.tsx"), "utf8");
    const nav = readFileSync(resolve(__dirname, "../../layout/shopNav.tsx"), "utf8");

    expect(form).toMatch(/isPhysical && tracksSerials\(businessType\)/);
    expect(nav).toMatch(/tracksSerials\(businessType\)/);
  });
});
