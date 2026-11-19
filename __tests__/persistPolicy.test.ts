import { isKeptOnPhone, KEEP_FOR_MS, shouldKeep } from "../src/common/api/persistPolicy";

/**
 * THE PHONE KEEPS THE CATALOGUE, NEVER THE PERSON.
 */
const q = (queryKey: unknown[], status: "success" | "error" | "pending" = "success") =>
  ({ queryKey, state: { status } }) as never;

describe("what survives a restart", () => {
  it.each([
    [["market", "home", { lat: 31.5 }]],
    [["market", "categories", {}]],
    [["market", "shops", { previews: true }]],
    [["market", "shop", "karahi", {}]],
    [["market", "menu", "karahi", ""]],
    [["market", "service-area", [31.5, 74.3]]],
  ])("keeps the public catalogue: %j", (key) => {
    expect(isKeptOnPhone(key)).toBe(true);
    expect(shouldKeep(q(key))).toBe(true);
  });

  it.each([
    [["market", "favorites"]],
    [["addresses"]],
    [["orders", "mine"]],
    [["auth", "me"]],
    [["market"]],
    [[]],
    [["market", 42]],
    [["marketing", "home"]],
  ])("never keeps anything about the person, or a key it does not know: %j", (key) => {
    expect(isKeptOnPhone(key)).toBe(false);
  });

  it("keeps only answers that succeeded", () => {
    expect(shouldKeep(q(["market", "home"], "error"))).toBe(false);
    expect(shouldKeep(q(["market", "home"], "pending"))).toBe(false);
  });

  it("holds a day, no more", () => {
    expect(KEEP_FOR_MS).toBe(86_400_000);
  });
});
