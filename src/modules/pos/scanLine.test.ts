import { describe, expect, it } from "vitest";
import { oneScanAtATime } from "./scanLine";

/**
 * A SCANNER GUN DOES NOT WAIT (mart #MT1).
 *
 * Ten codes fired back to back put two lines on the bill: the box was emptied
 * only when a lookup came back, so the gun typed the next code onto the end of
 * the last one.
 */
const POS = Object.values(
  import.meta.glob("./pages/PosPage.tsx", { query: "?raw", import: "default", eager: true }),
)[0] as string;

/** A lookup the test answers by hand, so two can be out at once. */
function pending() {
  let answer!: () => void;
  let fail!: () => void;
  const done = new Promise<void>((res, rej) => { answer = res; fail = () => rej(new Error("No item found for that code.")); });

  return { done, answer, fail };
}

describe("scans fired back to back", () => {
  it("are looked up one at a time, in the order they were scanned", async () => {
    const queue = oneScanAtATime();
    const first = pending();
    const started: string[] = [];

    const a = queue(() => { started.push("milk"); return first.done; });
    const b = queue(async () => { started.push("oil"); });
    await Promise.resolve();
    expect(started).toEqual(["milk"]);

    first.answer();
    await Promise.all([a, b]);
    expect(started).toEqual(["milk", "oil"]);
  });

  it("go on after one of them finds nothing", async () => {
    const queue = oneScanAtATime();
    const missing = pending();
    const rung: string[] = [];

    const a = queue(() => missing.done);
    const b = queue(async () => { rung.push("oil"); });
    missing.fail();

    await expect(a).rejects.toThrow("No item found");
    await b;
    expect(rung).toEqual(["oil"]);
  });
});

describe("the till's scan box", () => {
  const scan = POS.slice(POS.indexOf("const scan = ("), POS.indexOf("const lookUp = async"));
  const lookUp = POS.slice(POS.indexOf("const lookUp = async"), POS.indexOf("const whyNotSellable = "));

  it("is found", () => {
    expect(scan.length).toBeGreaterThan(50);
    expect(lookUp.length).toBeGreaterThan(500);
  });

  it("is emptied the moment Enter is taken, before the lookup is even queued", () => {
    expect(scan.indexOf('setSearch("")')).toBeGreaterThan(-1);
    expect(scan.indexOf('setSearch("")')).toBeLessThan(scan.indexOf("scanLine("));
  });

  it("is never emptied when a lookup comes back — the gun is typing the next code by then", () => {
    expect(lookUp).not.toMatch(/setSearch\(/);
  });
});
