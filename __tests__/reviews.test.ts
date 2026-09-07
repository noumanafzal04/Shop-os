import { PROJECT_ROOT, fs, path, sourceFiles } from "./support/node";

/**
 * AN ENDPOINT WITH NO SCREEN IS A FEATURE NOBODY HAS.
 *
 * ── What was found ───────────────────────────────────────────────────
 *
 * `GET /customer/reviews`, `POST /customer/reviews` and
 * `DELETE /customer/reviews/{id}` were written, tested and reachable by
 * nobody: the phone app called none of the three. So on a marketplace that
 * SORTS and FILTERS by rating, a customer could not rate anything — and
 * anybody who had rated a shop from the web had no way to find, change or
 * remove a public comment carrying their name.
 *
 * That is the same defect this project has now found several times, and it
 * passes every test it has, because tests call endpoints and people press
 * screens.
 *
 * ── What these rules protect ─────────────────────────────────────────
 *
 * Not "a reviews screen exists" — that is satisfied by a file. The rules are
 * the ones with a victim: a rating asked for on an order that never arrived,
 * a review posted with no star, an endpoint that loses its last caller.
 */

const ROOT = PROJECT_ROOT;

const codeOnly = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const files = sourceFiles(path.join(ROOT, "src"));
const app = files.map((f) => codeOnly(fs.readFileSync(f, "utf8"))).join("\n");

describe("every review endpoint has a caller", () => {
  it("scanned the app", () => {
    // The denominator. Without it, a broken file walk makes every check below
    // pass by finding nothing to contradict it.
    expect(files.length).toBeGreaterThan(30);
    expect(app).toMatch(/customer\/reviews/);
  });

  it.each([
    ['apiGet<MyReview\\[\\]>\\("/customer/reviews"\\)', "reads them"],
    ['apiPost<MyReview>\\("/customer/reviews"', "writes one"],
    ['apiDelete<null>\\(`/customer/reviews/\\$\\{id\\}`\\)', "removes one"],
  ])("%s — %s", (pattern) => {
    expect(new RegExp(pattern).test(app)).toBe(true);
  });
});

describe("where a person is asked", () => {
  const order = codeOnly(
    fs.readFileSync(
      path.join(ROOT, "src/modules/orders/screens/OrderTrackingScreen.tsx"),
      "utf8",
    ),
  );

  it("asks on a delivered order", () => {
    // The one moment the question answers itself.
    expect(order).toMatch(/<RateSheet/);
    expect(order).toMatch(/o\.status === "completed" && !!o\.shop\?\.slug/);
  });

  it("does not ask about an order that never arrived", () => {
    // A cancelled order is not an experience of the shop's food, and asking
    // about one is how a rating average stops meaning anything.
    // A fixed window, and deliberately so: this is a NEGATIVE assertion, so a
    // window that grows can only make it stricter. The positive ones nearby
    // were bounded by structure because for those a wide window is a weaker
    // test, not a louder one.
    const button = order.slice(order.indexOf('o.status === "completed" && !!o.shop?.slug'));
    expect(button.slice(0, 400)).not.toMatch(/cancelled/);
  });

  it("knows whether it is asking or offering to change an answer", () => {
    // The server upserts: posting again REPLACES. A button that says "Rate"
    // to somebody who already has a review is the button lying about it.
    expect(order).toMatch(/mine \? "Edit your review" :/);
  });

  it("is reachable from the account page too", () => {
    const account = codeOnly(
      fs.readFileSync(path.join(ROOT, "src/modules/account/screens/AccountScreen.tsx"), "utf8"),
    );
    const nav = codeOnly(
      fs.readFileSync(path.join(ROOT, "src/navigation/RootNavigator.tsx"), "utf8"),
    );

    expect(account).toMatch(/route: "Reviews"/);
    expect(nav).toMatch(/<CustomerStack\.Screen name="Reviews" component=\{ReviewsScreen\}/);
  });
});

describe("the sheet", () => {
  const sheet = codeOnly(
    fs.readFileSync(path.join(ROOT, "src/modules/reviews/components/RateSheet.tsx"), "utf8"),
  );

  it("will not post without a star", () => {
    // Words with no rating cannot move the average the marketplace sorts on,
    // which makes them a review the shop cannot act on.
    expect(sheet).toMatch(/disabled=\{rating < 1\}/);
  });

  it("keeps the comment optional", () => {
    // A rating with no words is a complete answer and the commonest one.
    expect(sheet).toMatch(/comment: comment\.trim\(\) \|\| null/);
  });

  it("says update when there is something to update", () => {
    expect(sheet).toMatch(/existing \? "Update review" : "Post review"/);
  });

  it("does not throw away what is being typed", () => {
    // Without the `visible` guard the reset runs whenever the list refetches
    // underneath, which is mid-sentence.
    // Bounded by the dependency array, which is where a `useEffect` actually
    // ends — not by 260 characters, which is where one happened to end on the
    // day this was written.
    const from = sheet.indexOf("React.useEffect");
    expect(from).toBeGreaterThan(-1);
    const effect = sheet.slice(from, sheet.indexOf("}, [", from));
    expect(effect).toMatch(/if \(!visible\) return;/);
  });
});

describe("posting one moves what it should", () => {
  const hooks = codeOnly(
    fs.readFileSync(path.join(ROOT, "src/modules/reviews/hooks/useReviews.ts"), "utf8"),
  );

  it("refreshes the shop as well as the list", () => {
    // The shop page carries the rating and the published reviews, and both
    // just changed. Leaving them is how somebody posts a review and watches
    // the average not move.
    const save = hooks.slice(hooks.indexOf("export function useSaveReview"));
    expect(save).toMatch(/queryKey: \["reviews", "mine"\]/);
    expect(save).toMatch(/queryKey: \["market", "shop", payload\.shop_slug\]/);
  });

  it("never asks for a guest's reviews", () => {
    // The endpoint is behind `role:customer`; a query that fires for a guest
    // is a 401 the app then has to explain away.
    expect(hooks).toMatch(/enabled: signedIn/);
  });
});
