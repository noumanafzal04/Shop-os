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

describe("checkout states the address and sends you elsewhere to change it", () => {
  /**
   * The address is READ here, and chosen somewhere else.
   *
   * It was a list of radios, then a panel that opened one. Both put the
   * choosing on the screen where money changes hands, when the shopper
   * already has a screen for it with the map, the labels and the delete
   * button on it. So "Change" walks to Addresses, and checkout follows
   * whichever one is the default there.
   */
  it("draws the chosen one with a way to change it", () => {
    expect(checkout).toContain("Delivering to");
    expect(checkout).toMatch(/navigation\.navigate\("Addresses"\)/);
  });

  it("keeps no picker of its own", () => {
    // The whole state machine went. A second place to choose an address is a
    // second place for the choice to disagree with the account.
    expect(checkout).not.toMatch(/setPicking/);
    expect(checkout).not.toMatch(/const \[addressId/);
  });

  /**
   * …so it has to follow the DEFAULT rather than remembering a local pick.
   * A remembered `addressId` would go stale the moment somebody changed the
   * default on the other screen and came back.
   */
  it("follows whichever address the account says is default", () => {
    expect(checkout).toMatch(/saved\.find\(\(a\) => a\.is_default\)/);
  });

  /**
   * A truncated address cannot be checked, and checking it is the entire
   * purpose of drawing it.
   */
  it("does not truncate the address to one line", () => {
    const block = checkout.slice(checkout.indexOf("styles.chosen"), checkout.indexOf("detailWrap"));
    expect(block).toMatch(/numberOfLines=\{3\}/);
    expect(block).not.toMatch(/numberOfLines=\{1\}/);
  });

  /**
   * THE PART A SAVED ADDRESS CANNOT HOLD.
   *
   * An area and a pin get a rider to the street; the flat, the floor and the
   * gate get them to the door, and those change between one order and the
   * next. Typed here, sent with the ORDER — `customer_addresses.address` is
   * one free-text field and storing a flat number in a profile would be
   * putting it where nobody needs it.
   */
  it("asks for the door, not just the street", () => {
    expect(checkout).toContain("House / flat / floor");
    expect(checkout).toMatch(/const \[detail, setDetail\]/);
  });

  /**
   * And the flat leads, because somebody reading it at a gate wants the part
   * that differs from everything around them — not forty characters of area
   * first.
   */
  it("puts the door before the area in what the shop is told", () => {
    expect(checkout).toMatch(/\[detail\.trim\(\),[\s\S]{0,120}?selected \? selected\.address/);
  });

  /** Somebody with no saved address can still order — a wall here is worse. */
  it("still lets a first-time buyer type one", () => {
    expect(checkout).toMatch(/selected === null && \(/);
    expect(checkout).toContain("House, street, area…");
  });
});
