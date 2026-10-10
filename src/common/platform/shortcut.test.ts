import { describe, expect, it } from "vitest";

import { onAMac, searchKeys } from "./shortcut";

describe("the keys that open search, as the keyboard in front of the person prints them", () => {
  it("is Ctrl K on the PC a shop's counter is", () => {
    expect(searchKeys("Win32 Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toEqual(["Ctrl", "K"]);
    expect(searchKeys("Linux x86_64")).toEqual(["Ctrl", "K"]);
  });

  it("is ⌘ K on a Mac", () => {
    expect(searchKeys("MacIntel Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toEqual(["⌘", "K"]);
    expect(onAMac("iPad")).toBe(true);
  });

  it("does not claim a ⌘ it cannot see", () => {
    expect(searchKeys("")).toEqual(["Ctrl", "K"]);
  });
});
