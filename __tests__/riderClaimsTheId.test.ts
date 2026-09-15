import { PROJECT_ROOT, codeOnly, fs, path } from "./support/node";

/**
 * THE ID COMES FROM THE SHOP NOW, and the app has to have somewhere to put it.
 *
 * ── What changed under this ─────────────────────────────────────────────
 *
 * A shop adding a rider is handed `RDR-000123` there and then. They write it
 * down and give it to their rider. Before, the code went the other way: the
 * rider had to install the app, sign up, apply, send a CNIC, wait to be
 * approved and then read the code off this very screen so the shop could type
 * it in. Five steps belonging to somebody who is not the shop.
 *
 * So `RiderApplyScreen` has a second door on it. Without one the shop's half
 * of this is a number nobody can spend.
 *
 * ── The trap this file is really watching ───────────────────────────────
 *
 * A rider their shop vouched for is approved to carry THAT shop's orders and
 * is refused the CartZe pool by the server until they apply properly. The
 * board's empty state offers "Take CartZe deliveries" — a button that, for
 * this rider, can only ever answer 403.
 *
 * This codebase has shipped that exact shape before: a Purchasing job offered
 * by four surfaces and bounced by every screen behind it. A control that
 * always fails is worse than no control, because the rider concludes the app
 * is broken rather than that there is a step left.
 *
 * Reads source text — a lint rule wearing a test's clothes. The behaviour
 * underneath is proved on the server by `ShopMintsTheRiderIdTest`, where it
 * can be asserted rather than matched.
 */

const read = (rel: string) => codeOnly(fs.readFileSync(path.join(PROJECT_ROOT, rel), "utf8"));

const apply = read("src/modules/rider/screens/RiderApplyScreen.tsx");
const home = read("src/modules/rider/screens/RiderHomeScreen.tsx");
const service = read("src/modules/rider/services/riderService.ts");
const hook = read("src/modules/rider/hooks/useRider.ts");

describe("a rider can spend the id their shop gave them", () => {
  it("has an endpoint to spend it at", () => {
    expect(service).toMatch(/"\/rider\/claim"/);
    expect(hook).toMatch(/riderService\.claim\(/);
  });

  it("offers the box to somebody who has never applied", () => {
    // Behind `profile == null` and nothing else: a person holding an id has
    // no profile yet, and that is the whole population this door is for.
    expect(apply).toContain("Has your shop given you a rider id?");
    expect(apply).toMatch(/claim\s*\n?\s*\.mutateAsync\(/);
  });

  /**
   * Six digits beats a CNIC and a wait, so it is drawn FIRST. A rider who
   * reads a page about photographs before finding the box concludes the app
   * is not for them and closes it.
   */
  it("puts the short road above the long one", () => {
    const shortRoad = apply.indexOf("Has your shop given you a rider id?");
    const longRoad = apply.indexOf("Your vehicle");

    expect(shortRoad).toBeGreaterThan(-1);
    expect(longRoad).toBeGreaterThan(-1);
    expect(shortRoad).toBeLessThan(longRoad);
  });

  /**
   * The server's sentence, not ours. "No rider has that id" and "already in
   * use by another account" send the rider to two different people for help.
   */
  it("shows the server's reason when the id does not work", () => {
    expect(apply).toMatch(/claim[\s\S]{0,400}?catch[\s\S]{0,160}?e instanceof Error \? e\.message/);
  });
});

describe("the pool switch is never offered to somebody it would refuse", () => {
  it("reads whether this rider may even ask", () => {
    expect(service).toContain("can_join_pool");
    expect(home).toContain("can_join_pool");
  });

  /**
   * The mutation call must sit behind the eligibility check, not beside it.
   */
  it("gates setPool(true) on it", () => {
    const at = home.indexOf("setPool.mutate(true)");
    expect(at).toBeGreaterThan(-1);

    // The check has to be ABOVE the call in the same expression, and close to
    // it — a `can_join_pool` mentioned four hundred lines earlier proves
    // nothing about this button.
    const before = home.slice(Math.max(0, at - 700), at);
    expect(before).toContain("can_join_pool");
  });

  /** And the rider is sent somewhere that goes somewhere. */
  it("sends an ineligible rider to the application instead", () => {
    expect(home).toMatch(/can_join_pool === false[\s\S]{0,300}?RiderApply/);
  });
});
