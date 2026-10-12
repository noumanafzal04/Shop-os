import { describe, expect, it } from "vitest";

import { counted } from "./counted";

describe("a count with its noun", () => {
  it("is singular for exactly one, and plural for everything else", () => {
    expect(counted(1, "item")).toBe("1 item");
    expect(counted(3, "item")).toBe("3 items");
    expect(counted(0, "item")).toBe("0 items");
    expect(counted(2.5, "day")).toBe("2.5 days");
  });

  it("takes a plural that is not the noun with an s", () => {
    expect(counted(2, "box", "boxes")).toBe("2 boxes");
    expect(counted(1, "box", "boxes")).toBe("1 box");
  });

  it("reads a number that arrived as text, and nothing as none", () => {
    expect(counted("1.000", "item")).toBe("1 item");
    expect(counted("12", "member")).toBe("12 members");
    expect(counted(null, "review")).toBe("0 reviews");
    expect(counted(undefined, "product")).toBe("0 products");
  });

  it("never writes the undecided (s)", () => {
    for (const n of [0, 1, 2, 10.5]) expect(counted(n, "item")).not.toContain("(s)");
  });
});
