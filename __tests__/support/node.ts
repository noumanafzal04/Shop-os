/**
 * Node's filesystem, declared to the exact shape the scanning tests use.
 *
 * `@types/node` would be the obvious move and is the wrong one: a reference
 * directive is program-wide, so it hands EVERY screen a global `fetch`,
 * `Buffer` and `process` that a phone does not have. Code written against them
 * type-checks and then crashes on device — and it immediately retyped
 * `Response.json()` across the app, which is how this was first noticed.
 *
 * Declared ONCE here rather than per test file: `declare function require` in
 * two files is a duplicate identifier, and the second one to be written is the
 * one that gets blamed.
 */
declare function require(id: string): unknown;
declare const __dirname: string;

interface DirEntry {
  name: string;
  isDirectory(): boolean;
}

export const fs = require("fs") as {
  readdirSync(p: string, o: { withFileTypes: true }): DirEntry[];
  readFileSync(p: string, encoding: "utf8"): string;
};

export const path = require("path") as {
  join(...parts: string[]): string;
  relative(from: string, to: string): string;
};

/** Every .ts/.tsx file under `dir`, recursively. */
export function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * The project root.
 *
 * Resolved here so no test file declares `__dirname` of its own — two files
 * doing that is a duplicate identifier, and the error names whichever was
 * written second rather than the practice.
 */
export const PROJECT_ROOT = path.join(__dirname, "..", "..");

/**
 * SOURCE WITH THE PROSE TAKEN OUT.
 *
 * ── Why every scanning guard needs this ──────────────────────────────
 *
 * A guard that greps source for the thing it forbids finds its own
 * explanation of the thing it forbids. `darkModeDebt` banned
 * `backgroundColor: c.white`, and then failed on the docblock of the style
 * that had been rewritten to obey it — the fourth guard in this codebase to
 * fire on its own documentation, after the rupee-string, sticky-header and
 * brand-name scans.
 *
 * The failure is not just noise. It teaches whoever hits it that the rule is
 * unreliable, and the next real violation is read as another false alarm.
 *
 * ── Positions are preserved ──────────────────────────────────────────
 *
 * Comments become the same number of spaces and newlines rather than
 * disappearing, so line and column numbers still point at the real file. Two
 * copies of this existed in `feel` and `accountPage`, both of which collapsed
 * the file — fine for a regex, useless for a guard that reports a line number,
 * which is why `darkModeDebt` could not simply use either.
 *
 * ── The sharp edge, stated ───────────────────────────────────────────
 *
 * This is a regex, not a parser: `//` inside a string literal starts a
 * "comment" as far as it is concerned, so `"https://x.test/a"` loses
 * everything after `https:`. That bug has already been shipped once — the
 * brand-name guard went blind to the very string it existed to catch because
 * `https://cartze.shop` ate the rest of the line.
 *
 * So: fine for finding a token that is never inside a URL. If a guard needs to
 * read string contents, it needs a string-literal-aware walker instead, and
 * that walker needs its own tests.
 */
export function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
}
