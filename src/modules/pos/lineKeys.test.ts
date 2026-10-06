import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "A discount on one row is applied to another row too."
 *
 * Each test loads the module FRESH, because that is the bug: a page reload is
 * a new module with its counter at nought, holding lines the old one keyed.
 */

type Keys = typeof import("./lineKeys");

const freshPage = async (): Promise<Keys> => {
  vi.resetModules();

  return import("./lineKeys");
};

const distinct = (keys: string[]) => new Set(keys).size === keys.length;

describe("a cart that came back after a refresh", () => {
  let parked: Array<{ key: string; name: string }>;

  beforeEach(async () => {
    // The page before the refresh rang two things and parked them.
    const before = await freshPage();
    parked = [
      { key: before.nextLineKey(), name: "Oil" },
      { key: before.nextLineKey(), name: "Rice" },
    ];
    expect(parked.map((l) => l.key)).toEqual(["c1", "c2"]);
  });

  it("shares a key with the next item rung, if its keys are trusted — the bug", async () => {
    const after = await freshPage();

    // What the till did: kept c1 and c2, and counted from nought again.
    const cart = [...parked, { key: after.nextLineKey(), name: "Soap" }];

    expect(distinct(cart.map((l) => l.key))).toBe(false);
  });

  it("never shares a key once the restored lines are re-keyed", async () => {
    const after = await freshPage();

    const cart = [...after.rekeyed(parked), { key: after.nextLineKey(), name: "Soap" }];

    expect(distinct(cart.map((l) => l.key))).toBe(true);
    // The lines themselves are untouched, and in the order they were rung.
    expect(cart.map((l) => l.name)).toEqual(["Oil", "Rice", "Soap"]);
  });

  it("heals a cart that was parked with two lines already on one key", async () => {
    const after = await freshPage();
    const broken = [
      { key: "c1", name: "Oil" },
      { key: "c2", name: "Rice" },
      { key: "c1", name: "Soap" },
    ];

    expect(distinct(after.rekeyed(broken).map((l) => l.key))).toBe(true);
  });
});

describe("a page that is never refreshed", () => {
  it("gives every line a key of its own, however many are rung", async () => {
    const page = await freshPage();
    const keys = Array.from({ length: 500 }, () => page.nextLineKey());

    expect(distinct(keys)).toBe(true);
  });

  it("does not hand a held ticket's lines the keys of the cart it replaces", async () => {
    const page = await freshPage();
    const cart = [{ key: page.nextLineKey(), name: "Oil" }];
    const held = page.rekeyed([{ key: "c1", name: "Tea" }]);

    expect(held[0].key).not.toBe(cart[0].key);
  });
});
