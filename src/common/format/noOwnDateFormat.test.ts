import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * NO SCREEN WRITES A DATE ITS OWN WAY.
 *
 * Seventy-seven places asked the BROWSER how to write a date
 * (`toLocaleDateString()` and its relations), and the browser answered
 * differently on every laptop: the twelfth of October was "10/12/2026" on the
 * one the shop was looking at. They all write it the shop's way now
 * (`common/format/date.ts`), and thirty-three date boxes are one field
 * (`components/form/DateField`).
 *
 * The seventy-eighth would be written the same way the first was — by
 * somebody who needed a date on a row and reached for what the language
 * offers. This is what reads it before a shop does.
 */

const SRC = path.resolve(__dirname, "../..");

/** Asking the browser for a ZONE's clock is arithmetic, not writing a date for somebody to read. */
const WORK_OUT_A_ZONE = new Set(["common/shopDay.ts", "modules/offline/pricing/bestPromotion.ts"]);

const RULES: Array<{ what: string; found: RegExp; unless?: (file: string) => boolean }> = [
  { what: "writes a date the browser's way (toLocaleDateString) — use shopDate / shopShortDate", found: /\.toLocaleDateString\(/ },
  { what: "writes a clock the browser's way (toLocaleTimeString) — use timeOf", found: /\.toLocaleTimeString\(/ },
  { what: "writes a moment the browser's way (new Date(…).toLocaleString) — use shopDateTime", found: /new Date\([^)]*\)\.toLocaleString\(/ },
  { what: "writes a date the browser's way (toLocaleString with a day, month or hour) — use shopDateTime / shopShortDateTime", found: /\.toLocaleString\([^)]*\b(day|month|year|weekday|hour|minute)\s*:/ },
  { what: "formats with Intl.DateTimeFormat — use common/format/date", found: /Intl\.DateTimeFormat/, unless: (file) => WORK_OUT_A_ZONE.has(file) },
  { what: 'is a browser date box (<input type="date">) — use <Input type="date">, which is the shop\'s own date field', found: /<input\b[^>]*\btype="date"/ },
];

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return files(full);

    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

/** The code of a file, without its comments: a comment may SAY toLocaleDateString. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function offenders(): string[] {
  const found: string[] = [];

  for (const file of files(SRC)) {
    const where = path.relative(SRC, file).split(path.sep).join("/");
    // The one place a date is written.
    if (where === "common/format/date.ts") continue;
    const lines = code(fs.readFileSync(file, "utf8")).split("\n");

    lines.forEach((line, at) => {
      for (const rule of RULES) {
        if (rule.found.test(line) && !rule.unless?.(where)) found.push(`${where}:${at + 1} ${rule.what}`);
      }
    });
  }

  return found;
}

describe("a date is written in one place", () => {
  it("is not written the browser's way by any screen", () => {
    expect(offenders()).toEqual([]);
  });

  it("would notice one — the rule is not blind to its own subject", () => {
    const sample = [
      "const a = new Date(sale.sold_at).toLocaleDateString();",
      "const b = at.toLocaleTimeString([], { hour: '2-digit' });",
      "const c = new Date(x).toLocaleString();",
      "const d = when.toLocaleString(undefined, { day: 'numeric', month: 'short' });",
      "const e = new Intl.DateTimeFormat('en-GB').format(now);",
      '<input type="date" value={v} />',
    ];

    for (const line of sample) expect(RULES.some((rule) => rule.found.test(line)), line).toBe(true);
    // A number is not a date, and is nobody's business here.
    for (const fine of ["n.toLocaleString()", 'qty.toLocaleString(undefined, { maximumFractionDigits: 3 })', 'total.toLocaleString("en-US")']) {
      expect(RULES.some((rule) => rule.found.test(fine)), fine).toBe(false);
    }
  });

  it("reads its files with the comments taken out, and nothing else", () => {
    expect(code("a(); // never toLocaleDateString()\nb.toLocaleDateString();")).toBe("a(); \nb.toLocaleDateString();");
    expect(code('const u = "https://x.test/y"; /* toLocaleTimeString( */ c();')).toBe('const u = "https://x.test/y";  c();');
  });
});
