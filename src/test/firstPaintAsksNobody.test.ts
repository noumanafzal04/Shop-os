import fs from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * THE FIRST PAINT ASKS NOTHING OF THE INTERNET.
 *
 * Found by a browser spec that failed for no reason of its own: the admin
 * console "took 7.3 seconds to arrive", with every API answer back inside a
 * tenth of one. The trace had the cause — `fonts.googleapis.com`, 5.3 seconds,
 * and the font file 3.4 more — because the app's own stylesheet began by
 * importing its typeface from Google, and a stylesheet blocks the first paint.
 *
 * A panel that goes blank when the font server is slow is poor. A TILL that
 * stays blank when the line is down behind a router that is still up is the
 * product failing at the one thing its offline mode is for.
 *
 * So nothing a page needs before it can draw may live on somebody else's
 * server. These read the two files that decide it.
 */
// Read from disk: a stylesheet imported into a test arrives EMPTY, `?raw` or
// not — which made the first version of this file pass three assertions about
// a string of length zero.
const css = fs.readFileSync("src/index.css", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const fonts = fs.readdirSync("src/assets/fonts").filter((name) => name.endsWith(".woff2"));

/** The stylesheet with its comments taken out — this file's own prose quotes the import it forbids. */
const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");

describe("the first paint asks nothing of the internet", () => {
  it("is reading the real files", () => {
    expect(css.length).toBeGreaterThan(1000);
    expect(css).toContain('@import "tailwindcss"');
    expect(html).toContain("<div id=\"root\">");
  });

  it("the stylesheet imports nothing from another server", () => {
    expect(rules.match(/@import\s+(?:url\()?["']?https?:/gi) ?? []).toEqual([]);
  });

  it("…and no rule in it points at one", () => {
    expect(rules.match(/url\(\s*["']?https?:[^)]*\)/gi) ?? []).toEqual([]);
  });

  it("the page itself links no stylesheet or font from another server", () => {
    const outside = html.match(/<link[^>]+href=["']https?:[^"']+["'][^>]*>/gi) ?? [];

    expect(outside.filter((tag) => /stylesheet|font|preload/i.test(tag))).toEqual([]);
  });

  it("the typeface is declared from the app's own files, both subsets", () => {
    const faces = rules.match(/@font-face\s*\{[^}]*\}/g) ?? [];

    expect(faces).toHaveLength(2);
    // One file each — two rules naming the same file is one subset declared twice.
    expect(faces.map((face) => /src:\s*url\("([^"]+)"\)/.exec(face)?.[1]).sort()).toEqual([
      "./assets/fonts/outfit-latin-ext.woff2",
      "./assets/fonts/outfit-latin.woff2",
    ]);
    for (const face of faces) {
      expect(face).toMatch(/font-family:\s*"Outfit"/);
      // Text draws in the fallback at once and swaps; it never waits.
      expect(face).toMatch(/font-display:\s*swap/);
      // The whole range of weights, as before — one variable file each.
      expect(face).toMatch(/font-weight:\s*100 900/);
    }
  });

  it("…and those files are in the repository", () => {
    expect(fonts.sort()).toEqual(["outfit-latin-ext.woff2", "outfit-latin.woff2"]);
    // Real font files, not an error page saved under a font's name.
    for (const name of fonts) {
      expect(fs.readFileSync(`src/assets/fonts/${name}`).subarray(0, 4).toString("latin1"), name).toBe("wOF2");
    }
    // The licence travels with them.
    expect(fs.readFileSync("src/assets/fonts/OFL.txt", "utf8")).toMatch(/SIL Open Font License, Version 1\.1/);
  });
});
