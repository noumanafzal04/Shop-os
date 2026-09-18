import { fs, path, PROJECT_ROOT, codeOnly } from "./support/node";

const HELP = path.join(PROJECT_ROOT, "src", "modules", "account", "screens", "HelpScreen.tsx");
const TABS = path.join(PROJECT_ROOT, "src", "navigation", "tabsFor.ts");

const help = () => fs.readFileSync(HELP, "utf8");

/**
 * THE HELP KEEPS UP WITH THE APP.
 *
 * A STANDING RULE in this codebase — a code change updates the help — and
 * standing rules that live only in a docblock are the ones that rot. Six
 * phases of this app shipped before `HelpScreen.tsx` had a word in it, which
 * is the evidence that remembering does not work.
 *
 * What can be checked mechanically is coverage: every tab a person can be
 * given must have something written about it. What CANNOT be checked is
 * whether the answer is any good, so these are a floor and not a substitute
 * for reading it.
 */
describe("the help covers what the app does", () => {
  it("has an answer for every permission the tab bar gates on", () => {
    /**
     * `tabsFor` is the list of what this app offers. A tab somebody can open
     * with nothing written about it is a screen they have to work out; a help
     * page that answers for a tab they cannot open is worse, which is why the
     * topics carry the SAME permission strings and are filtered by them.
     */
    const gated = [
      ...codeOnly(fs.readFileSync(TABS, "utf8")).matchAll(/permission:\s*"([a-z_]+\.[a-z_]+)"/g),
    ].map((m) => m[1]!);

    expect(gated.length).toBeGreaterThan(0);

    const topics = help();
    for (const permission of gated) {
      expect({ permission, covered: topics.includes(`"${permission}"`) }).toEqual({
        permission,
        covered: true,
      });
    }
  });

  it("is reachable from Account", () => {
    /**
     * Written and unreachable is the same as unwritten, and this codebase has
     * shipped that seven times under the name "built but unreachable".
     */
    const account = codeOnly(
      fs.readFileSync(
        path.join(PROJECT_ROOT, "src", "modules", "account", "screens", "AccountScreen.tsx"),
        "utf8",
      ),
    );
    expect(account).toMatch(/navigate\("Help"\)/);

    const stack = codeOnly(
      fs.readFileSync(path.join(PROJECT_ROOT, "src", "navigation", "AccountStack.tsx"), "utf8"),
    );
    expect(stack).toContain('name="Help"');
    expect(stack).toContain("HelpScreen");
  });

  it("says what the app cannot do, not only what it can", () => {
    /**
     * The shop has no way to pause orders — the server has no such state. Help
     * that only lists features leaves somebody hunting for a switch that does
     * not exist, and concluding the app is broken. Saying so is cheaper than
     * the support thread.
     */
    expect(help()).toMatch(/no pause switch/i);
  });

  it("carries enough to be worth opening", () => {
    // A file with three questions in it is a placeholder wearing a page's
    // name. Twelve is not a magic number; it is more than a stub.
    const questions = [...help().matchAll(/^\s*q:\s*/gm)].length;
    expect(questions).toBeGreaterThan(12);
  });
});
