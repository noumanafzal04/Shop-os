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
  existsSync(p: string): boolean;
};

/**
 * GIT, ASKED A QUESTION.
 *
 * Declared the same way `fs` is and for the same reason: `@types/node` is
 * program-wide and would hand every screen a global `process` and `Buffer`
 * that a phone does not have.
 *
 * A guard about what is IN the repository has to ask git rather than the
 * filesystem — "is this file ignored" and "is this file tracked" are different
 * questions with different answers, and only git knows either. Throws when the
 * command exits non-zero, which is how `check-ignore` says "not ignored".
 */
const childProcess = require("child_process") as {
  execFileSync(cmd: string, args: string[], opts: { cwd: string; encoding: "utf8" }): string;
};

export function git(args: string[]): string {
  return childProcess.execFileSync("git", args, { cwd: PROJECT_ROOT, encoding: "utf8" }).trim();
}

export const path = require("path") as {
  join(...parts: string[]): string;
  relative(from: string, to: string): string;
  /** The file's own name. Typed here rather than cast at a call site — a
   *  `as any` in a guard is how a guard stops being type-checked. */
  basename(p: string, ext?: string): string;
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

/**
 * ONE DECLARATION'S BODY, bounded by the next declaration.
 *
 * These checks used to take a fixed slice — `slice(0, 1200)` — which is a
 * window that has nothing to do with where the thing being tested ends. It
 * held while the docblocks happened to be short and broke the moment
 * `codeOnly` started preserving line positions, so the comments became
 * whitespace INSIDE the window rather than vanishing from it.
 *
 * A count is not a boundary. These are. They live here rather than in a test
 * file because a second copy in the next test is how two guards end up
 * bounding the same code two different ways and one of them wrong.
 *
 * Both THROW rather than calling `expect`, so the helper needs no jest
 * globals — a throw fails the test just as loudly and names the declaration
 * that could not be found.
 */
export function bodyOf(src: string, decl: string): string {
  const from = src.indexOf(decl);
  if (from === -1) throw new Error(`no declaration \`${decl}\``);

  const rest = src.slice(from + decl.length);
  const next = rest.search(/\n(?:export )?(?:function|const|class) /);

  return decl + (next === -1 ? rest : rest.slice(0, next));
}

/**
 * ONE STATEMENT, bounded by its own terminating semicolon.
 *
 * The first `;` at bracket depth zero, so a multi-line expression full of
 * `&&`, calls and object literals stays whole. `decl` may be the text of the
 * declaration or an index into `src`.
 */
export function statementAt(src: string, decl: string | number): string {
  const from = typeof decl === "number" ? decl : src.indexOf(decl);
  if (from === -1) throw new Error(`no statement \`${decl}\``);

  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const ch = src[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === ";" && depth === 0) return src.slice(from, i + 1);
  }

  throw new Error(`no statement end after \`${decl}\``);
}

/**
 * ONE BRACED BLOCK, bounded by its own closing brace.
 *
 * For a single entry inside an object literal — a `StyleSheet.create` rule,
 * say. `statementAt` cannot do this job: an entry ends with a COMMA, and
 * walking on for a depth-zero semicolon runs out of the enclosing object and
 * throws (which is how this was found rather than passing on a slice of the
 * whole stylesheet).
 */
export function blockAt(src: string, decl: string): string {
  const from = src.indexOf(decl);
  if (from === -1) throw new Error(`no block \`${decl}\``);

  const open = src.indexOf("{", from);
  if (open === -1) throw new Error(`no \`{\` after \`${decl}\``);

  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(from, i + 1);
    }
  }

  throw new Error(`unclosed block \`${decl}\``);
}
