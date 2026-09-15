import { PROJECT_ROOT, codeOnly, fs, path } from "./support/node";

/**
 * TWO THINGS ABOUT WHERE AN ORDER IS GOING.
 *
 * ── One: the app stopped moving people ──────────────────────────────────
 *
 * `locationStore` persisted nothing, so `status` began every launch at `idle`
 * and the home screen ran `detect()` whenever it saw `idle`. GPS therefore
 * wrote the phone's CURRENT position over whatever the shopper had chosen,
 * every single cold start. Somebody ordering to their mother's house from the
 * office was quietly moved back to the office.
 *
 * Not cosmetic. That pin decides which shops are listed at all, what the
 * delivery fee is, and whether checkout refuses the order as out of area.
 *
 * The rule now: automatic the first time, manual for ever after.
 *
 * ── Two: the address is read, not scanned ───────────────────────────────
 *
 * Checkout listed every saved address as a radio row, on a screen already
 * carrying a basket, a fee, a coupon box, a notes box and a total. So the one
 * thing a person has to check before paying — is this going to the right house
 * — was four lines of identical grey text. It is one sentence now, with
 * Change beside it.
 *
 * Reads source text. The pure logic underneath is covered by
 * `checkoutDefault.test.tsx`; this is the wiring those tests cannot see.
 */

const read = (rel: string) => codeOnly(fs.readFileSync(path.join(PROJECT_ROOT, rel), "utf8"));

const store = read("src/stores/locationStore.ts");
const home = read("src/modules/marketplace/screens/CustomerHomeScreen.tsx");
const picker = read("src/modules/marketplace/screens/LocationScreen.tsx");
const prefs = read("src/common/utils/prefs.ts");
const checkout = read("src/modules/orders/screens/CheckoutScreen.tsx");

describe("the pin a shopper chose is the pin they keep", () => {
  it("is written down when it is set", () => {
    expect(prefs).toContain("setPlace");
    expect(store).toMatch(/remember\(get\)/);
  });

  it("comes back before GPS is ever asked", () => {
    expect(store).toContain("hydrate");
    // The home screen must RESTORE first and detect only on the empty answer.
    // `if (status === "idle") detect()` — the whole bug — must not return.
    expect(home).toMatch(/hydrate\(\)[\s\S]{0,200}?if \(alive && !had\) detect\(\)/);
    expect(home).not.toMatch(/if \(status === "idle"\) detect\(\);/);
  });

  /**
   * The guard itself. Everything else here is plumbing around this one line:
   * GPS does not get an opinion about a pin that already exists.
   */
  it("refuses to detect over a pin that is already there", () => {
    expect(store).toMatch(/if \(!force && get\(\)\.lat !== null\) return;/);
  });

  /**
   * …and the exception, which has to be a person pressing something. Without
   * the argument the control would do nothing for exactly the people who
   * tapped it — a button that silently does nothing is the worst of the three
   * possible outcomes here.
   */
  it("still works when somebody asks for it by hand", () => {
    expect(picker).toMatch(/detect\(true\)/);
  });

  it("can be forgotten, so a move to another city is not a dead end", () => {
    expect(prefs).toContain("forgetPlace");
    expect(store).toContain("forget:");
  });
});

describe("checkout states the address instead of listing four", () => {
  it("draws the chosen one with a way to change it", () => {
    expect(checkout).toContain("Delivering to");
    expect(checkout).toMatch(/setPicking\(true\)/);
  });

  it("keeps the list shut until it is asked for", () => {
    expect(checkout).toMatch(/const \[picking, setPicking\] = useState\(false\)/);
    expect(checkout).toMatch(/\{!picking && \(/);
  });

  /**
   * A truncated address cannot be checked, and checking it is the entire
   * purpose of drawing it. One line is what the ROWS did.
   */
  it("does not truncate the address to one line", () => {
    const block = checkout.slice(checkout.indexOf("styles.chosen"), checkout.indexOf("{picking &&"));
    expect(block).toMatch(/numberOfLines=\{3\}/);
    expect(block).not.toMatch(/numberOfLines=\{1\}/);
  });

  /** Typing has no natural end, so there has to be a way back out. */
  it("has a way to close the picker again", () => {
    expect(checkout).toMatch(/setPicking\(false\)/);
  });
});
