import { describe, expect, it } from "vitest";

/**
 * THE WEB STOREFRONT HAD HALF THE MARKETPLACE THE PHONE HAS.
 *
 * ── How the gap opened ──────────────────────────────────────────────────
 *
 * Both front doors talk to the same endpoints. The phone was extended each
 * time a fence or a filter was added — the delivery-radius pin, `open_now`,
 * `free_delivery`, the absolute image URLs, the distance on a card — and the
 * web was not, because nothing failed when it was left behind. A filter the
 * client never sends is not an error; it is a wider list.
 *
 * Measured before it was fixed, on `cartze.shop`:
 *
 *   · the word `lat` did not appear anywhere in the marketplace module, so
 *     NO web list was fenced by where the shopper is — a shop that delivers
 *     five kilometres was listed, opened, filled with a basket and refused at
 *     the checkout, which is the exact failure the radius fence exists for;
 *   · `open_now` and `free_delivery` appeared in neither the filter type, the
 *     URL reader, nor the rail — while the server sent a COUNT for each;
 *   · the order payload carried no coordinates, so a web order was never
 *     fenced at all and the rider got an address with no map behind it;
 *   · `PublicShop` declared `logo_path` and neither `logo_url` nor
 *     `cover_url`, so no page could draw a shop's picture even if it tried,
 *     and none did.
 *
 * ── Why this reads the source ───────────────────────────────────────────
 *
 * What is being checked is a VOCABULARY — which names a request carries — and
 * that is text. Rendering four pages, a rail and a checkout to ask whether a
 * query string contains `lat` costs more than it proves. The limitation is the
 * usual one and is stated rather than hidden: this proves the source says so,
 * not that a request left the browser. The server half is proved for real by
 * `FiltersTellTheTruthTest`, which walks every one of these filters through the
 * actual endpoints.
 */
const read = (glob: Record<string, unknown>): string =>
  Object.values(glob).map((m) => (m as { default: string }).default).join("\n");

const service = read(import.meta.glob("./services/marketplaceService.ts", { query: "?raw", eager: true }));
const rail = read(import.meta.glob("./components/FilterRail.tsx", { query: "?raw", eager: true }));
const browse = read(import.meta.glob("./pages/BrowsePage.tsx", { query: "?raw", eager: true }));
const market = read(import.meta.glob("./pages/MarketPage.tsx", { query: "?raw", eager: true }));
const checkout = read(import.meta.glob("./pages/CheckoutPage.tsx", { query: "?raw", eager: true }));
const address = read(import.meta.glob("./components/DeliveryAddressField.tsx", { query: "?raw", eager: true }));
const orders = read(import.meta.glob("../orders/services/ordersService.ts", { query: "?raw", eager: true }));

/** Comments describe the bug; they must never be what satisfies the test. */
const codeOnly = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("the web asks for the shopper's location", () => {
  it("declares a pin on the aisle's filters", () => {
    expect(codeOnly(service)).toMatch(/lat\?: number;/);
    expect(codeOnly(service)).toMatch(/lng\?: number;/);
  });

  it("forwards it on the shop list", () => {
    const shops = codeOnly(service).slice(
      codeOnly(service).indexOf("shops: (params: ShopListParams)"),
      codeOnly(service).indexOf("shop: (slug: string)"),
    );
    expect(shops).not.toBe("");
    expect(shops).toMatch(/lat: params\.lat/);
    expect(shops).toMatch(/lng: params\.lng/);
  });

  it("sends it from both pages that list things", () => {
    // The front page fences four separate lists with it; the aisle merges it
    // in after the URL, because a pin is not a filter you can share in a link.
    expect(codeOnly(market)).toMatch(/usePin\(/);
    expect(codeOnly(browse)).toMatch(/usePin\(/);
    expect(codeOnly(browse)).toMatch(/lat: pin\.lat/);
  });

  it("never asks the browser without being told to", () => {
    // A permission dialog that appears because a page loaded is a dialog
    // people deny, and a denial is remembered for ever.
    const pin = read(import.meta.glob("./usePin.ts", { query: "?raw", eager: true }));
    const code = codeOnly(pin);
    expect(code).toMatch(/getCurrentPosition/);
    // Inside `locate`, which is a callback — never inside an effect.
    expect(code).not.toMatch(/useEffect\([\s\S]*getCurrentPosition/);
  });
});

describe("the web offers the filters the phone offers", () => {
  it("declares open_now and free_delivery", () => {
    expect(codeOnly(service)).toMatch(/open_now\?: boolean;/);
    expect(codeOnly(service)).toMatch(/free_delivery\?: boolean;/);
  });

  it("reads them out of the URL, so they survive a reload and a shared link", () => {
    expect(codeOnly(browse)).toMatch(/open_now: params\.get\("open_now"\)/);
    expect(codeOnly(browse)).toMatch(/free_delivery: params\.get\("free_delivery"\)/);
  });

  it("puts a chip for each on the rail, with the server's own count", () => {
    const code = codeOnly(rail);
    expect(code).toMatch(/label="Open now"/);
    expect(code).toMatch(/label="Free delivery"/);
    expect(code).toMatch(/facets\?\.open_now_count/);
    expect(code).toMatch(/facets\?\.free_delivery_count/);
  });

  it("counts them as active filters, or 'Clear 3' is a lie", () => {
    const code = codeOnly(rail);
    expect(code).toMatch(/\(value\.open_now \? 1 : 0\)/);
    expect(code).toMatch(/\(value\.free_delivery \? 1 : 0\)/);
  });
});

describe("a web order carries a destination", () => {
  it("declares coordinates on the order payload", () => {
    expect(codeOnly(orders)).toMatch(/latitude\?: number;/);
    expect(codeOnly(orders)).toMatch(/longitude\?: number;/);
  });

  it("sends them from the checkout, and only for a delivery", () => {
    const code = codeOnly(checkout);
    expect(code).toMatch(/latitude: mine\.fulfillment === "delivery"/);
    expect(code).toMatch(/longitude: mine\.fulfillment === "delivery"/);
  });

  it("gets them from the address, which now has a pin", () => {
    expect(codeOnly(service)).toMatch(/latitude: number \| null;/);
    expect(codeOnly(address)).toMatch(/getCurrentPosition/);
    // The sentence and the pin arrive together — two setters is how an
    // address ends up wearing a different address's coordinates.
    expect(codeOnly(address)).toMatch(
      /onChange: \(address: string, lat: number \| null, lng: number \| null\) => void;/,
    );
  });
});

describe("a shop's own picture reaches the web", () => {
  it("declares the absolute URLs and not only the storage path", () => {
    const code = codeOnly(service);
    expect(code).toMatch(/logo_url\?: string \| null;/);
    expect(code).toMatch(/cover_url\?: string \| null;/);
  });

  it("draws one on the card, with the letter still there as the fallback", () => {
    const code = codeOnly(market);
    expect(code).toMatch(/shop\.logo_url \?\? shop\.cover_url/);
    expect(code).toMatch(/shop\.business_name\.charAt\(0\)/);
  });

  it("declares what a card needs to be decided on", () => {
    const code = codeOnly(service);
    for (const field of ["delivers", "distance_km", "delivers_to_me", "prep_time_minutes"]) {
      expect(code).toMatch(new RegExp(`${field}\\??:`));
    }
  });
});
