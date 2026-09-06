import { PROJECT_ROOT, fs, path } from "./support/node";

jest.mock("../src/common/utils/prefs", () => ({
  prefs: {
    all: jest.fn(async () => ({})),
    setMode: jest.fn(async () => {}),
    setTheme: jest.fn(async () => {}),
    setOnboarded: jest.fn(async () => {}),
  },
}));

import { MODE_SWITCH_MS, useModeStore } from "../src/stores/modeStore";

/**
 * TWO HATS, ONE ACCOUNT.
 *
 * The rule this file exists for is the one that is easy to get wrong and
 * expensive when it is: **a preference is not a permission.** The mode is
 * remembered on the device so a rider mid-shift comes back to their
 * deliveries after a restart — and a remembered value must never be the reason
 * somebody is holding a job board they are no longer approved for.
 */

const reset = () => useModeStore.setState({ mode: "customer", switching: false, target: null });

describe("which hat is on", () => {
  beforeEach(reset);

  it("starts in the shop", () => {
    expect(useModeStore.getState().mode).toBe("customer");
  });

  it("remembers rider mode across a restart", () => {
    useModeStore.getState().hydrate("rider", true);
    expect(useModeStore.getState().mode).toBe("rider");
  });

  it("ignores a remembered rider mode the server no longer allows", () => {
    // The whole point. Somebody suspended while the app was closed must open
    // it in the shop, not on a board they cannot work.
    useModeStore.getState().hydrate("rider", false);
    expect(useModeStore.getState().mode).toBe("customer");
  });

  it("treats no memory at all as the shop", () => {
    useModeStore.getState().hydrate(undefined, true);
    expect(useModeStore.getState().mode).toBe("customer");
  });

  it("demotes a rider whose approval was withdrawn mid-session", () => {
    useModeStore.getState().hydrate("rider", true);
    useModeStore.getState().syncFromProfile(false);
    expect(useModeStore.getState().mode).toBe("customer");
  });

  it("never promotes somebody into rider mode without them asking", () => {
    // Being approved is permission to switch, not a switch. Somebody who has
    // just been accepted is still shopping until they say otherwise.
    useModeStore.getState().syncFromProfile(true);
    expect(useModeStore.getState().mode).toBe("customer");
  });
});

describe("the switch", () => {
  beforeEach(() => {
    reset();
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  it("covers the swap, changes the tree halfway, and lifts", () => {
    // The cover is not a spinner waiting on work — the swap takes a few
    // frames. It exists so replacing the whole navigator reads as something
    // deliberate rather than as the app glitching.
    useModeStore.getState().switchTo("rider");

    expect(useModeStore.getState().switching).toBe(true);
    expect(useModeStore.getState().target).toBe("rider");
    // Still the old tree, so the cover has something to cover.
    expect(useModeStore.getState().mode).toBe("customer");

    jest.advanceTimersByTime(MODE_SWITCH_MS / 2);
    // Swapped underneath, while it is hidden.
    expect(useModeStore.getState().mode).toBe("rider");
    expect(useModeStore.getState().switching).toBe(true);

    jest.advanceTimersByTime(MODE_SWITCH_MS / 2);
    expect(useModeStore.getState().switching).toBe(false);
    expect(useModeStore.getState().target).toBeNull();
  });

  it("ignores a second press while one is already running", () => {
    useModeStore.getState().switchTo("rider");
    useModeStore.getState().switchTo("customer");

    expect(useModeStore.getState().target).toBe("rider");

    jest.advanceTimersByTime(MODE_SWITCH_MS);
    expect(useModeStore.getState().mode).toBe("rider");
  });

  it("does nothing when asked for the hat already on", () => {
    useModeStore.getState().switchTo("customer");
    expect(useModeStore.getState().switching).toBe(false);
  });
});

describe("on shift, the shopping half is gone", () => {
  const nav = fs.readFileSync(path.join(PROJECT_ROOT, "src/navigation/RootNavigator.tsx"), "utf8");

  /** The screens registered on one navigator, by its JSX prefix. */
  const screensOf = (prefix: string): string[] => {
    const re = new RegExp(`<${prefix}\\.Screen[^>]*?name="(\\w+)"`, "gs");
    return [...nav.matchAll(re)].map((m) => m[1]);
  };

  it("gives rider mode its own tabs", () => {
    const tabs = screensOf("RiderTabs");
    expect(tabs).toEqual(["RiderBoardTab", "RiderEarningsTab", "RiderAccountTab"]);
  });

  it("has no basket on the rider bar", () => {
    // Somebody delivering is not shopping. This is the single visible promise
    // of the mode — before it, a rider on shift carried Food, Grocery and a
    // basket along the bottom of every screen.
    const tabs = screensOf("RiderTabs");
    expect(tabs).not.toContain("CartTab");
    expect(tabs).not.toContain("FoodTab");
    expect(tabs).not.toContain("GroceryTab");
  });

  it("and the shopping tabs still have theirs", () => {
    // The denominator: if this scan broke, the test above would pass by
    // finding nothing at all.
    expect(screensOf("CustomerTabs")).toContain("CartTab");
  });

  it("keeps the rider stack to the job, the money and the account", () => {
    const stack = screensOf("RiderStack");
    expect(stack).toContain("RiderTabs");
    expect(stack).toContain("RiderJob");
    // No shop, no checkout, no basket — there is nothing to buy on shift.
    expect(stack).not.toContain("MarketShop");
    expect(stack).not.toContain("Checkout");
  });

  it("renders rider mode only while the server still approves it", () => {
    // Tested against the SOURCE because it is a render-time condition, and an
    // effect that has not run yet is not a fence. The branch must ask
    // `canRide`, not only the stored mode.
    const branch = nav.slice(nav.indexOf('name="BusinessAccount"'));
    expect(branch).toMatch(/mode === "rider" && canRide/);
  });
});

describe("the switch can be found", () => {
  const menu = fs.readFileSync(path.join(PROJECT_ROOT, "src/navigation/SideMenu.tsx"), "utf8");
  const code = menu.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  it("is offered to everybody signed in, not only to approved riders", () => {
    // The complaint, verbatim: "Switch mode kidhar hai?" — asked by somebody
    // who HAD it. It was rendered only when `canRide`, so an applicant, and
    // anybody who had not applied, saw no sign the mode existed at all. A
    // control that appears once you qualify is a control nobody knows to
    // qualify FOR.
    const footer = code.slice(code.indexOf("styles.footer"));

    expect(footer).toMatch(/\{signedIn && \(\s*<Touchable[\s\S]*?styles\.switcher/);
    // …and it is NOT gated on approval any more.
    expect(footer).not.toMatch(/\{canRide && \(\s*<Touchable[\s\S]*?styles\.switcher/);
  });

  it("makes becoming a rider an invitation rather than a disabled control", () => {
    // It was grey, which reads as "you cannot press this". It is the one row
    // that asks somebody to start earning, and it leads somewhere useful.
    const styles = code.slice(code.indexOf("switcherOff:"));
    expect(styles).toMatch(/switcherOff: \{ backgroundColor: c\.primary \}/);
  });

  it("leads an unapproved person to the application rather than pretending", () => {
    expect(code).toMatch(/if \(!canRide\) \{[\s\S]*?navigate\("RiderApply"\)/);
  });

  it("sits below the scroll, pinned, with the way out", () => {
    // Everything above is a place to GO and belongs in the scroll. These two
    // change what the app is, and were at the bottom of a scrolling list —
    // which is how one of them went unfound.
    const scrollEnds = code.indexOf("</ScrollView>");
    const footerAt = code.indexOf("styles.footer");
    const logoutAt = code.indexOf("styles.logout");

    expect(scrollEnds).toBeGreaterThan(-1);
    expect(footerAt).toBeGreaterThan(scrollEnds);
    expect(logoutAt).toBeGreaterThan(scrollEnds);
  });

  it("leaves the menus themselves scrollable", () => {
    // The lists must stay in the ScrollView — pinning everything would make a
    // small phone unable to reach Help.
    const scroll = code.slice(code.indexOf("<ScrollView"), code.indexOf("</ScrollView>"));

    expect(scroll).toMatch(/ACCOUNT\.map/);
    expect(scroll).toMatch(/APP\.map/);
  });
});
