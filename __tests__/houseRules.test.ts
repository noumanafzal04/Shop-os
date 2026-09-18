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
