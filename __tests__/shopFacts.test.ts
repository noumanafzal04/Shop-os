import { shopFacts, shopFactsShort } from "../src/modules/marketplace/shopFacts";
import { PROJECT_ROOT, fs, path, sourceFiles } from "./support/node";
import type { PublicShop } from "../src/modules/marketplace/services/marketplaceService";

/**
 * The line under a shop's name, on the two screens that draw a shop.
 *
 * Written once because it used to be written twice, and the two copies had
 * already drifted — the shops list labelled every open shop "Open" and the home
 * row did not.
 */

const shop = (over: Partial<PublicShop> = {}): PublicShop =>
  ({
    slug: "burger-hut",
    business_name: "Burger Hut",
    business_type: "food",
    business_category: null,
    city: null,
    logo_path: null,
    rating: null,
    reviews_count: 0,
    ...over,
  }) as PublicShop;

const text = (s: PublicShop) => shopFacts(s).map((f) => f.text);

describe("what a card says about delivery", () => {
  it("prices it when there is a fee", () => {
    expect(text(shop({ delivery_fee: 120 }))).toContain("Rs 120 delivery");
  });

  it("calls a zero fee free when the shop delivers", () => {
    expect(text(shop({ delivery_fee: 0, delivers: true }))).toContain("Free delivery");
  });

  it("still reads a shop page that predates the list field", () => {
    // `fulfillment` is the same fact from the detail payload. A shop opened
    // from a cached response has one and not the other.
    expect(text(shop({ delivery_fee: 0, fulfillment: { delivery: true, pickup: true } })))
      .toContain("Free delivery");
  });

  it("says nothing about delivery for a shop that only does pickup", () => {
    // The trap: `delivery_fee` is 0 both for a shop that delivers free AND for
    // one that does not deliver at all. Reading the fee alone puts "Free
    // delivery" on a counter you have to walk to.
    const facts = text(shop({ delivery_fee: 0, delivers: false }));

    expect(facts).not.toContain("Free delivery");
    expect(facts.join(" ")).not.toMatch(/delivery/i);
  });

  it("says nothing when the shop has not been asked", async () => {
    // The list payload carried no fee at all until recently. Absent is not
    // zero, and zero is not free.
    expect(text(shop({}))).toHaveLength(0);
  });

  it("states a free-delivery threshold as the offer it is", () => {
    expect(text(shop({ free_delivery_threshold: 1500 }))).toContain("Free over Rs 1,500");
  });
});

describe("what it says about time and distance", () => {
  it("shows a prep time when the shop has set one", () => {
    expect(text(shop({ prep_time_minutes: 35 }))).toContain("35 min");
  });

  it("never says a shop is ready in zero minutes", () => {
    // An unset prep time reaches the app as null and, once it was ever a
    // number, as 0. "Ready in 0 min" is a promise no shop made.
    expect(text(shop({ prep_time_minutes: null })).join(" ")).not.toMatch(/min/);
    expect(text(shop({ prep_time_minutes: 0 })).join(" ")).not.toMatch(/min/);
  });

  it.each([
    [0, "0 m", "at your door"],
    [0.35, "350 m", "walking distance"],
    [2.44, "2.4 km", "across town"],
    [945.812, "946 km", "another city"],
  ])("shows %s as %s (%s)", (km, expected) => {
    // The server sends two decimals and the card used to print them:
    // "945.81 km". Nobody needs a shop's distance to ten metres, and at that
    // length the digits push the delivery fee off the edge of the card.
    expect(text(shop({ distance_km: km }))).toContain(expected);
  });

  it("shows a shop at your door rather than treating zero as unknown", () => {
    expect(text(shop({ distance_km: 0 })).length).toBeGreaterThan(0);
  });
});

describe("what fits on a card", () => {
  it("keeps the most decidable facts first", () => {
    const full = shop({
      rating: 4.6,
      prep_time_minutes: 30,
      delivery_fee: 90,
      free_delivery_threshold: 1200,
      distance_km: 3.1,
    });

    // A card that wraps to three lines pushes the next card off the screen,
    // and a row of cards exists to be scanned.
    expect(shopFactsShort(full)).toHaveLength(3);
    expect(shopFactsShort(full).map((f) => f.text)).toEqual([
      "4.6",
      "30 min",
      "Rs 90 delivery",
    ]);
  });

  it("marks an offer so it can be coloured", () => {
    const offer = shopFacts(shop({ free_delivery_threshold: 999 }))[0];

    expect(offer.tone).toBe("offer");
  });
});

describe("nobody writes the distance out by hand", () => {
  it("has no screen printing the raw two-decimal value", () => {
    // This rule was copied FIVE times — a deal card, two search lists, a shop
    // header and a shop row — and every copy printed "945.81 km". A distance
    // that reads differently on two screens for the same shop is a distance
    // nobody trusts on either.
    const files = sourceFiles(path.join(PROJECT_ROOT, "src"));
    expect(files.length).toBeGreaterThan(30);

    const raw = files
      .flatMap((f) =>
        fs
          .readFileSync(f, "utf8")
          .split("\n")
          .map((line, i) => [i + 1, line] as const)
          .filter(([, line]) => /distance_km\}\s*km|distance_km\s*\+\s*" km"/.test(line))
          .map(([n, line]) => `  ${path.relative(PROJECT_ROOT, f)}:${n}  ${line.trim()}`),
      );

    expect(raw.join("\n")).toBe("");
  });
});

describe("nobody invents a prep time the shop never set", () => {
  it("has no `?? 30` standing in for a missing one", () => {
    // The shop page printed "Delivery 30–50 min" beside a shop's own name for
    // a shop that had set nothing — a promise the app made on the kitchen's
    // behalf, which the kitchen is then late against.
    const files = sourceFiles(path.join(PROJECT_ROOT, "src"));
    expect(files.length).toBeGreaterThan(30);

    const invented = files
      .flatMap((f) =>
        fs
          .readFileSync(f, "utf8")
          .split("\n")
          .map((line, i) => [i + 1, line] as const)
          .filter(([, line]) => /prep_time_minutes\s*\?\?\s*\d/.test(line))
          .map(([n, line]) => `  ${path.relative(PROJECT_ROOT, f)}:${n}  ${line.trim()}`),
      );

    expect(invented.join("\n")).toBe("");
  });
});
