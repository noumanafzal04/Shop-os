import { describe, expect, it } from "vitest";
import { shopDateTime } from "../../common/format/date";
import { testPageHtml } from "./testPage";

/**
 * The 2026-11-02 walk printed "11/2/2026, 1:30:56 AM" on the hardware test
 * page — the browser's way, month first — on a shop that writes its dates
 * "2 Nov 2026". A test page is a printed page like a receipt, in the shop's words.
 */
describe("a hardware test page", () => {
  const at = new Date("2026-11-02T01:30:56+05:00");

  it("is dated the shop's way, not the browser's", () => {
    const html = testPageHtml({ name: "Front counter" }, at);
    expect(html).toContain(shopDateTime(at));
    expect(html).not.toContain(at.toLocaleString());
  });

  it("names the device and says it worked", () => {
    const html = testPageHtml({ name: "Front <counter>", brand: "XPrinter", model: "XP-80" }, at);
    expect(html).toContain("Front &lt;counter&gt;");
    expect(html).toContain("XPrinter XP-80");
    expect(html).toContain("Test print OK");
  });
});
