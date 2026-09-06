import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * EVERY SETTING A SHOP HAS IS A SETTING A SHOP CAN SET.
 *
 * ── The bug this exists for ──────────────────────────────────────────
 *
 * `delivery_provider` decides whether a delivery order is offered to CartZe's
 * rider pool or stays with the shop's own riders. It was in the backend's
 * `defaults()`, in its `rules()`, documented in a comment, read by
 * `OrderService` to start the offer engine and by `RiderService` to decide who
 * may take the job — and it had NO CONTROL ON ANY SCREEN.
 *
 * So every shop had whatever the default said, and none of them could say
 * otherwise. The offer engine, the widening radius, the give-up notice, the
 * accept race — all of it was written, tested and unreachable, because the one
 * switch that turned it on did not exist.
 *
 * Nothing failed. There is no error for a setting nobody can reach; the screen
 * simply does not mention it, which looks exactly like a screen that is
 * finished.
 *
 * ── What this guard actually asks ────────────────────────────────────
 *
 * Every key on `ShopSettings` — the panel's own type for what a shop stores —
 * is written by some control, OR is named below with a reason. A key that is
 * neither is a switch with nothing behind it.
 *
 * The list below is the point of the test. Adding a key to it is easy and
 * that is fine — what it is not is silent.
 */

const ROOT = path.resolve(__dirname, "../../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/**
 * Settings a shop does not set on the settings screen, and why.
 *
 * Each of these is reachable or deliberately fixed. None of them is "we forgot
 * a control" — that is the case this test is looking for.
 */
const NOT_SET_HERE: Record<string, string> = {
  // Its own screen: the theme customiser writes all four together as one
  // object, because a half-applied palette is worse than the default one.
  theme_primary: "ThemeCustomizer",
  theme_secondary: "ThemeCustomizer",
  theme_tint: "ThemeCustomizer",
  theme_sidebar: "ThemeCustomizer",
  // Derived, not chosen: the symbol follows the currency, and is shown as a
  // read-only unit beside price fields.
  currency_symbol: "derived from currency",
  // PKR is the only currency the product sells in, and English the only
  // language it ships. Both stay in the payload so neither becomes a migration
  // the day that changes.
  currency: "fixed — PKR",
  language: "fixed — one language ships today",
  // The plan decides this, not the shop. A shop that could raise its own
  // branch ceiling would be a shop that never upgrades.
  max_branches: "set by the subscription plan",
};

function settingsKeys(): string[] {
  const src = read("src/modules/shop/services/shopService.ts");
  const m = /export interface ShopSettings\s*\{([\s\S]*?)\n\}/.exec(src);
  // THE DENOMINATOR. Rename the interface and every assertion below would pass
  // by comparing an empty list against an empty list.
  expect(m).not.toBeNull();

  const body = (m as RegExpExecArray)[1]
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  const keys = [...body.matchAll(/^\s*([a-z_0-9]+)\??\s*:/gm)].map((k) => k[1]);
  expect(keys.length).toBeGreaterThan(40);
  return keys;
}

/** Keys some control writes, by the two setter shapes the settings page uses. */
function keysWithAControl(): Set<string> {
  const page = read("src/modules/shop/pages/ShopSettingsPage.tsx");
  const written = new Set<string>();
  for (const m of page.matchAll(/\bsetP\(\s*"([a-z_0-9]+)"/g)) written.add(m[1]);
  for (const m of page.matchAll(/\bset\(\s*"([a-z_0-9]+)"/g)) written.add(m[1]);

  // Same denominator question, for the other half of the comparison.
  expect(written.size).toBeGreaterThan(30);
  return written;
}

describe("a shop can reach every setting it has", () => {
  it("has a control for each one, or a stated reason it has none", () => {
    const orphans = settingsKeys().filter(
      (k) => !keysWithAControl().has(k) && !(k in NOT_SET_HERE),
    );

    expect(orphans).toEqual([]);
  });

  it("has a control for who carries a delivery", () => {
    // Named on its own because this is the key the guard was written for, and
    // a key that only a list protects is a key a list can quietly lose.
    expect(keysWithAControl()).toContain("delivery_provider");
  });

  it("does not excuse a key that no longer exists", () => {
    // The list rots in the other direction too: a setting removed from the
    // backend leaves a reason here explaining nothing, and the next person
    // reads it as a rule.
    const keys = new Set(settingsKeys());
    expect(Object.keys(NOT_SET_HERE).filter((k) => !keys.has(k))).toEqual([]);
  });
});
