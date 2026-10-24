import { describe, expect, it } from "vitest";

import { tillAskOf } from "./tillAsk";

/** Q19: a bill found in Sales goes to the till — to be added to, or re-rung. */
const SOURCES = import.meta.glob(["./pages/PosPage.tsx", "../sales/pages/SalesPage.tsx"], { query: "?raw", import: "default", eager: true });
const raw = (path: string) => SOURCES[path] as string;
/** Code without its prose, so a comment cannot pass for the rule. */
const code = (path: string) => raw(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

describe("what the till is asked", () => {
  it("reads a re-ring or an addition, and nothing else", () => {
    expect(tillAskOf({ reRing: "s1" })).toEqual({ reRing: "s1" });
    expect(tillAskOf({ addTo: "s2" })).toEqual({ addTo: "s2" });
    expect(tillAskOf({ forVehicle: "v1" })).toEqual({ forVehicle: "v1" });
    expect(tillAskOf({ forVehicle: "" })).toBeNull();
    expect(tillAskOf({ reRing: "" })).toBeNull();
    expect(tillAskOf({ reRing: 7 })).toBeNull();
    expect(tillAskOf({ somethingElse: "s1" })).toBeNull();
    expect(tillAskOf(null)).toBeNull();
    expect(tillAskOf("s1")).toBeNull();
  });
});

describe("the till takes a bill sent from Sales", () => {
  const till = code("./pages/PosPage.tsx");

  it("drops the ask from the history entry before acting on it, so Back does not start it again", () => {
    const effect = till.slice(till.indexOf("const ask = tillAskOf(location.state);"), till.indexOf("}, [location.state]);"));
    expect(effect).not.toBe("");
    const dropped = effect.indexOf("navigate(location.pathname, { replace: true, state: null });");
    expect(dropped).toBeGreaterThan(-1);
    expect(dropped).toBeLessThan(effect.indexOf("startReRing("));
    expect(dropped).toBeLessThan(effect.indexOf("startAddingTo("));
  });

  it("adds to a bill only when the server says it still may be", () => {
    const start = till.slice(till.indexOf("const startAddingTo"), till.indexOf("const startAddingTo") + 900);
    expect(start).toMatch(/if \(full\.add_to\?\.open !== true\) \{/);
    expect(start).toMatch(/setAddingTo\(billToAddTo\(full\)\)/);
    expect(start).toMatch(/if \(cart\.length > 0\) \{/);
  });
});

describe("the sale's page offers them only as the server answers", () => {
  const sales = code("../sales/pages/SalesPage.tsx");

  it("Add to this bill and Re-ring at the till, each on its own answer, for somebody who may use the till", () => {
    expect(sales).toMatch(/\{hasPos && canRing && detail\.data\.add_to\?\.open === true && \(\s*<Button[\s\S]{0,200}?state: \{ addTo: detail\.data\.id \}/);
    expect(sales).toMatch(/\{hasPos && canRing && detail\.data\.re_ring\?\.open === true && \(\s*<Button[\s\S]{0,200}?state: \{ reRing: detail\.data\.id \}/);
    expect(sales).toMatch(/const canRing = useAuthStore\(\(st\) => st\.hasPermission\)\("sales\.manage"\);/);
  });
});
