import { describe, expect, it } from "vitest";

import { DB_NAME } from "./db/schema";

/**
 * THE NAMES THAT MUST NOT BE RENAMED.
 *
 * The product is called CartZe. Three storage keys still say `shopos-`, and
 * every one of them has to stay that way — because they name data that already
 * exists on shopkeepers' devices, and a rename does not migrate it, it hides
 * it.
 *
 * What each one would cost:
 *
 *   `shopos-till`       the IndexedDB database. Renaming it points the till at
 *                       an EMPTY database — and the outbox lives in there.
 *                       Every sale rung during an outage and not yet sent
 *                       would be orphaned. That is money the shop has taken
 *                       and the server will never hear about.
 *
 *   `shopos-device-id`  the till's identity. A new id means a new slip
 *                       segment and a counter starting again at 000001 — so
 *                       the shop prints slip numbers it has already used, and
 *                       a customer holding one cannot be found. This has bitten
 *                       once already; see the offline slip-number work.
 *
 *   `shopos-auth`       the saved session. Renaming signs every shop out at
 *                       once, mid-day, with no explanation.
 *
 * A comment saying so is not enough — this codebase keeps finding rules that
 * lived only in prose. This test is the fence: anybody "finishing the rename"
 * has to delete a test that says what it costs first.
 *
 * If these ever DO need to change, the change is a migration that reads the old
 * name and writes the new one, not a find-and-replace.
 */
describe("storage keys survive the rename to CartZe", () => {
  it("keeps the till's database name", () => {
    expect(DB_NAME).toBe("shopos-till");
  });

  it("keeps the device id and session keys", async () => {
    // Read as source, because both are string literals passed to
    // localStorage rather than exported constants — which is itself the reason
    // they are easy to rename by accident.
    const sources = import.meta.glob("./device/deviceId.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    const deviceId = Object.values(sources)[0] ?? "";
    expect(deviceId).toContain("shopos-device-id");

    const stores = import.meta.glob("../../stores/authStore.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    expect(Object.values(stores)[0] ?? "").toContain("shopos-auth");
  });
});
