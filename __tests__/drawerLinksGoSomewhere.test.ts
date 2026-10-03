import { fs, path, PROJECT_ROOT } from "./support/node";

const read = (p: string) => fs.readFileSync(path.join(PROJECT_ROOT, p), "utf8");

const DRAWER = read("src/common/components/DrawerHost.tsx");
const TYPES = read("src/navigation/types.ts");

/**
 * A SIDEBAR LINK THAT GOES NOWHERE FAILS IN SILENCE.
 *
 * The first version of the drawer called `navigate("Menu", { screen })` from a
 * component that wraps the TAB navigator — so its `useNavigation` is the ROOT
 * stack's, and the root has no route called "Menu". react-navigation's answer
 * to an unknown route is to do nothing: the panel closed, the screen did not
 * change, and there was no error anywhere. Four links, all dead, and the only
 * way it was found was pressing one on a phone.
 *
 * Nothing else in this suite could see it. The screens exist, the routes are
 * registered, the types compile — the DESTINATIONS were all fine. What was
 * wrong was the path taken to them, which is a string.
 */
describe("every sidebar link goes somewhere real", () => {
  /** `{ screen: tab, params: { screen: "X" } }` → the tab and the screen. */
  const tabTargets = [...DRAWER.matchAll(/const to(\w+) = toTab\("(\w+)"\)/g)].map((m) => ({
    helper: `to${m[1]}`,
    tab: m[2],
  }));

  const links = [...DRAWER.matchAll(/onPress: to(\w+)\("(\w+)"\)/g)].map((m) => ({
    helper: `to${m[1]}`,
    screen: m[2],
  }));

  it("finds the links, or every case below is vacuous", () => {
    expect(tabTargets.length).toBeGreaterThan(0);
    expect(links.length).toBeGreaterThanOrEqual(6);
  });

  it("navigates from the ROOT, because that is where this component sits", () => {
    /**
     * The mutation this catches: changing `toTab` back to `nav.navigate(tab,
     * { screen })`. It type-checks, it runs, and every link silently does
     * nothing.
     */
    expect(DRAWER).toMatch(/nav\.navigate\("Tabs",\s*\{\s*screen:\s*tab,\s*params:/);
    expect(DRAWER).not.toMatch(/nav\.navigate\(tab\s*,/);
  });

  it("names a tab that the tab param list declares", () => {
    const declared = TYPES.slice(
      TYPES.indexOf("export type PartnerTabParamList"),
      TYPES.indexOf("export type TabsAreCovered"),
    );
    for (const { helper, tab } of tabTargets) {
      expect({ helper, tab, declared: new RegExp(`\\b${tab}:`).test(declared) }).toEqual({
        helper,
        tab,
        declared: true,
      });
    }
  });

  it("names a screen that its tab's stack declares", () => {
    const listFor: Record<string, string> = {
      Menu: "MenuStackParamList",
      Account: "AccountStackParamList",
      Orders: "OrdersStackParamList",
      Money: "MoneyStackParamList",
    };
    const byHelper = Object.fromEntries(tabTargets.map((t) => [t.helper, t.tab]));

    for (const { helper, screen } of links) {
      const tab = byHelper[helper];
      const listName = listFor[tab];
      expect({ helper, tab, listName: typeof listName }).toEqual({
        helper,
        tab,
        listName: "string",
      });

      /**
       * The closing brace at the START OF A LINE, not the first `};` found.
       *
       * `ProductDetail: { id: string };` contains one, so a naive search cut
       * `MenuStackParamList` off after its second entry and reported every
       * later route as undeclared — including `ProductForm`, which is
       * declared. A guard that mis-parses the thing it is checking is the
       * failure this suite has already paid for twice: the route parser that
       * dropped multi-line prefix groups, and the reachability check an
       * unused import satisfied.
       */
      const start = TYPES.indexOf(`export type ${listName}`);
      const end = TYPES.indexOf("\n};", start);
      const body = TYPES.slice(start, end);

      expect({ link: `${tab} → ${screen}`, declared: new RegExp(`\\b${screen}:`).test(body) }).toEqual(
        { link: `${tab} → ${screen}`, declared: true },
      );
    }
  });
});
