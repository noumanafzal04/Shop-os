import { describe, expect, it } from "vitest";

/**
 * Every tender the counter can actually reach.
 *
 * ── What was wrong ──────────────────────────────────────────────────────
 *
 * A mobile wallet — JazzCash, Easypaisa, Raast — had no button. The pay panel
 * offered Cash / Card / Khata / Split, and `bank_transfer` existed only inside
 * the split sheet, labelled "Bank / wallet". So the daily tender was rung as
 * one of two things it is not, and the shop closed its day with a single
 * figure covering two apps that reconcile separately.
 *
 * ── Why this reads the source ───────────────────────────────────────────
 *
 * `PosPage` is the till: a shift, a catalog, an outbox, a scanner and a
 * printer before it draws a button. Rendering it to ask which five buttons are
 * in one row costs more than it proves. What is being checked here is a list
 * and a label map — text — so the test reads text. Same instrument as
 * `posChrome.test.ts`, and the same limitation: it proves the source says
 * this, not that the pixels arrived.
 *
 * The rendered half is covered where it is cheap: `canSellOffline.test.ts`
 * proves the till will TAKE a wallet, and `WalletTenderTest` on the server
 * proves the drawer does not move when it does.
 */

const SOURCE = Object.entries(
  import.meta.glob("./pages/PosPage.tsx", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>,
)[0]?.[1];

/** The tender array literal the button row maps over. */
const ROW = (): string[] => {
  const at = SOURCE.indexOf('aria-labelledby="tender-method-label"');
  if (at === -1) throw new Error("the tender row moved — find it before trusting this file");
  const list = SOURCE.slice(at).match(/\(\[([^\]]*)\] as const\)\.map/);
  if (list === null) throw new Error("the tender row is no longer a literal array");

  return [...list[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
};

/** Keys of the `METHOD_LABEL` map. */
const LABELLED = (): string[] => {
  const at = SOURCE.indexOf("const METHOD_LABEL");
  if (at === -1) throw new Error("METHOD_LABEL is gone — labels have drifted back into the JSX");
  const body = SOURCE.slice(at, SOURCE.indexOf("};", at));

  return [...body.matchAll(/^\s{2}([a-z_]+):/gm)].map((m) => m[1]);
};

describe("the tender row", () => {
  it("has the file to read", () => {
    expect(SOURCE).toBeDefined();
  });

  it("offers a wallet, in its own right", () => {
    expect(ROW()).toContain("wallet");
  });

  it("still offers the four it always had", () => {
    expect(ROW()).toEqual(expect.arrayContaining(["cash", "card", "credit", "split"]));
  });

  /**
   * A wallet is taken INSTEAD of cash or a card, so it belongs beside them —
   * before khata, which is not money arriving at all, and before split, which
   * is a way of combining the others rather than one of them.
   */
  it("puts the wallet among the tenders that are money now", () => {
    const row = ROW();
    expect(row.indexOf("wallet")).toBeGreaterThan(row.indexOf("cash"));
    expect(row.indexOf("wallet")).toBeLessThan(row.indexOf("credit"));
  });

  /**
   * Every button in the row must have a word under it.
   *
   * The labels used to be a ternary chain ending in `: "Cash"`, which is not a
   * label so much as a default: a fifth tender added to the row would have
   * been drawn, pressed, and called Cash.
   */
  it("has a label for every tender it draws", () => {
    expect(LABELLED().sort()).toEqual(ROW().sort());
  });

  it("no longer falls back to calling an unknown tender Cash", () => {
    expect(SOURCE).not.toMatch(/m === "card" \? "Card" : "Cash"/);
  });

  /**
   * The badge said "Default" under Cash whatever the shop had chosen, so a
   * shop that set Card was told twice — once by the pre-selected button and
   * once, contradicting it, by the badge.
   */
  it("marks the shop's own default, not always cash", () => {
    expect(SOURCE).toContain("{m === defaultTender && ");
    expect(SOURCE).not.toContain('{m === "cash" && <span');
  });

  /** Half a bill on the phone is the common case, so the split sheet needs it too. */
  it("offers a wallet inside a split as well", () => {
    expect(SOURCE).toContain('<option value="wallet">');
  });
});
