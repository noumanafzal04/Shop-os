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
