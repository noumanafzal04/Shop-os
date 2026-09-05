import { PROJECT_ROOT, fs, path, sourceFiles } from "./support/node";
import { BRAND } from "../src/common/brand";

/**
 * The product will be renamed again, so the name must live in ONE place.
 *
 * A comment saying so is not a mechanism — the panel learned that when a rule
 * stated in one file was implemented in none. This walks the source and fails
 * on a spelled-out brand name, so the promise in `brand.ts` is kept by
 * something that runs.
 *
 * ── What is allowed to spell a name out, and why ───────────────────────
 *
 * Only files that hold an ADDRESS rather than a label. An address does not
 * move house when the product is renamed: rename it and it points somewhere
 * empty, which is worse than a stale name because nothing says so.
 */
const ALLOWED = new Map<string, string>([
  ["src/common/brand.ts", "the constant itself"],
  [
    "src/common/utils/secureStorage.ts",
    "the Keychain service name — renaming it signs every user out silently",
  ],
  [
    "src/common/config.ts",
    "the API host — the server does not move because the product was renamed",
  ],
  [
    "src/common/utils/prefs.ts",
    "the Keychain service holding saved settings — same reason as the session store",
  ],
]);

/**
 * Names that must not appear in source. Matched case-INSENSITIVELY and past
 * names count: `shopos.auth` and `api.shopos.app` are the exact strings this
 * exists to surface, and neither carries the capitals.
 */
const NAMES = [BRAND.name, "ShopOS"].map((n) => n.toLowerCase());

const ROOT = PROJECT_ROOT;

/**
 * Comment lines are skipped: prose explaining a decision may name the product,
 * and holding prose to this rule would push people to write no prose. Only
 * what the app can RENDER is checked.
 */
const isComment = (line: string) => /^\s*(\/\/|\/\*|\*)/.test(line);

describe("the product's name lives in exactly one place", () => {
  const files = [...sourceFiles(path.join(ROOT, "src")), path.join(ROOT, "App.tsx")];

  it("scanned the source tree it claims to scan", () => {
    // Without this, a glob that silently matched nothing would report a clean
    // sweep — the same shape as a test asserting a response is "not empty".
    expect(files.length).toBeGreaterThan(30);
  });

  it.each(files.map((f) => [path.relative(ROOT, f), f] as const))(
    "%s does not spell the brand out",
    (rel, full) => {
      const reason = ALLOWED.get(rel);
      const offences = fs
        .readFileSync(full, "utf8")
        .split("\n")
        .map((line, i) => [i + 1, line] as const)
        .filter(([, line]) => !isComment(line))
        .filter(([, line]) => NAMES.some((n) => line.toLowerCase().includes(n)))
        .map(([n, line]) => `  ${rel}:${n}  ${line.trim()}`);

      if (reason) {
        // An allow-listed file has to still USE its exemption. One that stops
        // needing it should lose it, or the list becomes a place names hide.
        expect(offences.length).toBeGreaterThan(0);
        return;
      }

      expect(offences.join("\n")).toBe("");
    },
  );

  it("renders from the constant, so a rename follows automatically", () => {
    expect(BRAND.name).not.toBe("");
    expect(BRAND.name).not.toContain("ShopOS");
  });
});
