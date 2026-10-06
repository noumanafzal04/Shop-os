import { beforeEach, describe, expect, it } from "vitest";

import { bootTheme, recallTenantTheme, rememberTenantTheme } from "./rememberedTheme";
import { applyTenantTheme, buildRamp } from "./tenantTheme";

/**
 * THE SHOP'S COLOURS ARE ON THE PAGE BEFORE THE PAGE IS.
 *
 * Reported from a counter machine: every reload opened in the house blue and
 * turned into the shop's own colour a moment later, when its settings
 * arrived. What is held here is the boot step — what it puts back, and above
 * all WHOSE it puts back.
 */

const GREEN = "#16a34a";
const root = () => document.documentElement;
const brand = () => root().style.getPropertyValue("--color-brand-500");

const signIn = (user: unknown) =>
  localStorage.setItem("shopos-auth", JSON.stringify({ state: { user }, version: 0 }));

const owner = (tenant: string) => ({ role: "shop_owner", tenant: { id: tenant } });

beforeEach(() => {
  localStorage.clear();
  applyTenantTheme({});
  root().classList.remove("dark");
});

describe("what is kept, and for whom", () => {
  it("gives a shop back its own colours", () => {
    rememberTenantTheme("shop-a", { primary: GREEN, tint: "strong", sidebar: "primary" });

    expect(recallTenantTheme("shop-a")).toEqual({ primary: GREEN, tint: "strong", sidebar: "primary" });
  });

  it("gives another shop nothing", () => {
    rememberTenantTheme("shop-a", { primary: GREEN });

    expect(recallTenantTheme("shop-b")).toBeNull();
    expect(recallTenantTheme(null)).toBeNull();
  });

  it("reads rubbish as nothing rather than throwing on the way in", () => {
    localStorage.setItem("shopos-theme", "{not json");

    expect(recallTenantTheme("shop-a")).toBeNull();
  });
});

describe("before the first paint", () => {
  it("puts the signed-in shop's colours on the page", () => {
    rememberTenantTheme("shop-a", { primary: GREEN, tint: "subtle", sidebar: "primary" });
    signIn(owner("shop-a"));
    // The denominator: the page really is in the house look before boot.
    expect(brand()).toBe("");

    bootTheme();

    expect(brand()).toBe(buildRamp(GREEN)[500]);
    expect(root().dataset.sidebar).toBe("primary");
  });

  it("works for staff as it does for the owner", () => {
    rememberTenantTheme("shop-a", { primary: GREEN });
    signIn({ role: "staff", tenant: { id: "shop-a" } });

    bootTheme();

    expect(brand()).toBe(buildRamp(GREEN)[500]);
  });

  it("does NOT dress a different shop in them", () => {
    // Two shops on one counter machine: the second must not open green.
    rememberTenantTheme("shop-a", { primary: GREEN });
    signIn(owner("shop-b"));

    expect(bootTheme().shop).toBeNull();
    expect(brand()).toBe("");
  });

  it("does not dress the platform console, or a signed-out page", () => {
    rememberTenantTheme("shop-a", { primary: GREEN });

    signIn({ role: "super_admin", tenant: null });
    bootTheme();
    expect(brand()).toBe("");

    // A stale tenant on an admin's record must not count either.
    signIn({ role: "super_admin", tenant: { id: "shop-a" } });
    bootTheme();
    expect(brand()).toBe("");

    localStorage.removeItem("shopos-auth");
    bootTheme();
    expect(brand()).toBe("");
  });

  it("puts dark mode on the page too, and takes it off when it is not chosen", () => {
    localStorage.setItem("theme", "dark");
    expect(bootTheme().dark).toBe(true);
    expect(root().classList.contains("dark")).toBe(true);

    localStorage.setItem("theme", "light");
    bootTheme();
    expect(root().classList.contains("dark")).toBe(false);
  });

  it("survives a session it cannot read", () => {
    rememberTenantTheme("shop-a", { primary: GREEN });
    localStorage.setItem("shopos-auth", "][");

    expect(() => bootTheme()).not.toThrow();
    expect(brand()).toBe("");
  });
});
