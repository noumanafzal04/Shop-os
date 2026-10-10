import { describe, expect, it } from "vitest";

import { kindOfBusiness } from "../../common/tenant/kindOfBusiness";
import { TRADE_FEATURES } from "../../test/tradeFeatures";
import { offlineRules, planSays, subscriptionWords, type LimitRow, usageRows } from "./subscriptionRows";

/** The server's rows for a business, as `PlanLimits::snapshot` sends them. */
function rows(applies: (key: string) => boolean, over: Partial<Record<string, Partial<LimitRow>>> = {}): LimitRow[] {
  const base: LimitRow[] = [
    { key: "products", label: "products", limit: 1000, used: 0, unlimited: false, enforced: true, kind: "count" },
    { key: "orders_month", label: "orders this month", limit: 5000, used: 0, unlimited: false, enforced: false, kind: "count" },
    { key: "storage_mb", label: "MB of storage", limit: 512, used: 0, unlimited: false, enforced: false, kind: "count" },
    { key: "branches", label: "branches", limit: 1, used: 1, unlimited: false, enforced: true, kind: "count" },
    { key: "staff", label: "staff members", limit: 3, used: 0, unlimited: false, enforced: true, kind: "count" },
    { key: "registers", label: "registers", limit: 1, used: 0, unlimited: false, enforced: true, kind: "count" },
    { key: "offline_days", label: "days offline", limit: 3, used: 0, unlimited: false, enforced: false, kind: "policy" },
    { key: "offline_selling", label: "offline selling", limit: 0, used: 0, unlimited: false, enforced: false, kind: "policy", switch: true },
    { key: "offline_hard_stop_days", label: "hard stop after N days offline", limit: 0, used: 0, unlimited: false, enforced: false, kind: "policy", zero_means: "never" },
  ];

  return base.map((r) => ({ ...r, applies: applies(r.key), ...(over[r.key] ?? {}) }));
}

const OFFICE = rows((key) => ["storage_mb", "branches", "staff"].includes(key));
const SHOP = rows(() => true);

describe("what a business is counted against", () => {
  it("an office that bought only the books is counted against people, places and paper", () => {
    expect(usageRows(OFFICE).map((u) => u.key)).toEqual(["storage_mb", "branches", "staff"]);
  });

  it("a shop is counted against everything it can own — and against no rule", () => {
    expect(usageRows(SHOP).map((u) => u.key)).toEqual(["products", "orders_month", "storage_mb", "branches", "staff", "registers"]);
  });

  it("a rule is never a usage bar, for anybody", () => {
    for (const set of [OFFICE, SHOP]) {
      expect(usageRows(set).some((u) => u.kind === "policy")).toBe(false);
    }
  });

  it("an unlimited, unenforced row is left out as it always was", () => {
    const open = rows(() => true, { storage_mb: { limit: null, unlimited: true } });

    expect(usageRows(open).map((u) => u.key)).not.toContain("storage_mb");
  });

  it("an older server that says neither kind nor applies loses nothing", () => {
    const old: LimitRow[] = [{ key: "products", label: "products", limit: 100, used: 4, unlimited: false, enforced: true }];

    expect(usageRows(old)).toHaveLength(1);
    expect(offlineRules(old)).toEqual([]);
  });
});

describe("the rules about working offline, in words", () => {
  it("says nothing to a business with no till", () => {
    expect(offlineRules(OFFICE)).toEqual([]);
  });

  it("says only that it is off when it is off", () => {
    expect(offlineRules(SHOP)).toEqual([
      { key: "offline_selling", label: "Selling with no internet", value: "Off — ask support to turn it on" },
    ]);
  });

  it("says the window and the stop when it is on", () => {
    const on = rows(() => true, { offline_selling: { limit: 1 }, offline_days: { limit: 1 }, offline_hard_stop_days: { limit: 7 } });

    expect(offlineRules(on)).toEqual([
      { key: "offline_selling", label: "Selling with no internet", value: "On" },
      { key: "offline_days", label: "A till may stay out of contact for", value: "1 day" },
      { key: "offline_hard_stop_days", label: "A till stops selling after", value: "7 days offline" },
    ]);
  });

  it("a stop of zero is never, said so", () => {
    const on = rows(() => true, { offline_selling: { limit: 1 } });

    expect(offlineRules(on)[2]).toEqual({
      key: "offline_hard_stop_days",
      label: "A till stops selling after",
      value: "Never — it keeps selling and marks the sales",
    });
    expect(offlineRules(on)[1].value).toBe("3 days");
  });
});

describe("what the subscription page says, by who it is talking to", () => {
  const office = subscriptionWords(kindOfBusiness(TRADE_FEATURES.finance));
  const shop = subscriptionWords(kindOfBusiness(TRADE_FEATURES.mart));

  it("a books-only business is not told about a shop, a sale or its stock", () => {
    for (const [key, said] of Object.entries(office)) {
      expect(said, key).not.toMatch(/\bshop\b|ring a sale|stock|new sales/i);
    }
    expect(office.readOnly).toMatch(/new income and expense entries are paused/);
    expect(office.graceLoses).toMatch(/not be able to record anything new/);
    expect(office.archivedReassurance).toBe("");
    expect(office.runs).toBe("What your business runs");
    expect(office.active).toBe("Your business is active");
  });

  it("a shop is told what it was always told", () => {
    expect(shop.lede).toBe("Where your shop stands, what it can use, and what has been paid.");
    expect(shop.runs).toBe("What your shop runs");
    expect(shop.active).toBe("Your shop is active");
    expect(shop.readOnly).toMatch(/new sales, stock changes and expenses are paused/);
    expect(shop.graceLoses).toMatch(/not be able to ring a sale/);
    expect(shop.archivedReassurance).toBe(" Your stock levels and customer balances are never affected.");
    expect(shop.extended).toBe("Extended for your shop beyond the plan's");
  });
});

describe("what a plan says about itself, to the business reading it", () => {
  const shop = { sells: true };
  const office = { sells: false };
  // The four the platform ships with.
  const BASIC = "One shop, one counter. Everything a single till needs, and two years of history.";
  const STANDARD = "A few branches and a team. Offline selling, and five years of history.";
  const PRO = "A real chain: ten branches, no catalog ceiling, and a week of trading offline.";
  const ENTERPRISE = "Sized to the organisation. Nothing is capped, history is kept for good, and the terms are whatever was agreed.";

  it("a shop is told all of it, as written", () => {
    for (const written of [BASIC, STANDARD, PRO, ENTERPRISE]) expect(planSays(shop, written)).toBe(written);
  });

  it("an office that bought only the books is not told about a till it does not have", () => {
    // On the page that says what it is paying for.
    expect(planSays(office, BASIC)).toBeNull();
    expect(planSays(office, PRO)).toBeNull();
  });

  it("…but is told the sentences that are not about selling", () => {
    expect(planSays(office, STANDARD)).toBe("A few branches and a team.");
  });

  it("a description written for an organisation comes through whole", () => {
    expect(planSays(office, ENTERPRISE)).toBe(ENTERPRISE);
    expect(planSays(office, "For accountants. Unlimited staff, and ten years of history.")).toBe("For accountants. Unlimited staff, and ten years of history.");
  });

  it("is not fooled by a word that only contains one — and is by any case of the real one", () => {
    // "wholesale" has "sale" in it and "restock" has "stock"; neither is the word.
    expect(planSays(office, "A wholesale-sized team.")).toBe("A wholesale-sized team.");
    expect(planSays(office, "Everything a TILL needs.")).toBeNull();
    expect(planSays(office, "No POS limit.")).toBeNull();
  });

  it("a plan with nothing written says nothing", () => {
    expect(planSays(shop, null)).toBeNull();
    expect(planSays(shop, "   ")).toBeNull();
    expect(planSays(office, undefined)).toBeNull();
  });
});

