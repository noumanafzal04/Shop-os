import { describe, expect, it } from "vitest";

/**
 * THE SHOP HANDS OUT THE ID, instead of asking for one.
 *
 * ── What changed, and why a test guards it ──────────────────────────────
 *
 * A shop wanting its rider on the app had to wait for the rider to install it,
 * sign up, apply, be approved and read RDR-000123 off their own screen — and
 * only then could the shop type it in. The id is minted when the shop adds the
 * rider now, and the rider claims it.
 *
 * Which makes the panel the only place that id ever appears. If the code that
 * comes back from Add is dropped on the floor, the feature is gone and nothing
 * fails: the shop sees "Rider added", has no number to give anybody, and the
 * rider is back to the old five steps. So the screen is checked for three
 * things it must keep doing, all of them easy to lose in a later tidy-up.
 *
 * ── Why this reads the source ───────────────────────────────────────────
 *
 * Same instrument as `posChrome.test.ts` and the same limitation: it proves
 * the source says this, not that the pixels arrived. The behaviour underneath
 * — minting, claiming, and the fence that stops a shop's word being read as
 * the platform's — is proved end to end by `ShopMintsTheRiderIdTest` on the
 * server, where it can be asserted rather than matched.
 */

const SOURCE = Object.entries(
  import.meta.glob("./pages/RidersPage.tsx", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>,
)[0]?.[1];

describe("the rider id the shop has to give somebody", () => {
  it("has the file to read", () => {
    expect(SOURCE).toBeDefined();
  });

  /**
   * The id arrives in the reply to the button press and nowhere else at that
   * moment. Dropping it is silent: "Rider added" still appears.
   */
  it("keeps the code that comes back from Add", () => {
    expect(SOURCE).toContain("res.data.rider_code");
    expect(SOURCE).toContain("setMinted(");
  });

  /**
   * Shown until dismissed by hand. A shop copying a number onto paper is not
   * on anybody's schedule, and a code that vanishes mid-write is worse than
   * one that was never shown — so no timer may creep in here.
   */
  it("does not put the code on a timer", () => {
    const panel = SOURCE.slice(SOURCE.indexOf("{minted && ("));
    expect(panel).not.toMatch(/setTimeout|setInterval/);
  });

  /**
   * And the list is the fallback for the shop that lost the paper — which is
   * the normal reason to come back to this screen. The code used to be drawn
   * only `{r.has_app && …}`, and `has_app` is false for exactly the rider who
   * still needs to be given it.
   */
  it("shows the id in the list whether or not anybody claimed it", () => {
    expect(SOURCE).toContain("{r.rider_code && (");

    // Aimed at the CODE, not at `has_app` generally — the Online / Has app
    // badge further along the row is gated on it correctly and must stay. What
    // may never come back is the code itself sitting behind that gate, which
    // is where it used to be: `has_app` is false for exactly the rider who
    // still has to be handed the number.
    const gated = /has_app\s*&&[\s\S]{0,160}?rider_code/.test(SOURCE);
    expect(gated).toBe(false);
  });
});
