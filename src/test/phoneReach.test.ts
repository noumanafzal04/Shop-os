import { describe, expect, it } from "vitest";

/**
 * PHASE 11 — DEVICES AND REACH (#DV1–#DV9).
 *
 * Measured by the tester in a phone-sized browser; held here as text, because
 * Playwright never runs beside the unit suite. Each check names what the
 * phone found and the line that answers it.
 */
const read = (glob: Record<string, unknown>): string => Object.values(glob).join("\n");

const pos = read(import.meta.glob("../modules/pos/pages/PosPage.tsx", { query: "?raw", import: "default", eager: true }));
const parkSpec = read(import.meta.glob("../../e2e/offline-shift.spec.ts", { query: "?raw", import: "default", eager: true }));
const enterSpec = read(import.meta.glob("../../e2e/till-enter.spec.ts", { query: "?raw", import: "default", eager: true }));
const authSetup = read(import.meta.glob("../../e2e/auth.setup.ts", { query: "?raw", import: "default", eager: true }));
const newPo = read(import.meta.glob("../modules/purchases/components/NewPurchaseOrder.tsx", { query: "?raw", import: "default", eager: true }));
const tree = read(import.meta.glob("../modules/catalog/components/CategoryTree.tsx", { query: "?raw", import: "default", eager: true }));
const newSale = read(import.meta.glob("../modules/sales/pages/NewSalePage.tsx", { query: "?raw", import: "default", eager: true }));
const takeOrder = read(import.meta.glob("../modules/orders/pages/TakeOrderPage.tsx", { query: "?raw", import: "default", eager: true }));
const labels = read(import.meta.glob("../modules/catalog/pages/LabelsPage.tsx", { query: "?raw", import: "default", eager: true }));
const cashbook = read(import.meta.glob("../modules/income/pages/CashbookPage.tsx", { query: "?raw", import: "default", eager: true }));

describe("the specs say what the screen says", () => {
  it("#DV1 a parked ticket is named by the box's label, and a missing box fails", () => {
    expect(pos).toMatch(/<label htmlFor="hold-ticket-name"[^>]*>\s*Name this ticket\s*<\/label>/);
    expect(pos).toMatch(/<input\s+id="hold-ticket-name"/);
    expect(parkSpec).toMatch(/holdDialog\.getByLabel\("Name this ticket"\)/);
    expect(parkSpec, "a required step is skipped without a word again").not.toMatch(/if \(await labelBox\.isVisible/);
    expect(parkSpec).not.toMatch(/Customer name/);
  });

  it("#DV7 the miss the spec looks for is the miss the till says", () => {
    expect(enterSpec).not.toMatch(/No item found for that code/);
    const literal = enterSpec.match(/const MISSED = \/(.+)\/;/)?.[1];
    expect(literal, "till-enter.spec.ts lost its MISSED").toBeTruthy();
    // PosPage writes `Nothing here matches ${code.trim()}.` — both misses.
    expect(pos.match(/`Nothing here matches \$\{code\.trim\(\)\}\.`/g)?.length).toBe(2);
    expect(new RegExp(literal!).test("Nothing here matches E2E-NOPE-9Z.")).toBe(true);
  });

  it("#DV8 the sign-in setup is given the time its own waits take", () => {
    expect(authSetup).toMatch(/setup\.setTimeout\(ATTEMPTS \* ONE_TRY \+ \(ATTEMPTS - 1\) \* LIMITER_WAIT \+ AFTER_SIGN_IN\);/);
    expect(authSetup).toMatch(/if \(attempt >= ATTEMPTS\) throw e;\s*await page\.waitForTimeout\(LIMITER_WAIT\);/);
  });
});

describe("a finger reaches it on a phone", () => {
  it("#DV2 the shift banner's buttons are 32 px tall", () => {
    const banner = pos.slice(pos.indexOf('data-testid="shift-banner"'), pos.indexOf("Open shift", pos.indexOf('data-testid="shift-banner"')) + 20);
    expect(banner.match(/className="min-h-8 rounded-lg bg-white\/20/g)?.length).toBe(2);
  });

  it("#DV3 a new purchase order keeps its buttons inside the screen", () => {
    expect(newPo).toMatch(/<ModalForm\s+title="New purchase order"/);
    expect(newPo).toMatch(/footer=\{[\s\S]*Save draft[\s\S]*Place order[\s\S]*\}\s*>/);
  });

  it("#DV4 the category grip, twisty and item count are a finger wide", () => {
    expect(tree).toMatch(/className="flex h-9 w-9 shrink-0 cursor-grab/);
    expect(tree).toMatch(/className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md/);
    expect(tree).toMatch(/className="inline-flex min-h-8 shrink-0 items-center rounded-md px-1\.5/);
  });

  it("#DV5 a new sale's money boxes are 32 px tall", () => {
    expect(newSale.match(/className="min-h-8 w-28 rounded border/g)?.length).toBe(2);
  });

  it("#DV6 the links back are a finger tall, and the cashbook's day is one line", () => {
    expect(newSale).toMatch(/to="\/tenant\/sales" className="inline-flex min-h-8 items-center/);
    expect(takeOrder).toMatch(/to="\/tenant\/orders"\s+className="inline-flex min-h-8 items-center/);
    expect(labels).toMatch(/to="\/tenant\/products" className="inline-flex min-h-8 items-center/);
    expect(cashbook).toMatch(/className="inline-flex min-h-8 items-center whitespace-nowrap text-brand-600/);
  });
});

it("#DV9 one parked item is '1 item'", () => {
  expect(pos).toMatch(/\{counted\(h\.cart\.items\.length, "item"\)\} · \{money\(h\.total_estimate\)\}/);
  expect(pos).not.toMatch(/\{h\.cart\.items\.length\} items/);
});
