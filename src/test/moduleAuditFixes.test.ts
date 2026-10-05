import { describe, expect, it } from "vitest";
import { shopNav } from "../layout/AppSidebar";
import { HELP_ARTICLES, articlesFor, canOpenScreen } from "../modules/help/content";

/**
 * WHAT A READ-ONLY AUDIT OF EVERY MODULE CHECK FOUND, held in place.
 *
 * 2026-10-05. The rule: a module a shop was never sold is invisible, and a
 * control that is shown and then bounces reads as a broken product. The till
 * was fixed first; an audit of every other surface then found the same fault
 * on the dashboard, the Sales screen, the sidebar, the Help Centre and the
 * staff form. Full list: `docs/qa/2026-10-05-module-audit.md`.
 *
 * `offeredIsReachable.test.ts` is the standing guard, and it passed through
 * all of it — it mounts two dashboard panels and walks links. These are the
 * specific doors it could not see.
 */

const OWNER = () => true;
const paths = (features: Record<string, boolean>, multiBranch: boolean) =>
  shopNav(features, "food", "advanced", multiBranch, OWNER).flatMap((item) => [
    ...(item.path ? [item.path] : []),
    ...(item.subItems ?? []).map((s) => s.path),
  ]);

describe("the sidebar", () => {
  it("offers Transfers only to a shop that keeps stock", () => {
    // Two branches, no inventory: a restaurant that counts nothing. The entry
    // followed the PLAN alone, and the link dropped it on the dashboard.
    const noStock = paths({ pos: true, products: true, kitchen: true }, true);
    expect(noStock).toContain("/tenant/branches");
    expect(noStock).not.toContain("/tenant/transfers");

    const withStock = paths({ pos: true, products: true, inventory: true }, true);
    expect(withStock).toContain("/tenant/transfers");
  });
});

describe("the Help Centre", () => {
  const article = (id: string) => HELP_ARTICLES.find((a) => a.id === id)!;
  const offered = (features: Record<string, boolean>) => articlesFor(features, "mart", OWNER).map((a) => a.id);

  it("draws 'Open this screen' only when the shop can open it", () => {
    const online = article("online-shop");
    // A mart selling online reads the article and is NOT sent to a services screen.
    expect(offered({ marketplace: true })).toContain("online-shop");
    expect(canOpenScreen(online, { marketplace: true })).toBe(false);
    expect(canOpenScreen(online, { marketplace: true, services: true })).toBe(true);
  });

  it("an article with no screen offers no button, and one with no extra needs always does", () => {
    const withScreen = HELP_ARTICLES.find((a) => a.screen && !a.screenNeeds)!;
    expect(canOpenScreen(withScreen, {})).toBe(true);
    expect(canOpenScreen({ ...withScreen, screen: undefined }, {})).toBe(false);
  });

  it.each([
    ["labels", "labels"],
    ["labels-sub", "labels"],
    ["workshop", "documents"],
    ["sales-new", "pos"],
  ])("%s is offered on the module its screen needs (%s)", (id, module) => {
    expect(article(id).modules).toEqual([module]);
    // …and so not on the looser key it used to ride.
    expect(offered({ products: true, marketplace: true })).not.toContain(id);
    expect(offered({ products: true, pos: true, [module]: true })).toContain(id);
  });
});
