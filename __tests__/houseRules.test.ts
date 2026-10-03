import { fs, path, PROJECT_ROOT, codeOnly, sourceFiles } from "./support/node";

const SRC = sourceFiles(path.join(PROJECT_ROOT, "src"));

/** Source with its prose removed — a guard must not fire on its own docblock. */
const bodies = () =>
  SRC.map((f) => ({ file: f.replace(PROJECT_ROOT, ""), code: codeOnly(fs.readFileSync(f, "utf8")) }));

describe("the house rules this product has already paid for", () => {
  it("scans something", () => {
    // A walker that finds nothing makes every rule below vacuous.
    expect(SRC.length).toBeGreaterThan(20);
  });

  it("never takes today's date from UTC", () => {
    /**
     * `toISOString().slice(0, 10)` is the UTC date. In Karachi that is
     * YESTERDAY until 05:00, and this product has already filed a day's
     * takings against the wrong date because of it. An expense recorded at
     * 2am lands on the day before it was spent, and nobody notices until the
     * month is reconciled.
     */
    for (const { file, code } of bodies()) {
      expect({ file, hit: /toISOString\(\)\s*\.\s*slice\(\s*0\s*,\s*10\s*\)/.test(code) }).toEqual({
        file,
        hit: false,
      });
    }
  });

  it("never draws TEXT or an ICON in c.primary", () => {
    /**
     * THE PALETTE STATES THIS RULE AND NOTHING ENFORCED IT.
     *
     * `themes.ts` on the emerald side: *"on the green side a brand-coloured
     * MARK takes `primaryPressed`, and `primary` is for FILLS"*. #10b981
     * measures **2.54:1 against white** — under AA, under AA-large, under even
     * the 3:1 floor for a non-text UI component. `primaryPressed` (#047857) is
     * 5.48:1 and is the same green to a reader.
     *
     * Two sites shipped breaking it, and they were the worst two possible: the
     * SELECTED TAB label and icon — the most-looked-at text in the app — and
     * the dashboard's URGENT waiting count, the one number on the screen that
     * has to be read. Both were found by opening a screenshot, not by a test,
     * because this product keeps writing rules in a palette and reading them
     * nowhere. The button that drew `c.white` was the same shape of defect.
     *
     * `backgroundColor`, `borderColor` and `tintColor` are untouched — a FILL
     * is exactly what this colour is for. A logotype is exempt under WCAG
     * 1.4.3 and must say `logotype` on the spot to claim it.
     */
    /**
     * RAW source, not `codeOnly` — and that is a decision, not an oversight.
     *
     * `codeOnly` deletes block comments outright, which shifts every line
     * number after one and silently ate the `logotype` opt-out this rule
     * depends on. So comments are skipped LINE BY LINE instead: a docblock
     * line explaining the rule begins with `*` or `//` and is passed over,
     * while the marker beside a real line survives and can be read.
     */
    for (const f of SRC) {
      const file = f.replace(PROJECT_ROOT, "");
      const lines = fs.readFileSync(f, "utf8").split("\n");
      const isProse = (l: string) => /^\s*(\*|\/\/|\/\*)/.test(l);

      const offenders = lines
        .map((line, i) => ({ line, i }))
        .filter(({ line }) => !isProse(line))
        .filter(({ line }) => /\bcolor\s*[:=]\s*\{?\s*c\.primary\b(?!Pressed|Soft)/.test(line))
        // The opt-out has to be argued for on the spot, not in a list here.
        .filter(({ i }) => !/logotype/i.test(lines.slice(Math.max(0, i - 3), i + 1).join(" ")))
        .map(({ line, i }) => `${file}:${i + 1} ${line.trim()}`);

      expect(offenders).toEqual([]);
    }
  });

  it("never rounds a small view with radius.full", () => {
    /**
     * 9999 renders SQUARE on a view under roughly 40pt under Fabric — thirty
     * of them shipped that way once. Small circles state their own radius.
     */
    for (const { file, code } of bodies()) {
      expect({ file, hit: /radius\.full/.test(code) }).toEqual({ file, hit: false });
    }
  });

  it("never uses stickyHeaderIndices or a native-driver scroll listener", () => {
    // Both are banned in this product's React Native: the first mispositions
    // under Fabric, the second drops frames on a list that is also loading.
    for (const { file, code } of bodies()) {
      expect({ file, hit: /stickyHeaderIndices/.test(code) }).toEqual({ file, hit: false });
      expect({
        file,
        hit: /onScroll=\{Animated\.event[\s\S]{0,200}useNativeDriver:\s*true/.test(code),
      }).toEqual({ file, hit: false });
    }
  });

  it("never spells a currency itself", () => {
    /**
     * PKR only, and `money()` is the one place that says so. A hand-written
     * "Rs " is how a screen ends up with a different spacing, a different
     * thousands separator, or a dollar sign in a product that has never sold
     * anything in dollars.
     */
    for (const { file, code } of bodies()) {
      expect({ file, hit: /["'`]\s*Rs\s*[{$]/.test(code) || /\$\{?\s*[a-z]+\s*\}?\s*USD/.test(code) }).toEqual({
        file,
        hit: false,
      });
    }
  });

  it("keeps the customer app's storage keys out of this one", () => {
    /**
     * `shopos.auth` is the OTHER app's Keychain service. Two apps on one phone
     * is the normal case here — a shopkeeper who also orders lunch — and
     * sharing the service means signing into one silently replaces the session
     * of the other.
     */
    for (const { file, code } of bodies()) {
      expect({ file, hit: /shopos\./.test(code) }).toEqual({ file, hit: false });
    }
  });
});
