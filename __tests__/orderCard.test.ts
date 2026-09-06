import { PROJECT_ROOT, fs, path, sourceFiles } from "./support/node";
import { lightColors, darkColors } from "../src/theme";
import {
  ORDER_STEPS,
  placedAt,
  statusColors,
  statusLook,
  stepOf,
  stepsFor,
} from "../src/modules/orders/orderStatus";

/**
 * THE ORDERS LIST, AND THE TWO QUESTIONS IT ANSWERS.
 *
 * "Where is my food" and "what did I order in March" are not the same question
 * and were served by the same rectangle with a different word in the corner.
 */

const codeOnly = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("a status is written in words somebody uses", () => {
  it("never prints a database column at a customer", () => {
    // It printed `status.replace(/_/g, " ")` — "out for delivery", "pending".
    // Those are field values. A person wants to know if their food is coming.
    expect(statusLook("out_for_delivery").label).toBe("On the way");
    expect(statusLook("completed").label).toBe("Delivered");
    expect(statusLook("cancelled").label).toBe("Cancelled");
  });

  it("says what `pending` actually means", () => {
    // Not "we are working on it" — the shop has not accepted it yet, which is
    // the one state where somebody might reasonably ring them.
    expect(statusLook("pending").label).toBe("Waiting for the shop");
  });

  it("uses the right verb for a collection order", () => {
    expect(statusLook("completed", "pickup").label).toBe("Collected");
    expect(statusLook("ready", "pickup").label).toBe("Ready to collect");
    expect(statusLook("ready", "delivery").label).toBe("Ready for pick-up");
  });

  it("does not call an unknown status pending", () => {
    // A server that adds a state would otherwise tell somebody their delivered
    // order is still waiting for the shop.
    // @ts-expect-error — deliberately off the union: this is the server moving on.
    expect(statusLook("refunded").label).toBe("refunded");
    // @ts-expect-error — same.
    expect(statusLook("refunded").live).toBe(false);
  });
});

describe("which orders are still moving", () => {
  it("counts every stage before the end as live", () => {
    const live = ORDER_STEPS.filter((s) => statusLook(s).live);
    expect(live).toEqual(["pending", "confirmed", "preparing", "ready", "out_for_delivery"]);
  });

  it("counts a finished or cancelled order as history", () => {
    expect(statusLook("completed").live).toBe(false);
    expect(statusLook("cancelled").live).toBe(false);
  });
});

describe("the progress track", () => {
  it("walks the whole journey for a delivery", () => {
    expect(stepOf("pending", "delivery")).toBe(0);
    expect(stepOf("out_for_delivery", "delivery")).toBe(4);
    expect(stepOf("completed", "delivery")).toBe(5);
    expect(stepsFor("delivery")).toHaveLength(6);
  });

  it("drops the delivery leg from a collection order", () => {
    // A five-of-six bar stuck at "Ready" for ever is a bar that looks BROKEN at
    // the exact moment the order is finished and waiting on the customer.
    expect(stepsFor("pickup")).not.toContain("out_for_delivery");
    expect(stepOf("ready", "pickup")).toBe(3);
    expect(stepOf("completed", "pickup")).toBe(4);
    expect(stepsFor("pickup")).toHaveLength(5);
  });

  it("gives a cancelled order no position at all", () => {
    // Otherwise it draws as one step short of delivered, which is the opposite
    // of what happened.
    expect(stepOf("cancelled", "delivery")).toBeNull();
    expect(stepOf("cancelled", "pickup")).toBeNull();
  });

  it("fills every segment up to and including where it is", () => {
    // The rule the card renders: `i <= at`. At step 0 exactly one segment is
    // on — a bar that is entirely empty says nothing has happened, and placing
    // the order is something that happened.
    const at = stepOf("pending", "delivery")!;
    const on = stepsFor("delivery").filter((_, i) => i <= at);
    expect(on).toHaveLength(1);
  });
});

describe("a badge takes its colours from the theme", () => {
  it("has a distinct ground for each kind of state", () => {
    const tones = (["waiting", "live", "done", "off"] as const).map(
      (t) => statusColors(t, lightColors).bg,
    );
    expect(new Set(tones).size).toBe(4);
  });

  it("resolves differently in dark mode", () => {
    // THE BUG this replaced. `STATUS_STYLE` held literal hexes — `#eff8ff` on
    // `#175cd3` — which are the SAME in both themes: a pale blue-white badge
    // punched into a near-black card, on the one screen a light-mode look
    // cannot catch.
    for (const tone of ["waiting", "live", "done", "off"] as const) {
      expect(statusColors(tone, lightColors).bg).not.toBe(statusColors(tone, darkColors).bg);
    }
  });

  it("leaves no literal status palette behind", () => {
    const src = codeOnly(
      fs.readFileSync(path.join(PROJECT_ROOT, "src/modules/orders/screens/OrdersScreen.tsx"), "utf8"),
    );
    expect(src).not.toMatch(/#[0-9a-f]{6}/i);
    expect(src).not.toMatch(/STATUS_STYLE/);
  });
});

describe("when it was placed", () => {
  const now = new Date("2026-09-06T15:00:00");

  it("says today with the time", () => {
    // The list showed NO date at all: an order number, a shop and a total.
    // Fine for the one placed twenty minutes ago, useless for telling last
    // Tuesday's from the Tuesday before.
    expect(placedAt("2026-09-06T09:30:00", now)).toMatch(/^Today, /);
  });

  it("says yesterday rather than a date", () => {
    expect(placedAt("2026-09-05T21:15:00", now)).toMatch(/^Yesterday, /);
  });

  it("names the weekday inside the last week", () => {
    expect(placedAt("2026-09-03T13:00:00", now)).toMatch(/^Thursday, /);
  });

  it("drops the clock once a date is enough", () => {
    // The day and the month, in whichever order the PHONE writes them — the
    // formatter takes the device locale on purpose, and pinning "12 Aug" here
    // would be this test asserting its own runner's locale rather than the
    // rule, which is that a three-week-old order stops carrying a clock.
    const out = placedAt("2026-08-12T13:00:00", now);
    expect(out).toMatch(/12/);
    expect(out).toMatch(/Aug/);
    expect(out).not.toMatch(/:/);
  });

  it("only prints a year when it is not this one", () => {
    expect(placedAt("2026-01-04T10:00:00", now)).not.toMatch(/2026/);
    expect(placedAt("2025-11-04T10:00:00", now)).toMatch(/2025/);
  });

  it("says nothing rather than 'Invalid Date'", () => {
    expect(placedAt(null)).toBe("");
    expect(placedAt("not a date")).toBe("");
  });
});

describe("the layout rules the screens were failing", () => {
  const read = (rel: string) =>
    codeOnly(fs.readFileSync(path.join(PROJECT_ROOT, rel), "utf8"));

  it("insets the home screen's long tail like every other block on it", () => {
    // Asked directly: "cards edge ks sath q lga diye?" The rails, the grid and
    // the shortcut tiles are all `spacing.md` in from the glass; the shop cards
    // were the one block with no horizontal padding, because the card carried
    // no margin and the list that renders it had none either.
    const src = read("src/modules/marketplace/screens/CustomerHomeScreen.tsx");
    expect(src).toMatch(/<Appear index=\{i\} style=\{styles\.tailCard\}>/);
    expect(src).toMatch(/tailCard: \{ paddingHorizontal: spacing\.md \}/);
  });

  it("has no `radius.full` left anywhere", () => {
    /**
     * THE SECOND HALF OF THE SAME RULE.
     *
     * The scan below only ever looked at style blocks with a fixed numeric
     * WIDTH, so it found thirty round buttons and missed every PILL — a chip,
     * a badge, a segmented-control track, anything whose size comes from its
     * padding. Twenty-eight of them, including the "On offer" chip whose
     * cross was reported as clipped on a real device.
     *
     * A rule that catches one shape of the same bug is a rule that gets
     * re-learned. `radius.full` is 9999 and there is no view in this app large
     * enough to need it, so the honest rule is: not at all.
     */
    const files = sourceFiles(PROJECT_ROOT + "/src").filter((f) => f.endsWith(".tsx"));
    expect(files.length).toBeGreaterThan(30);

    const offenders = files
      .flatMap((f) =>
        codeOnly(fs.readFileSync(f, "utf8"))
          .split("\n")
          .map((line, i) => [i + 1, line] as const)
          .filter(([, line]) => /borderRadius:\s*radius\.full/.test(line))
          .map(([n]) => `  ${path.relative(PROJECT_ROOT, f)}:${n}`),
      );

    expect(offenders.join("\n")).toBe("");
  });

  it("never puts `radius.full` on a view small enough to render square", () => {
    // Documented and then re-introduced twice: a very large radius renders as
    // a SQUARE on small views under the new architecture. The cart's stepper
    // buttons were 24pt circles that were not circles.
    const files = sourceFiles(path.join(PROJECT_ROOT, "src")).filter((f) => f.endsWith(".tsx"));
    expect(files.length).toBeGreaterThan(30);

    const offenders: string[] = [];
    for (const f of files) {
      const src = codeOnly(fs.readFileSync(f, "utf8"));
      // A style block that fixes a width AND asks for the full radius.
      for (const m of src.matchAll(/\{[^{}]*\bwidth:\s*(\d+(?:\.\d+)?)[^{}]*\}/g)) {
        if (!/borderRadius:\s*radius\.full/.test(m[0])) continue;
        if (Number(m[1]) > 40) continue; // large enough to round correctly
        const line = src.slice(0, m.index ?? 0).split("\n").length;
        offenders.push(`  ${path.relative(PROJECT_ROOT, f)}:${line}  width ${m[1]}`);
      }
    }
    expect(offenders.join("\n")).toBe("");
  });

  it("gives the basket a way out when it is empty", () => {
    // The cart is a leaf of the tab bar — no back arrow — and its empty state
    // told somebody to go browsing without giving them anything to press.
    // Anchored on the COMPONENT rather than on a style name: this asserted
    // `<AppButton>` inside a block starting at `emptyWrap`, and both went when
    // the cart moved onto the shared `EmptyState` — leaving the slice empty
    // and the assertion matching nothing at all.
    const src = read("src/modules/orders/screens/CartScreen.tsx");
    const empty = src.slice(src.indexOf("<EmptyState"), src.indexOf("const count ="));

    expect(empty).not.toBe("");
    expect(empty).toMatch(/action=\{\{[\s\S]*?navigation\.navigate/);
  });

  it("shows the picture the person was just looking at, in their basket", () => {
    // Every line drew a coloured letter — the placeholder for a MISSING photo —
    // including for items whose photo was on screen one tap earlier.
    const store = read("src/stores/cartStore.ts");
    expect(store).toMatch(/image\?: string \| null;/);

    const cart = read("src/modules/orders/screens/CartScreen.tsx");
    expect(cart).toMatch(/<SmartImage\s+uri=\{item\.image\}/);

    // …and every door into the basket fills it in, or the field is decoration.
    for (const rel of [
      "src/modules/marketplace/screens/MarketShopScreen.tsx",
      "src/modules/marketplace/screens/BrowseScreen.tsx",
      "src/modules/orders/screens/CartScreen.tsx",
    ]) {
      const src = read(rel);
      const builders = [...src.matchAll(/\bunit_price:/g)].length;
      const withImage = [...src.matchAll(/\bimage: p\.images\[0\] \?\? null,/g)].length;
      expect(`${rel}: ${withImage}/${builders}`).toBe(`${rel}: ${builders}/${builders}`);
    }
  });
});
