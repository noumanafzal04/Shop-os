import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * NO TEXT AREA IS LEFT WITHOUT A NAME.
 *
 * The shared inputs join themselves to the label above them. A raw
 * `<textarea>` does not — four were written that way, and each was announced
 * by its placeholder: "edit text, Prices valid for the period shown".
 * `NamedTextarea` is the plain one that does. This holds the next text area
 * to it, because nothing else will: it looks identical on the screen.
 */

const SRC = path.resolve(__dirname, "../..");
/** The two components that ARE the text area. */
const ALLOWED = ["common/a11y/NamedTextarea.tsx", "components/form/input/TextArea.tsx"];

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);

    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [full] : [];
  });
}

describe("text areas", () => {
  const files = sources(SRC);

  it("were actually looked for", () => {
    // THE DENOMINATOR: the scan found the app, and the two that are allowed.
    expect(files.length).toBeGreaterThan(200);
    for (const allowed of ALLOWED) {
      expect(fs.readFileSync(path.join(SRC, allowed), "utf8")).toMatch(/<textarea/);
    }
  });

  it("are never written raw outside the two components that name them", () => {
    const raw = files
      .filter((file) => !ALLOWED.some((allowed) => file.endsWith(allowed)))
      .filter((file) => /<textarea[\s>]/.test(fs.readFileSync(file, "utf8")))
      .map((file) => path.relative(SRC, file));

    expect(raw, "use NamedTextarea (or the shared TextArea): a raw <textarea> has no accessible name").toEqual([]);
  });
});
