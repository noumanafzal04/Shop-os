import { describe, expect, it } from "vitest";

/**
 * A SHOP HAS TWO PICTURES, AND BOTH HAVE TO BE REACHABLE.
 *
 * ── What was wrong ──────────────────────────────────────────────────────
 *
 * The logo upload lived inside the Invoice / receipt card, behind
 * `{!!prefs.invoice_show_logo && …}`. `uploadLogo` has exactly one caller in
 * the whole panel, so that condition was the only door to it: a shop that does
 * not print a logo on its paperwork could not upload one AT ALL.
 *
 * And the logo is not an invoice thing. It is what the phone draws beside a
 * shop's name — on the home screen's shop cards, in search suggestions, in the
 * basket — none of which involves a printer. A print toggle was switching off
 * a marketplace feature, which is the same bug class as the reorder list that
 * was built and unreachable.
 *
 * ── And they were not told apart ────────────────────────────────────────
 *
 * One was "Cover photo" and the other was described as the invoice logo, so
 * the two were easy to confuse and the question came back as "logo kahan se
 * update hota, cover to settings main hai". They are named for what a customer
 * sees now: SHOP LOGO (the small square beside the name) and SHOP ONLINE
 * BANNER (the wide picture across the top).
 */
const read = (glob: Record<string, unknown>): string =>
  Object.values(glob).map((m) => (m as { default: string }).default).join("\n");

const page = read(import.meta.glob("./pages/ShopSettingsPage.tsx", { query: "?raw", eager: true }));
const codeOnly = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
const code = codeOnly(page);

/** The section a piece of markup sits in, by the SectionCard titles around it. */
const sectionOf = (needle: string): string => {
  const at = code.indexOf(needle);
  expect(at).toBeGreaterThan(-1);
  const before = code.slice(0, at);
  // `[\s\S]*?` and not `[^>]*?`: a SectionCard's own attributes contain a
  // `>` — `icon={<StoreGlyph />}` — so stopping at the first one never reaches
  // the title, and every lookup came back empty. A guard that answers "" for
  // everything agrees with nothing, which is how it failed loudly rather than
  // passing quietly.
  const titles = [...before.matchAll(/<SectionCard[\s\S]*?title="([^"]+)"/g)];

  return titles.length > 0 ? titles[titles.length - 1][1] : "";
};

describe("both pictures can actually be uploaded", () => {
  it("keeps the logo out of the invoice card", () => {
    // The regression, by section. Invoice / receipt is where it was, and the
    // print toggle is the reason it was unreachable.
    expect(sectionOf("logoRef.current?.click()")).toBe("Business profile");
  });

  it("does not gate the logo on a printing preference", () => {
    // Nothing between the upload control and the page may depend on
    // `invoice_show_logo` — that condition was the only door.
    const card = code.slice(
      code.indexOf('title="Business profile"'),
      code.indexOf('title="Online shop"'),
    );
    expect(card).toContain("logoRef");
    expect(card).not.toContain("invoice_show_logo");
  });

  it("leaves the print toggle where printing is decided", () => {
    // It still exists; it just no longer owns the upload.
    expect(sectionOf('label="Show logo"')).toBe("Invoice / receipt");
  });

  it("puts the banner in the customer-facing section", () => {
    expect(sectionOf("coverRef.current?.click()")).toBe("Online shop");
  });

  it("gives the logo a reachable door whatever the plan", () => {
    /**
     * Business profile rather than beside the banner, and that is deliberate.
     * The Online shop card renders its contents only when `online` is true, so
     * an Expense-Manager shop — which still prints invoices — would have had
     * one unreachable door swapped for another.
     */
    const card = code.slice(
      code.indexOf('title="Business profile"'),
      code.indexOf('title="Online shop"'),
    );
    expect(card).not.toMatch(/\{online \?/);
  });
});

describe("the two are named apart", () => {
  it("calls them what a customer sees", () => {
    expect(page).toContain("Shop logo");
    expect(page).toContain("Shop online banner");
  });

  it("no longer calls the banner a cover photo in the UI", () => {
    // The word only survives in the field names — `cover_url`, `coverRef` —
    // which are the API's, not the shopkeeper's.
    expect(page).not.toMatch(/>\s*Cover photo\s*</);
  });

  it("says on each one what the other is for", () => {
    // The confusion was the whole report; the copy is what resolves it.
    expect(page).toMatch(/small square beside your name/);
    expect(page).toMatch(/Different from the logo above/);
  });
});
