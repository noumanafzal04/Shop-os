import { describe, expect, it } from "vitest";
import { lotExpiry } from "./lotWords";

/**
 * A LOT SAYS ITS DATE (mart #MT3).
 *
 * "OPENING · 8 left" and "PO-000001 · 40 left" — the dated lot and the undated
 * one read the same on the screen that exists for their dates.
 */
const PAGE = Object.values(
  import.meta.glob("./pages/InventoryPage.tsx", { query: "?raw", import: "default", eager: true }),
)[0] as string;

describe("a lot's date", () => {
  it("is said the shop's way", () => {
    expect(lotExpiry("2026-11-10")).toBe("expires 10 Nov 2026");
  });

  it("is the day the server wrote, whatever time is stamped on it", () => {
    expect(lotExpiry("2026-11-10T00:00:00.000000Z")).toBe("expires 10 Nov 2026");
  });

  it("missing, says so — it does not look like a lot that has one", () => {
    expect(lotExpiry(null)).toBe("no expiry date");
    expect(lotExpiry("")).toBe("no expiry date");
  });

  it("is printed on every row of the Batches sheet", () => {
    expect(PAGE).toMatch(/\{lotExpiry\(b\.expiry_date\)\}/);
  });

  it("can be changed in place, and the box says which lot it is for", () => {
    expect(PAGE).toMatch(/aria-label=\{`Expiry of lot \$\{b\.batch_number\}`\}/);
  });
});
