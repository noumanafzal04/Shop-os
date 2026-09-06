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

  it("wears the colour of the half it leads to", () => {
    // This button always goes to the OTHER side, so it looks like that side:
    // green while you are working and about to shop, the brand's orange while
    // you are shopping and about to work. A control that leads somewhere
    // ought to look like where it leads.
    //
    // It also replaces three style variants — on, off, and a base — with one
    // value, which is why "not yet approved" can no longer drift back to grey:
    // there is no separate style left to make grey. It was grey once, on the
    // reasoning that a control you cannot use should not shout; that is the
    // wrong reading of an INVITATION that leads to the application form.
    expect(code).toMatch(/style=\{\[styles\.switcher, \{ backgroundColor: other\.primary \}\]\}/);
    expect(code).toMatch(/const other = useOppositeColors\(\)/);
    expect(code).not.toMatch(/switcherOff/);
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

/**
 * THE MODE IS DECIDED BEFORE THE FIRST PAINT.
 *
 * The restore itself was already right — the stored mode, honoured only while
 * the server still approves it. What was wrong was WHEN it landed: the splash
 * lifted as soon as auth was known, so a rider who closed the app on their
 * board reopened into the shopping tabs and was moved across a beat later,
 * once the preference read resolved.
 *
 * A mode is not a preference that can be applied late. It decides which
 * navigator EXISTS, so arriving a frame after the first paint is a visible
 * flip of the whole app — and on a slow read, long enough to tap something in
 * the wrong half.
 */
describe("the splash waits until it knows which hat", () => {
  const nav = fs
    .readFileSync(path.join(PROJECT_ROOT, "src/navigation/RootNavigator.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  it("holds the splash for the mode, not only for the session", () => {
    expect(nav).toMatch(/if \(status === "booting" \|\| !modeKnown\) return <Splash \/>;/);
  });

  it("lifts it once the preference has answered, however it answered", () => {
    // A prefs read that FAILS is a device that cannot tell us, not a reason to
    // hold somebody on a splash for ever — `.finally`, not `.then`.
    expect(nav).toMatch(/\.catch\(\(\) => \{\}\)\s*\.finally\(\(\) => setModeKnown\(true\)\)/);
  });

  it("waits on a query that SETTLED, not on one that succeeded", () => {
    // A query that errors is never successful. `/rider/me` failing left the
    // splash up for ever — and an errored query leaves `canRide` false, which
    // is the safe answer to "open on a job board?" whatever went wrong.
    expect(nav).toMatch(/!rider\.isFetched/);
    expect(nav).not.toMatch(/!rider\.isSuccess/);
  });

  it("never lets an account that has no mode wait for one", () => {
    // A business login never sees the tabs, and the rider endpoint is never
    // asked about them — so the gate had nothing to wait FOR, and waited.
    expect(nav).toMatch(
      /status === "authenticated" && user != null && user\.role !== "customer"\) setModeKnown\(true\)/,
    );
  });

  it("opens the app anyway if nothing answers at all", () => {
    /**
     * THE RULE THIS GATE KEEPS BREAKING.
     *
     * Waiting for the mode is an OPTIMISATION — it buys a rider a first paint
     * on the right half of the app. It must never be the reason the app does
     * not open, and twice it was. The timeout is what makes that structural
     * rather than a promise: whatever else is wrong, the splash lifts.
     */
    expect(nav).toMatch(/setTimeout\(\(\) => setModeKnown\(true\), \d+\)/);
    expect(nav).toMatch(/return \(\) => clearTimeout\(id\)/);
  });

  it("does not make a guest wait for a mode they do not have", () => {
    expect(nav).toMatch(/if \(status === "guest"\) setModeKnown\(true\)/);
  });

  it("still refuses a remembered mode the server no longer allows", () => {
    // The denominator: waiting for the answer must not have changed WHAT the
    // answer is. A preference is never a permission.
    expect(nav).toMatch(/hydrateMode\(p\.mode, canRide\)/);
  });
});

/**
 * A DOOR LOOKS LIKE WHERE IT LEADS.
 *
 * Two controls take somebody to the other half of the app — the switch in this
 * menu and "Deliver with CartZe" on the account page. Both wear that half's
 * colour, so pressing an orange button and arriving in an orange app is the
 * switch explaining itself before it is pressed.
 */
describe("the two doors", () => {
  const read = (rel: string) =>
    fs
      .readFileSync(path.join(PROJECT_ROOT, rel), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");

  it("colours the account page's rider row by its destination", () => {
    const account = read("src/modules/account/screens/AccountScreen.tsx");
    expect(account).toMatch(/const other = useOppositeColors\(\)/);
    expect(account).toMatch(/accent=\{other\.primary\}/);
  });

  it("uses it for THAT row and nothing else", () => {
    // Two colours on a page is a page with no accent. This is deliberately
    // narrow: one row, and it is a door.
    const account = read("src/modules/account/screens/AccountScreen.tsx");
    expect((account.match(/accent=\{other\.primary\}/g) ?? []).length).toBe(1);
  });

  it("keeps the hook itself to the two places that are doors", () => {
    const users = ["src/navigation/SideMenu.tsx", "src/modules/account/screens/AccountScreen.tsx"];
    for (const rel of users) {
      expect(`${rel}: ${/useOppositeColors/.test(read(rel))}`).toBe(`${rel}: true`);
    }
  });
});
