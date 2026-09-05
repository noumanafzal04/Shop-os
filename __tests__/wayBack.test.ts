import { PROJECT_ROOT, fs, path, sourceFiles } from "./support/node";

/**
 * Every pushed screen has a way back that is visible on the screen.
 *
 * Favourites and Reservations shipped without one. Both are reachable from the
 * side menu, and once you were on either the only way out was the phone's own
 * back — which on a gesture-navigation phone is a swipe from the edge that
 * nothing on screen mentions. The screens looked finished; the tests were
 * green; nobody had tried to leave.
 *
 * Root TABS are exempt because the bar is their navigation, and MODALS are
 * exempt because they are dismissed rather than popped.
 */

const ROOT = PROJECT_ROOT;

/** `<CustomerStack.Screen name="X" component={Y} ... />`, modals dropped. */
function pushedScreens(): Array<{ name: string; component: string }> {
  const nav = fs.readFileSync(path.join(ROOT, "src/navigation/RootNavigator.tsx"), "utf8");
  const out: Array<{ name: string; component: string }> = [];
  const re = /<CustomerStack\.Screen\s+name="(\w+)"\s+component=\{(\w+)\}([^/]*)\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(nav)) !== null) {
    const [, name, component, rest] = m;
    if (name === "Tabs") continue;
    if (/presentation:\s*"modal"/.test(rest)) continue;
    out.push({ name, component });
  }
  return out;
}

/** The file that exports a component, found by its export. */
function fileFor(component: string): string | null {
  const files = sourceFiles(path.join(ROOT, "src"));
  return (
    files.find((f) =>
      new RegExp(`export function ${component}\\b`).test(fs.readFileSync(f, "utf8")),
    ) ?? null
  );
}

describe("a pushed screen can always be left", () => {
  const screens = pushedScreens();

  // A count of findings is not evidence without a count of attempts: a regex
  // that stopped matching would report a clean sweep over nothing.
  it("found the stack's screens to check", () => {
    expect(screens.length).toBeGreaterThanOrEqual(6);
  });

  it.each(screens.map((s) => [s.name, s.component] as const))(
    "%s has a visible way back",
    (_name, component) => {
      const file = fileFor(component);
      expect(file).not.toBeNull();

      const src = fs.readFileSync(file!, "utf8");
      // Either the shared header, or its own back control. Both are visible;
      // relying on the hardware key is what this exists to stop.
      const hasWayBack = /\bScreenHeader\b/.test(src) || /navigation\.goBack\(\)/.test(src);
      expect(hasWayBack).toBe(true);
    },
  );
});
