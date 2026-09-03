import { describe, expect, it } from "vitest";

import { TRADE_FEATURES as TRADES } from "../../test/tradeFeatures";
import { HELP_ARTICLES, HELP_GROUPS, articlesFor, searchArticles } from "./content";
import { TENANT_ROUTES } from "../../test/routes";

/**
 * What each kind of shop is told.
 *
 * The Help Centre filters on the same three axes as the sidebar — module,
 * trade, person — and it has to, because help describing a screen you do not
 * have is worse than no help: it reads as a fault in the software. A
 * restaurant told how to count stock will go looking for an Inventory screen
 * that its business type does not include, and conclude something is broken.
 *
 * These pin what each trade is offered. They assert on the LIST, not a count:
 * a count says something changed, and what changed is the whole question.
 */

/** The module map each trade is created with (Modules::defaultsFor). */

const owner = () => true;

function idsFor(trade: string, can: (p: string) => boolean = owner): string[] {
  return articlesFor(TRADES[trade], trade, can).map((a) => a.id);
}

describe("what each trade is shown", () => {
  it("gives a restaurant the floor and the kitchen, and no stock counting", () => {
    const food = idsFor("food");

    expect(food).toContain("dine-in");
    expect(food).toContain("kitchen");
    // A kitchen depletes by recipe. There is no Inventory screen to describe.
    expect(food).not.toContain("inventory");
    expect(food).not.toContain("batches");
  });

  it("gives a pharmacy batches and the prescription counter", () => {
    const pharmacy = idsFor("pharmacy");

    expect(pharmacy).toContain("batches");
    expect(pharmacy).toContain("prescriptions");
    expect(pharmacy).not.toContain("dine-in");
    expect(pharmacy).not.toContain("kitchen");
  });

  it("gives a mart stock but not prescriptions", () => {
    const mart = idsFor("mart");

    expect(mart).toContain("inventory");
    expect(mart).toContain("purchases");
    expect(mart).not.toContain("prescriptions");
    expect(mart).not.toContain("serials");
  });

  it("gives retail serial numbers and warranty", () => {
    expect(idsFor("retail")).toContain("serials");
    // Same POS module, but the trade decides whether serials are a thing.
    expect(idsFor("mart")).not.toContain("serials");
  });

  it("gives a petrol pump the forecourt", () => {
    const petroleum = idsFor("petroleum");

    expect(petroleum).toContain("forecourt");
    expect(idsFor("mart")).not.toContain("forecourt");
  });

  it("gives a books-only business the money screens and nothing to sell with", () => {
    const finance = idsFor("finance");

    expect(finance).toContain("ledger");
    expect(finance).toContain("expenses");
    // No till, no catalog, no stock — and so no articles about any of them.
    expect(finance).not.toContain("pos");
    expect(finance).not.toContain("products");
    expect(finance).not.toContain("inventory");
    expect(finance).not.toContain("day");
  });

  it("gives a salon its catalog of services but no stock", () => {
    const services = idsFor("services");

    // `products` OR `services` opens the catalog article — a salon bills
    // labour, and still has to add it to a catalog.
    expect(services).toContain("products");
    expect(services).not.toContain("inventory");
    expect(services).not.toContain("purchases");
  });
});

describe("what each person is shown", () => {
  const holding = (...permissions: string[]) => (p: string) => permissions.includes(p);

  it("shows a kitchen hand the board and nothing about the till", () => {
    const kitchen = idsFor("food", holding("kitchen.manage"));

    expect(kitchen).toContain("kitchen");
    expect(kitchen).not.toContain("pos");
    expect(kitchen).not.toContain("ledger");
    expect(kitchen).not.toContain("staff");
  });

  it("shows a waiter the floor but not the books", () => {
    const waiter = idsFor("food", holding("sales.manage", "customers.manage"));

    expect(waiter).toContain("dine-in");
    expect(waiter).toContain("pos");
    expect(waiter).toContain("customers");
    expect(waiter).not.toContain("expenses");
    expect(waiter).not.toContain("staff");
  });

  it("shows a bookkeeper the money and nothing to sell with", () => {
    const books = idsFor("mart", holding("expenses.manage"));

    expect(books).toContain("ledger");
    expect(books).toContain("cashbook");
    expect(books).not.toContain("pos");
    expect(books).not.toContain("inventory");
  });

  it("always shows the articles that need no permission", () => {
    // Somebody with nothing at all still gets told why their screens look the
    // way they do, and how to change their own password.
    const nobody = idsFor("mart", () => false);

    expect(nobody).toContain("how-it-fits");
    expect(nobody).toContain("password");
  });
});

/**
 * Screens that legitimately have no article of their own, and why. Written
 * down because "I forgot to document it" looks exactly like "it needs none".
 */
const NEEDS_NO_ARTICLE: Record<string, string> = {
  "/tenant/help": "the Help Centre itself",
  "/tenant/pharmacy": "documented as the prescription counter article",
  "/tenant/warranty": "documented as the serial numbers article",
  "/tenant/cashbook": "has its own article, linked from the money group",
  "/tenant/qa": "the QA walkthrough is documentation itself, and is written for a tester rather than for a shopkeeper — an article about it would be a help page about a help page",
};

describe("the content itself", () => {
  it("has no duplicate ids", () => {
    const ids = HELP_ARTICLES.map((a) => a.id);
    expect(ids).toEqual([...new Set(ids)]);
  });

  it("puts every article in a group the rail renders", () => {
    // An article in an unlisted group is written, shipped and invisible.
    for (const a of HELP_ARTICLES) {
      expect(HELP_GROUPS, `${a.id} is in an unknown group`).toContain(a.group);
    }
  });

  it("gives every article a body", () => {
    for (const a of HELP_ARTICLES) {
      expect(a.body.length, `${a.id} has no body`).toBeGreaterThan(0);
    }
  });

  it("covers every screen the shop has", () => {
    // The completeness guarantee, so "all modules are documented" is a fact
    // rather than a claim. A screen built, wired and then left undocumented is
    // the same defect as one left unreachable — the shopkeeper cannot use it.
    const documented = new Set(HELP_ARTICLES.map((a) => a.screen).filter(Boolean));
    const undocumented = [...TENANT_ROUTES].filter(
      (r) => !documented.has(r) && !(r in NEEDS_NO_ARTICLE),
    );

    expect(
      undocumented,
      `screens with no help article: ${undocumented.join(", ")}`,
    ).toEqual([]);
  });

  it("nests every child under a parent that exists", () => {
    const ids = new Set(HELP_ARTICLES.map((a) => a.id));
    for (const a of HELP_ARTICLES) {
      if (a.parent) expect(ids, `${a.id} nests under a missing parent`).toContain(a.parent);
    }
  });

  it("never orphans a child behind a parent its shop cannot see", () => {
    // A child is only rendered under its parent. If the parent is filtered out
    // and the child is not, the child vanishes from the rail entirely — built,
    // documented and invisible.
    for (const trade of Object.keys(TRADES)) {
      const shown = articlesFor(TRADES[trade], trade, owner);
      const ids = new Set(shown.map((a) => a.id));

      for (const a of shown) {
        if (a.parent) {
          expect(ids, `${trade}: ${a.id} survived but its parent ${a.parent} did not`).toContain(a.parent);
        }
      }
    }
  });

  it("only links to screens that exist under a portal", () => {
    for (const a of HELP_ARTICLES) {
      // The dashboard is `/tenant` exactly; everything else is beneath it.
      if (a.screen) expect(TENANT_ROUTES, `${a.id} links to a screen with no route`).toContain(a.screen);
    }
  });

  it("finds an article by a word that is not in its title", () => {
    // The whole point of `keywords`: somebody types what they call the thing.
    const all = articlesFor(TRADES.mart, "mart", owner);

    expect(searchArticles(all, "khata").map((a) => a.id)).toContain("customers");
    expect(searchArticles(all, "barcode").map((a) => a.id)).toContain("products");
    expect(searchArticles(all, "locked out").map((a) => a.id)).toContain("password");
  });

  it("returns everything for an empty search rather than nothing", () => {
    const all = articlesFor(TRADES.mart, "mart", owner);
    expect(searchArticles(all, "   ")).toHaveLength(all.length);
  });
});
