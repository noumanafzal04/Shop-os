import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * THE SHELF AND THE INVENTORY SCREENS ARE ONE THING, CACHED AS TWO.
 *
 * `["products"]` is the catalogue. `["inventory"]` is what the stockroom
 * screens read — movements, the reorder list, expiry, ageing, batches. They
 * are two views of the same shelf, and every write that moves stock moves
 * both. Six mutation hooks refreshed the first and left the second alone:
 *
 *   - RECEIVING a purchase order — the main way stock enters a shop. A buyer
 *     who had just booked in a delivery still saw those items on the reorder
 *     list, and no receipt on Stock movements.
 *   - a branch TRANSFER, a fuel DELIVERY, a settled dine-in TAB, a converted
 *     QUOTE, and every product edit — including the reorder level itself, so
 *     setting a level and finding the list unchanged read as a broken screen.
 *
 * And the branch switcher named four keys, none of them inventory, so a shop
 * that changed branch kept the FIRST branch's reorder list under the SECOND
 * branch's name.
 *
 * The rule this guard holds: wherever `["products"]` is invalidated,
 * `["inventory"]` is invalidated beside it. Not a list of stock-moving
 * endpoints — a list is a thing somebody has to maintain, and this one was
 * already wrong. A bare `invalidateQueries()` (everything) satisfies it too.
 */

const SRC = path.join(__dirname, "..", "src");

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);

    return entry.isFile() && /\.tsx?$/.test(entry.name) && !/\.(test|guard|spec)\.tsx?$/.test(entry.name)
      ? [full]
      : [];
  });
}

const PRODUCTS = /queryKey:\s*\["products"\]/;
const INVENTORY = /queryKey:\s*\["inventory"/;
/** A line that belongs to the same run of cache work. */
const SAME_CLUSTER = /invalidateQueries|removeQueries|resetQueries|^\s*(\/\/|\/\*|\*)|^\s*$/;

interface Site {
  file: string;
  line: number;
  cluster: string[];
}

/** Every `["products"]` invalidation, with the run of cache calls around it. */
function productSites(): Site[] {
  return sourceFiles(SRC).flatMap((file) => {
    const lines = fs.readFileSync(file, "utf8").split("\n");

    return lines.flatMap((line, i) => {
      if (!PRODUCTS.test(line)) return [];

      let top = i;
      while (top > 0 && SAME_CLUSTER.test(lines[top - 1])) top--;
      let bottom = i;
      while (bottom < lines.length - 1 && SAME_CLUSTER.test(lines[bottom + 1])) bottom++;

      return [{
        file: path.relative(SRC, file),
        line: i + 1,
        cluster: lines.slice(top, bottom + 1),
      }];
    });
  });
}

describe("a write that refreshes the catalogue refreshes the stockroom", () => {
  const sites = productSites();

  it("finds the invalidation sites at all", () => {
    // The denominator. A regex that quietly stops matching would make every
    // assertion below pass against nothing — the failure mode this codebase
    // has met more than once.
    expect(sites.length).toBeGreaterThan(15);
    expect(new Set(sites.map((s) => s.file)).size).toBeGreaterThan(8);
  });

  it("never refreshes products without refreshing inventory", () => {
    const orphans = sites
      .filter((s) => !s.cluster.some((line) => INVENTORY.test(line)))
      .map((s) => `${s.file}:${s.line}`);

    expect(orphans, "these refresh the catalogue and leave the stockroom screens stale").toEqual([]);
  });
});
