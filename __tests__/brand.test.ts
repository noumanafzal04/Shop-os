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
/**
 * Comments blanked, LINE NUMBERS KEPT — and STRINGS LEFT ALONE.
 *
 * ── Two wrong versions of this, and the second was worse ─────────────
 *
 * It began as `/^\s*(\/\/|\/\*|\*)/` per line, which sees a comment that
 * STARTS a line and is blind to the middle of a block. A JSX comment written
 * as indented prose, with no leading asterisks, is invisible to it — the third
 * guard in this repo to fail on its own documentation in one day.
 *
 * The obvious fix — two regexes, one for block comments and one for `//` to
 * end of line — is worse than the bug. `//` appears inside every URL, so
 *
 *     const PROD_URL = "https://cartze.shop/api/v1";
 *
 * came out as `const PROD_URL = "https:` and the brand name vanished. A guard
 * whose whole job is to find the product's name in shipped strings, blinded to
 * the one string that is most likely to carry it.
 *
 * So this walks the source instead, and a `//` or a `/*` inside a string
 * literal is just text. Blanked rather than deleted, so a real hit still
 * reports a line number somebody can open.
 */
const stripComments = (src: string): string => {
  let out = "";
  let i = 0;
  /** The quote we are inside, or null. Template literals count. */
  let quote: string | null = null;

  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];

    if (quote != null) {
      // A backslash escapes whatever follows, including the closing quote.
      if (ch === "\\") {
        out += src.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      out += ch;
      i += 1;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }

    if (ch === "/" && next === "*") {
      const close = src.indexOf("*/", i + 2);
      const stop = close === -1 ? src.length : close + 2;
      // Newlines kept so every later line keeps its number.
      out += src.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
      continue;
    }

    if (ch === "/" && next === "/") {
      const nl = src.indexOf("\n", i);
      const stop = nl === -1 ? src.length : nl;
      out += " ".repeat(stop - i);
      i = stop;
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
};

describe("the comment stripper itself", () => {
  // A detector checked against a known-good and a known-bad input, so a change
  // that breaks it fails HERE rather than reporting a clean sweep everywhere.
  it("removes a block comment, whatever the line starts with", () => {
    const out = stripComments('const a = 1;\n/*\n  CartZe is the brand.\n*/\nconst b = 2;');
    expect(out).not.toMatch(/CartZe/);
    // Line numbers survive, so an offence can still be opened.
    expect(out.split("\n")).toHaveLength(5);
  });

  it("removes a trailing line comment", () => {
    expect(stripComments('const a = 1; // CartZe')).not.toMatch(/CartZe/);
  });

  it("LEAVES A URL ALONE", () => {
    // The bug the naive version had: `//` inside a scheme ate the rest of the
    // line, so the one string most likely to carry the brand was the one the
    // guard could not see.
    const url = 'const PROD_URL = "https://cartze.shop/api/v1";';
    expect(stripComments(url)).toBe(url);
  });

  it("leaves a comment marker inside a string alone", () => {
    const s1 = `const a = "/* not a comment */";`;
    expect(stripComments(s1)).toBe(s1);
    const s2 = "const a = `https://cartze.shop`;";
    expect(stripComments(s2)).toBe(s2);
  });

  it("is not fooled by an escaped quote", () => {
    const line = 'const a = "he said \\"// cartze\\"";';
    expect(stripComments(line)).toBe(line);
  });
});

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
      const offences = stripComments(fs.readFileSync(full, "utf8"))
        .split("\n")
        .map((line, i) => [i + 1, line] as const)
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
