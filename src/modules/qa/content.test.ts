import { describe, expect, it } from "vitest";

import { QA_INTRO, QA_SECTIONS } from "./content";
import { TENANT_ROUTES } from "../../test/routes";
import { EVERY_MODULE } from "../../test/tradeFeatures";

/**
 * A WALKTHROUGH THAT HAS GONE STALE IS WORSE THAN NONE.
 *
 * It is read by somebody who does not know the product, so every wrong line in
 * it becomes a bug report about a screen that is working, or — far worse — a
 * screen nobody checks because the walkthrough forgot it exists.
 *
 * So the parts of it that CAN be checked against the product are: the screens
 * it sends a tester to have to exist, and the modules it names have to be
 * modules. The prose cannot be checked and is not pretended to be.
 */
describe("the QA walkthrough describes this product", () => {
  const steps = QA_SECTIONS.flatMap((s) => s.steps);

  it("sends nobody to a screen that does not exist", () => {
    const missing = steps
      .map((s) => s.screen)
      .filter((screen): screen is string => screen !== undefined)
      // The admin console is a different router; this list is the shop's.
      .filter((screen) => screen.startsWith("/tenant/"))
      .filter((screen) => !TENANT_ROUTES.has(screen));

    expect(
      missing,
      `the walkthrough points at screens the app does not have: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("names no module the product does not have", () => {
    const unknown = steps
      .map((s) => s.module)
      .filter((m): m is string => m !== undefined)
      .filter((m) => !(m in EVERY_MODULE));

    expect(
      unknown,
      `the walkthrough blames a missing screen on modules that do not exist: ${unknown.join(", ")}`,
    ).toEqual([]);
  });

  it("asks for something on every step", () => {
    // A step with nothing to DO is a paragraph pretending to be a test.
    const idle = steps.filter((s) => s.checks.length === 0).map((s) => s.id);

    expect(idle, `steps that ask the tester to do nothing: ${idle.join(", ")}`).toEqual([]);
  });

  it("says what to expect on every single check", () => {
    // "Open the screen" with no expectation is not a check — it cannot fail.
    const vague = steps.flatMap((s) =>
      s.checks.filter((c) => c.expect.trim() === "").map(() => s.id),
    );

    expect(vague).toEqual([]);
  });

  it("explains what each thing is before asking anybody to test it", () => {
    const unexplained = steps.filter((s) => s.what.length === 0).map((s) => s.id);

    expect(
      unexplained,
      `a tester who does not know what a screen is FOR reports the rules as defects: ${unexplained.join(", ")}`,
    ).toEqual([]);
  });

  it("has no duplicate step ids", () => {
    // The ids key the tester's own place-marker in this browser. Two steps
    // sharing one would tick each other off.
    const ids = steps.map((s) => s.id);
    expect(ids).toEqual([...new Set(ids)]);
  });

  it("counts the modules correctly, because a number in prose is what rots first", () => {
    const said = [QA_INTRO.axes.map((a) => a.text).join(" "), ...QA_SECTIONS.flatMap((sx) => sx.steps.flatMap((s) => s.what))]
      .join(" ");
    const claimed = /\b(ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|twenty-one|twenty-two)\b modules?/gi;

    const words: Record<string, number> = {
      ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
      sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
      "twenty-one": 21, "twenty-two": 22,
    };

    for (const m of said.matchAll(claimed)) {
      expect(
        words[m[1].toLowerCase()],
        `the walkthrough says "${m[0]}" and the product has ${Object.keys(EVERY_MODULE).length}`,
      ).toBe(Object.keys(EVERY_MODULE).length);
    }
  });

  it("opens with the three axes, because most first-week reports are one of them", () => {
    expect(QA_INTRO.axes.map((a) => a.name)).toEqual(["MODULE", "TRADE", "PERMISSION"]);
  });

  it("covers the ground a shop actually runs on", () => {
    // Not a count for its own sake. These are the areas a tester who missed one
    // would leave a hole in: the till and the drawer are where the money is,
    // and offline is where this product is hardest and most visible.
    const sections = QA_SECTIONS.map((s) => s.id);

    for (const must of ["modules", "catalog", "stock", "till", "customers", "doors", "money", "offline", "settings"]) {
      expect(sections, `the walkthrough has no section on ${must}`).toContain(must);
    }
  });
});
