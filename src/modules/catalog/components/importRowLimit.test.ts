import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE SCREEN'S NUMBER IS THE SERVER'S (offline #OF1).
 *
 * The server's limit was lowered from 2,000 to 500 on purpose — a 1,500-row
 * file took 48 seconds — and the import screen went on saying 2,000. A
 * shopkeeper with a 10,500-line list made six files of 2,000 and every one
 * bounced. Two files, one number: this reads both.
 */
const ACTION = resolve(__dirname, "../../../../../backend/app/Actions/Catalog/ImportProductsAction.php");
const MODAL = resolve(__dirname, "./ImportProductsModal.tsx");

describe("the import screen's row limit", () => {
  it.skipIf(!existsSync(ACTION))("is the limit the server refuses at", () => {
    const server = /const MAX_ROWS = (\d+);/.exec(readFileSync(ACTION, "utf8"));
    const screen = /Up to ([\d,]+) rows in a file/.exec(readFileSync(MODAL, "utf8"));

    expect(server, "the server's MAX_ROWS was not found").not.toBeNull();
    expect(screen, "the screen no longer states a row limit").not.toBeNull();
    expect(Number(screen![1].replace(/,/g, ""))).toBe(Number(server![1]));
  });
});
