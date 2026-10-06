import { describe, expect, it } from "vitest";
import { fitRoll, rollOf, rollPageRule, rollWidthIn } from "./print";
import { testPageHtml } from "../modules/hardware/testPage";

/**
 * "Receipt is set to Thermal 80mm, and the till still prints A4."
 *
 * Every roll template wrote `size: 80mm auto`. It is not CSS, so the browser
 * dropped it. These hold the page to the only form that means a custom page:
 * two lengths.
 */

/** What CSS accepts as a custom page: a width and a height, both lengths. */
const TWO_LENGTHS = /@page \{ size: (\d+)mm (\d+)mm; margin: (\d+)mm; \}/;

const documentFrom = (html: string): Document => new DOMParser().parseFromString(html, "text/html");

const receipt = (attrs: string) => `<!doctype html><html lang="en" ${attrs}><head><style>@media print { @page { size: 80mm 297mm; } }</style></head><body><p>Rice</p></body></html>`;

describe("the page a roll is printed on", () => {
  it("is as wide as the roll and as long as the receipt — two lengths, never 'auto'", () => {
    // 370px is 97.9mm of receipt, so 98; 3mm top and bottom; 6mm for the cutter.
    const rule = rollPageRule({ widthMm: 80, marginMm: 3 }, 370);

    expect(rule).toMatch(TWO_LENGTHS);
    expect(rule).toContain("size: 80mm 110mm");
    expect(rule).not.toMatch(/auto/);
  });

  it("grows with the receipt, so forty lines are one slip and not two", () => {
    const height = (px: number) => Number(TWO_LENGTHS.exec(rollPageRule({ widthMm: 80, marginMm: 3 }, px))![2]);

    expect(height(2000)).toBeGreaterThan(height(400));
    // Never short: the whole receipt and its margins fit inside the page.
    expect(height(2000)).toBeGreaterThanOrEqual(Math.ceil(2000 / (96 / 25.4)) + 6);
  });

  it("rounds UP — a page a millimetre short puts the last line on a second slip", () => {
    const px = 100.2 * (96 / 25.4);

    expect(rollPageRule({ widthMm: 80, marginMm: 0 }, px)).toContain("size: 80mm 107mm");
  });

  it("is never so short a driver refuses it", () => {
    expect(rollPageRule({ widthMm: 58, marginMm: 3 }, 0)).toContain("size: 58mm 40mm");
  });
});

describe("which paper a document says it is for", () => {
  it("reads the roll off <html>", () => {
    expect(rollOf(documentFrom(receipt('data-roll-mm="80" data-roll-margin-mm="3"')))).toEqual({ widthMm: 80, marginMm: 3 });
    expect(rollOf(documentFrom(receipt('data-roll-mm="58" data-roll-margin-mm="2"')))).toEqual({ widthMm: 58, marginMm: 2 });
  });

  it("calls a document with no roll a sheet, and leaves it alone", () => {
    const doc = documentFrom(receipt(""));

    expect(rollOf(doc)).toBeNull();
    expect(fitRoll(doc)).toBeNull();
    expect(doc.getElementById("roll-page")).toBeNull();
  });

  it("does not take nonsense for a width", () => {
    expect(rollOf(documentFrom(receipt('data-roll-mm="wide"')))).toBeNull();
    expect(rollOf(documentFrom(receipt('data-roll-mm="0"')))).toBeNull();
  });

  it("knows the width before the document is loaded, to lay it out at that width", () => {
    expect(rollWidthIn(receipt('data-roll-mm="80" data-roll-margin-mm="3"'))).toBe(80);
    expect(rollWidthIn(receipt(""))).toBeNull();
  });
});

describe("fitting a loaded receipt", () => {
  it("adds its rule LAST, so it wins over the template's own fallback", () => {
    const doc = documentFrom(receipt('data-roll-mm="80" data-roll-margin-mm="3"'));

    const rule = fitRoll(doc);

    expect(rule).toMatch(TWO_LENGTHS);
    expect(doc.head.lastElementChild?.id).toBe("roll-page");
    expect(doc.head.lastElementChild?.textContent).toBe(rule);
  });

  it("replaces its own rule when fitted twice, rather than stacking them", () => {
    const doc = documentFrom(receipt('data-roll-mm="80" data-roll-margin-mm="3"'));

    fitRoll(doc);
    fitRoll(doc);

    expect(doc.querySelectorAll("#roll-page")).toHaveLength(1);
  });
});

describe("the hardware test page", () => {
  it("goes out as the roll the device holds, in CSS a browser accepts", () => {
    const html = testPageHtml({ name: "Lane 1 printer", settings: { paper_size: "80mm" } });

    expect(rollWidthIn(html)).toBe(80);
    expect(html).toContain("size:80mm 297mm");
    expect(html).not.toMatch(/mm auto/);
  });

  it("is a 58mm roll for a 58mm printer and a sheet for an A4 one", () => {
    expect(rollWidthIn(testPageHtml({ name: "P", settings: { paper_size: "58mm" } }))).toBe(58);

    const sheet = testPageHtml({ name: "P", settings: { paper_size: "a4" } });
    expect(rollWidthIn(sheet)).toBeNull();
    expect(sheet).toContain("size:A4");
  });

  it("does not let a device's name write markup into the page", () => {
    expect(testPageHtml({ name: "<script>x</script>" })).not.toContain("<script>x");
  });
});
