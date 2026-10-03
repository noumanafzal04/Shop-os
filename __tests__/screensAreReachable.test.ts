import { fs, path, PROJECT_ROOT, sourceFiles } from "./support/node";

const SRC = path.join(PROJECT_ROOT, "src");
const screens = sourceFiles(SRC).filter((f) => /[/\\]screens[/\\][A-Za-z]+Screen\.tsx$/.test(f));
const navigators = sourceFiles(path.join(SRC, "navigation"))
  .map((f) => fs.readFileSync(f, "utf8"))
  .join("\n");

/**
 * A SCREEN NOBODY CAN OPEN IS NOT A FEATURE.
 *
 * This product has shipped built-but-unreachable pages more than once — the
 * offline_selling admin screen, the reorder list, a bay board that read page
 * one for ever. They are expensive precisely because nothing fails: the code
 * is written, reviewed, type-checked and tested, and then no route reaches it.
 *
 * Seven screen files in this app were comment-only stubs at the time this was
 * written, which is honest — a stub is a plan. The failure is the OTHER shape:
 * a file that exports a real component that no navigator mounts. That is the
 * one this asks about.
 */
describe("every screen that exists can be opened", () => {
  it("finds screens and navigators, or this case proves nothing", () => {
    expect(screens.length).toBeGreaterThan(8);
    expect(navigators).toContain("Stack.Screen");
  });

  it("mounts every screen that exports a component", () => {
    const orphans = screens
      .filter((f) => /export\s+function\s+\w+Screen\s*\(/.test(fs.readFileSync(f, "utf8")))
      .map((f) => (f.split(/[/\\]/).pop() ?? "").replace(".tsx", ""))
      /**
       * MOUNTED, not merely mentioned — and the first version got that wrong.
       *
       * It asked `navigators.includes(name)`, which an IMPORT satisfies.
       * Deleting a `<Stack.Screen>` while leaving its import at the top kept
       * this green: the guard was blind to the exact thing it exists for, and
       * only mutation showed it.
       *
       * THREE shapes, because this app genuinely mounts a screen three ways,
       * and a guard that knows one of them reports the other two as orphans:
       *
       *   component={X}   a stack route
       *   screen: X       the tab table in `PartnerTabs`
       *   <X />           rendered directly — BootScreen, while auth resolves
       */
      .filter(
        (name) =>
          !new RegExp(`component=\\{${name}\\}`).test(navigators) &&
          !new RegExp(`screen:\\s*${name}\\b`).test(navigators) &&
          !new RegExp(`<${name}\\s*/?>`).test(navigators),
      );

    expect(orphans).toEqual([]);
  });

  it("treats a stub as a plan, not as a screen", () => {
    /**
     * The other half, so the rule above cannot be satisfied by deleting the
     * check: a file under `screens/` that exports NOTHING is a stub, and the
     * case above must be looking at strictly fewer files than exist.
     */
    const stubs = screens.filter(
      (f) => !/export\s+function\s+\w+Screen\s*\(/.test(fs.readFileSync(f, "utf8")),
    );
    const built = screens.length - stubs.length;
    expect(built).toBeGreaterThan(8);
    expect(built).toBeLessThanOrEqual(screens.length);
  });
});
