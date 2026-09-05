import { PROJECT_ROOT, fs, path, sourceFiles } from "./support/node";

/**
 * EVERY DESTINATION EXISTS.
 *
 * `navigation.navigate("RiderHome")` is a STRING. TypeScript checks nothing
 * about it — the navigator is typed `any` at every call site in this app — so
 * a route that was renamed, or one added to a menu before it was added to the
 * navigator, is a button that does nothing at all on a device and compiles
 * perfectly on the way there.
 *
 * This is the same rule the panel learned as "offered must be reachable", and
 * it earns its place the moment a feature adds four routes at once: the side
 * menu names them, the navigator registers them, and nothing in between was
 * checking that those two lists agree.
 *
 * ── What counts as a destination ─────────────────────────────────────
 *
 * A screen registered on either navigator, plus the TAB names, which are
 * routes on the tab navigator rather than the stack — `navigate("OrdersTab")`
 * from the side menu is legitimate and lands on the tab.
 */

const ROOT = PROJECT_ROOT;
const NAV = path.join(ROOT, "src/navigation/RootNavigator.tsx");

/** Comments stripped: prose naming a route is not a call to it. */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function registeredRoutes(): Set<string> {
  const src = fs.readFileSync(NAV, "utf8");
  const names = new Set<string>();
  const re = /<Customer(?:Stack|Tabs)\.Screen[^>]*?name="([\w]+)"/gs;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) names.add(m[1]);
  return names;
}

describe("every screen this app navigates to is registered", () => {
  const routes = registeredRoutes();

  // A count of findings is not evidence without a count of attempts: if the
  // regex stops matching, this test would pass by finding nothing to check.
  it("found the navigator's screens", () => {
    expect(routes.size).toBeGreaterThanOrEqual(18);
    expect(routes.has("Tabs")).toBe(true);
    expect(routes.has("CartTab")).toBe(true);
  });

  it("has no navigate() to a name nothing registers", () => {
    const files = sourceFiles(path.join(ROOT, "src"));
    expect(files.length).toBeGreaterThan(30);

    const broken: string[] = [];

    for (const file of files) {
      const src = codeOnly(fs.readFileSync(file, "utf8"));
      const lines = src.split("\n");

      lines.forEach((line, i) => {
        // `navigate("X")` and `navigate("X", { … })` — the literal form. A
        // computed target cannot be checked here and is checked below instead.
        const re = /\bnavigat(?:e|ion\.navigate)\(\s*"([\w]+)"/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(line)) !== null) {
          // A nested navigate names its PARENT here and its child in the
          // options object, which the parent's own navigator resolves.
          if (routes.has(m[1])) continue;
          broken.push(`  ${path.relative(ROOT, file)}:${i + 1}  → ${m[1]}`);
        }
      });
    }

    expect(broken.join("\n")).toBe("");
  });

  it("has no `screen:` target that nothing registers", () => {
    // `navigate("Tabs", { screen: "CartTab" })` — the child is named in the
    // options, and gets no type checking either.
    const files = sourceFiles(path.join(ROOT, "src"));
    const broken: string[] = [];

    for (const file of files) {
      const src = codeOnly(fs.readFileSync(file, "utf8"));
      src.split("\n").forEach((line, i) => {
        const m = /\bscreen:\s*"([\w]+)"/.exec(line);
        if (m != null && !routes.has(m[1])) {
          broken.push(`  ${path.relative(ROOT, file)}:${i + 1}  → ${m[1]}`);
        }
      });
    }

    expect(broken.join("\n")).toBe("");
  });

  it("registers everywhere the side menu can send somebody", () => {
    // The menu builds its rider row from a function that returns a route NAME
    // per application state — five states, and only one of them is the one a
    // developer has on screen while writing it.
    const src = codeOnly(fs.readFileSync(path.join(ROOT, "src/navigation/SideMenu.tsx"), "utf8"));

    const named = [...src.matchAll(/route:\s*"([\w]+)"/g)].map((m) => m[1]);
    expect(named.length).toBeGreaterThanOrEqual(8);

    for (const route of named) {
      expect(routes.has(route)).toBe(true);
    }
  });
});
