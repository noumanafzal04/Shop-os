import { PROJECT_ROOT, fs, path, sourceFiles } from "./support/node";

/**
 * Dark mode, and the escape hatch that used to make it impossible.
 *
 * `theme/index.ts` exported a static `colors` — the LIGHT palette, frozen. A
 * file that read it rendered in light mode for ever, whatever the phone was set
 * to, and twenty-three files did, because for most of this app's life the
 * provider that makes the alternative work was never mounted. The deprecated
 * export was not a shortcut; it was the only thing that functioned.
 *
 * This file began as a RATCHET: a recorded list of those files, allowed to
 * shrink and never to grow. That was the right shape while the list had
 * twenty-three names on it. It has none now, the export is deleted, and the
 * rule is enforced by the compiler instead — an import that does not resolve is
 * a better guard than a test that greps.
 *
 * What is left here is the pair of things a compiler cannot check.
 */

const ROOT = PROJECT_ROOT;

describe("dark mode", () => {
  it("has no static palette to import", () => {
    const index = fs.readFileSync(path.join(ROOT, "src/theme/index.ts"), "utf8");

    // Re-adding it would compile, look right to whoever wrote it, and freeze
    // their screen in light mode on somebody else's phone. It is not neutral
    // dead code — it is a trap with a friendly name.
    expect(index).not.toMatch(/^export const colors\b/m);
  });

  it("is never pinned to one theme", () => {
    const app = fs.readFileSync(path.join(ROOT, "App.tsx"), "utf8");

    // Pinned to light for exactly as long as any screen could not leave it: a
    // half-dark app — new components dark, the shop and checkout white — is
    // worse than either theme. A pin left in place afterwards would be a dark
    // mode that was built, tested and never switched on, which is the failure
    // that put ThemeProvider in this state to begin with.
    //
    // The RULE is "not pinned", so that is what this asks. It used to assert
    // the literal `initialPreference="system"`, which was the same thing only
    // while there was nowhere to save a choice — and then failed on the commit
    // that let somebody make one.
    expect(app).not.toMatch(/initialPreference="(light|dark)"/);
    expect(app).toMatch(/initialPreference=\{/);
  });

  it("starts from what was saved, and paints nothing until it knows", () => {
    const app = fs.readFileSync(path.join(ROOT, "App.tsx"), "utf8");

    // Mounting on "system" and correcting once the stored value arrives is a
    // visible flash of the wrong theme on every cold start — precisely what
    // somebody choosing dark is choosing it to avoid.
    expect(app).toMatch(/prefs\.all\(\)/);
    expect(app).toMatch(/onPreferenceChange/);
  });

  it("draws nothing in literal black", () => {
    const files = sourceFiles(path.join(ROOT, "src")).filter(
      (f) => !path.relative(ROOT, f).startsWith("src/theme/"),
    );
    expect(files.length).toBeGreaterThan(30);

    // `c.black` is the same #160d0a in BOTH themes — that is the point of it.
    // There is no ground in this app it belongs on: the brand fill is a dark
    // red, so black on it is unreadable, and everywhere else `c.text` is the
    // colour that flips. Six screens drew their back arrow in it and were
    // invisible on a dark phone; the guard above could not see any of them,
    // because they all call `useColors()` perfectly correctly.
    const offenders = files
      .flatMap((f) =>
        fs
          .readFileSync(f, "utf8")
          .split("\n")
          .map((line, i) => [i + 1, line] as const)
          .filter(([, line]) => /\bc\.black\b/.test(line))
          .map(([n, line]) => `  ${path.relative(ROOT, f)}:${n}  ${line.trim()}`),
      );

    expect(offenders.join("\n")).toBe("");
  });

  it("never lets a spacer wear a button's fill", () => {
    const files = sourceFiles(path.join(ROOT, "src"));
    expect(files.length).toBeGreaterThan(30);

    // A header centres its title by putting an empty View opposite the back
    // button. Reusing the BUTTON's style gives that gap the button's surface
    // fill and border — an empty white circle floating in the top right with
    // nothing in it. Found on the tracking screen, fixed there, and still
    // present on two more screens a fortnight later, which is why it is a
    // rule now rather than a fix.
    const offenders = files
      .flatMap((f) =>
        fs
          .readFileSync(f, "utf8")
          .split("\n")
          .map((line, i) => [i + 1, line] as const)
          .filter(([, line]) => /<View style=\{styles\.back\}\s*\/>/.test(line))
          .map(([n, line]) => `  ${path.relative(ROOT, f)}:${n}  ${line.trim()}`),
      );

    expect(offenders.join("\n")).toBe("");
  });

  it("leaves no screen reading a palette that cannot change", () => {
    const files = sourceFiles(path.join(ROOT, "src")).filter(
      (f) => !path.relative(ROOT, f).startsWith("src/theme/"),
    );

    // A count of findings is not evidence without a count of attempts: a glob
    // that silently matched nothing would report a clean sweep.
    expect(files.length).toBeGreaterThan(30);

    const offenders = files
      .filter((f) => {
        const src = fs.readFileSync(f, "utf8");
        return (
          /from "[^"]*theme"/.test(src) &&
          !/\buseColors\b|\buseTheme\b/.test(src) &&
          /\bcolors\./.test(src)
        );
      })
      .map((f) => `  ${path.relative(ROOT, f)}`);

    expect(offenders.join("\n")).toBe("");
  });

  it("never paints text or a card with a pigment that ignores the theme", () => {
    // `white` and `black` are LITERAL in both themes, on purpose: they are what
    // text sitting on a brand fill is drawn in, and that stays white whichever
    // theme the phone is in.
    //
    // Which makes them a trap everywhere else. `color: c.black` is near-black
    // text on a near-black page — invisible — and `backgroundColor: c.white`
    // is a white card on a dark one. Sixty-eight lines read that way after the
    // screens were migrated: the styles reacted to the theme correctly and
    // resolved to a light-mode pigment anyway, which is the failure that looks
    // most like success.
    const files = sourceFiles(path.join(ROOT, "src"));

    const offenders = files
      .flatMap((f) =>
        fs
          .readFileSync(f, "utf8")
          .split("\n")
          .map((line, i) => [i + 1, line] as const)
          .filter(([, line]) => /\bcolor: c\.black\b|\bbackgroundColor: c\.white\b/.test(line))
          .map(([n, line]) => `  ${path.relative(ROOT, f)}:${n}  ${line.trim()}`),
      );

    expect(
      offenders.length === 0
        ? ""
        : "Use c.text and c.surface — these ignore the theme:\n" + offenders.join("\n"),
    ).toBe("");
  });
});
