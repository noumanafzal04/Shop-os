import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * NO SCREEN WRITES A CURRENCY MARK FOR ITSELF.
 *
 * Sixty-two lines of the panel said "Rs" by hand — a local `money` helper at
 * the top of a file, a template string, a JSX text node. Each was right for a
 * shop in Lahore and wrong for every other shop, and a sixty-third would have
 * been written the same way, by copying one of them.
 *
 * A shop's own figure is written by `useMoney()` (its currency, from the
 * server). What the platform charges is written by `platformMoney`. A price
 * on the marketplace is written by `money(n, shop.currency)`. This test fails
 * the day a file reaches for the mark instead.
 */

const SRC = path.resolve(__dirname, "../..");

/** Where a mark is allowed to be written down, and why. */
const ALLOWED: Array<[RegExp, string]> = [
  [/^common\/format\/currency\.ts$/, "the one place the default currency is defined"],
  [/^modules\/help\/content\.ts$/, "prose: worked examples a shopkeeper reads"],
  [/^modules\/qa\/content\.ts$/, "prose: what a tester should expect to see"],
  [/^modules\/landing\//, "marketing copy, written for one market"],
  [/\/fixtures\//, "figures made by the server"],
  [/\.test\.tsx?$/, "tests say what a PKR shop sees"],
];

/**
 * A mark written as code: in a string, a template, or as JSX text before a value.
 *
 * The JSX case needed `>` on the SAME line, so `Rs {cost.toLocaleString()}` on
 * a line of its own, `}Rs {diff}` and a label's "(Rs)" all walked past it —
 * nine of them, a deal's cost and the till's own discount box among them.
 */
const MARK = /(["'`])(?:Rs|PKR|₨|₹)\s?\1|[`"']Rs\s|Rs\s?\$\{|(?:^|[\s}>])(?:Rs|PKR|₨|₹)\s?\{|\?\?\s*["']Rs["']|\((?:Rs|PKR|₨|₹)\)/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }

  return out;
}

/** The code of a file: comments are prose about money, not money. */
function codeOf(source: string): string[] {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .split("\n")
    .map((line) => line.replace(/(^|\s)\/\/.*$/, ""));
}

describe("no screen writes a currency mark of its own", () => {
  const files = walk(SRC);

  it("looked at the whole panel", () => {
    // THE DENOMINATOR. A walk that found nothing would pass for the same
    // reason a clean panel does.
    expect(files.length).toBeGreaterThan(500);
  });

  it("finds a mark when one is written — so a clean result means something", () => {
    for (const line of ["const money = (n) => `Rs ${n}`;", 'const cur = settings?.symbol ?? "Rs";', "<span>Rs {total}</span>", 'label: "Rs " + price,', "            Rs {cost.toLocaleString()}", '{diff > 0 ? "+" : "−"}Rs {Math.abs(diff)} {per}', "<Label>Min spend (Rs)</Label>", 'label: "Fixed (PKR)" }']) {
      expect(MARK.test(codeOf(line).join("\n")), line).toBe(true);
    }
    for (const line of ["// the till read \"Rs 437.4\"", "const first = rows[0];", "{money(total)}", "const Rsvp = true;", "<Label>Min spend ({currency.symbol})</Label>", "const Rs = { a: 1 };", "(Rsvp)"]) {
      expect(MARK.test(codeOf(line).join("\n")), line).toBe(false);
    }
  });

  it("every amount goes through a formatter", () => {
    const offences: string[] = [];

    for (const file of files) {
      const rel = path.relative(SRC, file).split(path.sep).join("/");
      if (ALLOWED.some(([where]) => where.test(rel))) continue;

      codeOf(fs.readFileSync(file, "utf8")).forEach((line, i) => {
        if (MARK.test(line)) offences.push(`${rel}:${i + 1}  ${line.trim().slice(0, 120)}`);
      });
    }

    expect(offences, "these write a currency mark themselves — use useMoney(), platformMoney or money(n, shop.currency)").toEqual([]);
  });
});
