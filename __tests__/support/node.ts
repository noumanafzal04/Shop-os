/**
 * Node's filesystem, declared to the exact shape these guards use.
 *
 * `@types/node` would be the obvious move and is the wrong one: a reference
 * directive is program-wide, so it hands EVERY screen a global `fetch`,
 * `Buffer` and `process` that a phone does not have. Code written against them
 * type-checks and then crashes on device. The customer app found this the
 * expensive way — it silently retyped `Response.json()` across the whole app —
 * and this project starts on the right side of it.
 *
 * Declared ONCE here rather than per test file: `declare function require` in
 * two files is a duplicate identifier, and the error names whichever was
 * written second rather than the practice.
 */
declare function require(id: string): unknown;
declare const __dirname: string;

interface DirEntry {
  name: string;
  isDirectory(): boolean;
}

export const fs = require("fs") as {
  readFileSync(p: string, encoding: "utf8"): string;
  existsSync(p: string): boolean;
  readdirSync(p: string, o: { withFileTypes: true }): DirEntry[];
};

export const path = require("path") as {
  join(...parts: string[]): string;
  resolve(...parts: string[]): string;
};

/** This project's root — one directory above `__tests__`. */
export const PROJECT_ROOT = path.join(__dirname, "..", "..");

/**
 * Every `.ts`/`.tsx` under `dir`, recursively.
 *
 * Guards that take a hand-written LIST of files are guards that go quiet the
 * first time somebody adds one. The endpoint guard shipped with three services
 * named in an array and a fourth written the same hour — it passed, having
 * read none of it. A guard must find its own subject.
 */
export function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * SOURCE WITH THE PROSE TAKEN OUT.
 *
 * A guard that greps source for the thing it forbids finds its own
 * explanation of the thing it forbids. The customer app has had four guards
 * fire on their own documentation; stripping comments first is the fix, and it
 * belongs here so no guard has to remember it.
 *
 * NOT for tsconfig — it contains `"@cartze/core/*"`, and a naive block-comment
 * strip eats the file from that slash-star onward. Parse that instead.
 */
export const codeOnly = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
