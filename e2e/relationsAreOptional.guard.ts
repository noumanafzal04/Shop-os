import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A RELATION IS PRESENT ONLY WHEN SOMEBODY LOADED IT.
 *
 * `InventoryPage` draws a sub-row per size with `p.variants.map(...)`, and the
 * low-stock endpoint loaded `category` and nothing else. `variants` was absent
 * from the payload, that map ran on `undefined`, and the reorder view went
 * blank the moment the list had a sized row to draw. It had only ever been seen
 * empty, which is the only reason nobody met it.
 *
 * TypeScript could not help, because the type said
 *
 *     variants: ProductVariant[]
 *
 * and that is a LIE. `variants` is an Eloquent relation. It is in the JSON when
 * the endpoint eager-loaded it and missing when it did not, and no screen can
 * know which endpoint it is looking at. Declaring it required told the compiler
 * to stop asking — so a crash that the type system was perfectly capable of
 * catching became a white page in a shop.
 *
 * Marking them optional turned that class into forty-two compile errors, every
 * one a place that would have gone blank. This keeps them optional.
 *
 * Not every array field: only the ones named after a real Eloquent relation on
 * a RESPONSE type. A payload you are SENDING (`PurchaseOrderInput.items`)
 * genuinely must have its items — you are the one supplying them.
 */

const SRC = path.join(__dirname, "..", "src");

/**
 * The response types whose relation arrays must stay optional.
 *
 * A list, and a list is a thing somebody has to maintain — but a short one that
 * fails loudly beats a rule that cannot tell a response from a request. Adding
 * a relation array to a response type and leaving it off this list costs
 * nothing today; the day it crashes, it is on the list.
 */
const MUST_BE_OPTIONAL: Array<[file: string, field: string]> = [
  ["modules/catalog/types.ts", "variants"],
  ["modules/catalog/types.ts", "images"],
  ["modules/catalog/types.ts", "options"],
  ["modules/purchases/types.ts", "items"],
  ["modules/orders/services/ordersService.ts", "items"],
  ["modules/dinein/services/dineInService.ts", "items"],
  ["modules/day/services/dayService.ts", "sessions"],
  ["modules/day/services/dayService.ts", "deposits"],
  ["modules/fuel/services/fuelService.ts", "nozzles"],
  ["modules/banks/services/banksService.ts", "offers"],
  ["modules/pos/services/posService.ts", "covers"],
  ["modules/kitchen/services/kitchenService.ts", "items"],
  ["modules/pharmacy/services/pharmacyService.ts", "batches"],
  ["modules/search/services/searchService.ts", "items"],
  ["modules/stocktake/services/stocktakeService.ts", "items"],
];

describe("a relation is optional, because the payload decides", () => {
  it("every relation array on a response type is declared optional", () => {
    const required: string[] = [];

    for (const [file, field] of MUST_BE_OPTIONAL) {
      const full = path.join(SRC, file);
      expect(fs.existsSync(full), `${file} has moved — this guard now checks nothing`).toBe(true);

      const src = fs.readFileSync(full, "utf8");
      // A TYPE member, and only that. The same two-space indent also holds the
      // service object's own methods — `deposits: (params) => apiGet(...)` —
      // and reading one of those as a required relation had this guard failing
      // about a function.
      const notAFunction = "(?!\\()";
      const declaredRequired = new RegExp(`(?:^ {2}|\\{ )${field}: ${notAFunction}`, "m").test(src);
      const declaredOptional = new RegExp(`(?:^ {2}|\\{ )${field}\\?: `, "m").test(src);

      if (!declaredRequired && !declaredOptional) {
        required.push(`${file} :: ${field} — neither form found, the guard has drifted`);
      } else if (declaredRequired) {
        required.push(`${file} :: ${field} — required, so a payload without it is a white page`);
      }
    }

    expect(required).toEqual([]);
  });

  it("is checking a real list", () => {
    // The denominator. A guard whose list quietly emptied would pass forever.
    expect(MUST_BE_OPTIONAL.length).toBeGreaterThan(12);
  });
});
