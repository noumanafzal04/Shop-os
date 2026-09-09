import { PROJECT_ROOT, codeOnly, fs, path } from "./support/node";

/**
 * EVERY LIST SENDS THE PIN AND THE CITY — OR IT IS WRONG AND SAYS NOTHING.
 *
 * The server decides what a shopper may see from a city AND a pin
 * (`Tenant::scopeServesPin`): same city, and within each shop's own
 * `delivery_radius_km`. Both halves have to arrive on every list:
 *
 *   no `city_id` → other cities' shops appear (what happened — the app sent
 *                  the pin and never the city, for months);
 *   no pin       → nothing is fenced by the shop's radius, so a shop 30 km
 *                  away that delivers 5 is listed and refuses at checkout.
 *
 * Four hooks need it and three are called from more than one screen. That is
 * seven places to forget one field, which is the shape of every "guards share
 * a blind spot" bug in this repo — so the check is that every one of them goes
 * through `useServingPin`, not that each screen happens to name `lat`.
 */
const read = (p: string) => codeOnly(fs.readFileSync(path.join(PROJECT_ROOT, p), "utf8"));

/** Screen → the query it must fence. */
const LISTS: Array<[string, RegExp]> = [
  ["src/modules/marketplace/screens/CustomerHomeScreen.tsx", /useHomeFeed\(pin\)/],
  ["src/modules/marketplace/screens/MarketScreen.tsx", /useHomeFeed\(pin\)/],
  ["src/modules/marketplace/screens/SearchScreen.tsx", /useUniversalSearch\(debounced, pin\)/],
];

describe("the marketplace asks with a pin and a city", () => {
  it.each(LISTS)("%s fences its query", (file, call) => {
    const src = read(file);

    expect(src).toMatch(/useServingPin\(\)/);
    expect(src).toMatch(call);
  });

  it("the shop list spreads the pin into its query", () => {
    const src = read("src/modules/marketplace/screens/MarketScreen.tsx");

    expect(src).toMatch(/\.\.\.pin,/);
  });

  it("the aisle puts the pin on the BASE, never on the filters", () => {
    /**
     * Load-bearing placement. On the filters side, one Reset would widen the
     * aisle to shops that cannot deliver here — Reset clears what the shopper
     * PICKED, and the fence is not a choice.
     */
    const src = read("src/modules/marketplace/screens/BrowseScreen.tsx");
    const base = src.slice(src.indexOf("const base:"), src.indexOf("const [filters"));

    expect(base).toMatch(/\.\.\.pin,/);
  });

  it("sends the city, not just the coordinates", () => {
    // The half that was missing for months. A pin without a city is fenced by
    // each shop's radius and by nothing else.
    const hook = read("src/modules/marketplace/servingPin.ts");

    expect(hook).toMatch(/city_id: city\?\.id \?\? undefined/);
    expect(hook).toMatch(/lat: lat \?\? undefined/);
    expect(hook).toMatch(/lng: lng \?\? undefined/);
  });

  it("returns undefined rather than null", () => {
    // These go into a query-string builder that drops `undefined` and would
    // send `city_id=null` as the four letters.
    const hook = read("src/modules/marketplace/servingPin.ts");

    expect(hook).not.toMatch(/city_id: city\?\.id \?\? null/);
  });

  it("selects each field on its own, so a store touch does not re-render every list", () => {
    /**
     * zustand compares a selector's result by identity, so
     * `(s) => ({ lat, lng })` returns a new object every render. This is not
     * style: the home screen, the aisle and the shop list all subscribe.
     */
    const hook = read("src/modules/marketplace/servingPin.ts");

    expect(hook).toMatch(/useLocationStore\(\(s\) => s\.lat\)/);
    expect(hook).toMatch(/useLocationStore\(\(s\) => s\.lng\)/);
    expect(hook).toMatch(/useLocationStore\(\(s\) => s\.city\)/);
  });

  it("puts lat and lng on the aisle's own filter type", () => {
    // The server validates them on `/marketplace/products`; a filter the app
    // cannot express is a fence the aisle cannot have.
    const service = read("src/modules/marketplace/services/marketplaceService.ts");

    expect(service).toMatch(/put\("lat", f\.lat\)/);
    expect(service).toMatch(/put\("lng", f\.lng\)/);
  });
});

describe("the rider board's empty state", () => {
  const src = read("src/modules/rider/screens/RiderHomeScreen.tsx");

  it("reads the server's reason instead of guessing at three of six", () => {
    /**
     * "Rider side no order coming." The screen derived its empty state from
     * duty and the job count — the only two of the six reasons it could see —
     * so the one that had actually happened (not in the pool at all) came out
     * as "No deliveries near you".
     */
    expect(src).toMatch(/const blocked = board\.data\?\.blocked \?\? null;/);
    expect(src).toMatch(/message=\{\s*blocked\?\.message \?\?/);
  });

  it("offers the switch that did not exist", () => {
    // A reason nobody can act on is the same empty page with more words.
    // `is_platform` defaulted to false and was writable only in the apply
    // payload, which `apply` refuses once a rider is approved.
    expect(src).toMatch(/blocked\?\.code === "not_platform"/);
    expect(src).toMatch(/setPool\.mutate\(true\)/);
  });

  it("says nothing at all when nothing is wrong", () => {
    // A warning on a quiet afternoon teaches a rider to ignore all of them.
    expect(src).toMatch(/tone=\{blocked \? "warm" : "muted"\}/);
  });
});
