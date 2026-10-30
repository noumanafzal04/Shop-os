import { describe, expect, it } from "vitest";

/**
 * THE SETTLE SHEET SAYS WHAT COMES TO THE TILL (#ON1).
 *
 * The owner's rule: a rider the platform sent keeps their delivery fees, a
 * shop's own rider carries them for the shop. The server answers `to_hand_in`
 * and falls back to it on a blank amount; the sheet has to offer the same
 * figure, or it invites the owner to ask a pool rider for their own pay.
 * Read as text — the sheet sits behind a modal, a statement query and a shop.
 */
const page = Object.values(
  import.meta.glob("./pages/RidersPage.tsx", { query: "?raw", import: "default", eager: true }),
).join("\n") as string;

describe("settling a rider", () => {
  it("offers what is owed, not everything collected", () => {
    expect(page).toMatch(/placeholder=\{String\(statement\.data\?\.to_hand_in \?\? /);
  });

  it("says whose the fees are, either way", () => {
    expect(page).toMatch(/is the rider's own delivery fees — they keep it, so \$\{money\(statement\.data\?\.to_hand_in/);
    expect(page).toMatch(/The delivery fees on these orders are the shop's — all of it comes to the till\./);
    expect(page).not.toMatch(/it does not pay them/);
  });
});
