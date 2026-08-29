import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * "IS THIS RUNNING LOW" IS ONE QUESTION, ASKED ONE WAY.
 *
 * It was asked in five places and answered in two. The catalogue and the till
 * summed a product's SIZES; the reorder list, the dashboard count, the products
 * table and the inventory table each read `stock_quantity` — which for anything
 * sold in sizes is the parent's orphaned nought, so
 *
 *     0 <= low_stock_threshold
 *
 * held for every threshold a shop could set. A rail holding two hundred shirts
 * was on the reorder list every day, and the purchase order it raised asked for
 * a full threshold of shirts the shop already had.
 *
 * The server now has one `LowStock` rule. On this side the helper already
 * existed — `catalogStock`, written for the till after a T-shirt with a full
 * rail rendered out of stock and unpressable — and two screens had hand-rolled
 * a wrong copy beside it. That is the failure this guard exists to make loud:
 * not a missing helper, an IGNORED one.
 *
 * A unit test rather than a browser one, deliberately: it must fail in seconds
 * on the machine of whoever writes the sixth copy.
 */

const SRC = path.join(__dirname, "..", "src");

function tsxFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(full);

    return entry.isFile() && /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [full]
      : [];
  });
}

/** Comments out first: a note ABOUT the rule is not a use of it. */
const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");

/**
 * A comparison of some stock figure against a reorder level, on one line.
 *
 * Matched loosely on purpose — `p.stock_quantity <= p.low_stock_threshold`,
 * `Number(x.stock_quantity) <= Number(x.low_stock_threshold)` and every spacing
 * between them are the same mistake.
 */
const HAND_ROLLED = /stock_quantity[^\n]{0,40}<=?[^\n]{0,40}low_stock_threshold/;

/**
 * The rows a VARIANT owns are the exception, and the only one.
 *
 * A single size compares its own quantity against its own level, which is
 * right: that row IS the stock. `catalogStock` is for the product above it.
 */
const isVariantRow = (line: string): boolean => /\bv\.|variant/i.test(line);

describe("what is running low", () => {
  const files = tsxFiles(SRC);

  it("reads the whole app, so a silent zero cannot pass as a clean sweep", () => {
    // The denominator. A guard pointed at an empty list passes for ever.
    expect(files.length).toBeGreaterThan(150);
  });

  it("is never hand-rolled from stock_quantity on a product", () => {
    const offenders: string[] = [];

    for (const file of files) {
      stripComments(fs.readFileSync(file, "utf8"))
        .split("\n")
        .forEach((line, i) => {
          if (HAND_ROLLED.test(line) && !isVariantRow(line)) {
            offenders.push(`${path.relative(SRC, file)}:${i + 1}`);
          }
        });
    }

    expect(
      offenders,
      "these compare a product's own stock_quantity against its reorder level. "
        + "A product sold in sizes keeps its stock on the variants and its own column "
        + "stays at nought, so this is true for every such product, always. "
        + "Use catalogStock(product) — the same rule the till and the server use.",
    ).toEqual([]);
  });
});
