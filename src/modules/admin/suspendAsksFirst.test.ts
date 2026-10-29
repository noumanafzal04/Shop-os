import { describe, expect, it } from "vitest";

/**
 * SUSPEND ASKS FIRST (admin #AD5).
 *
 * One press suspended a live shop and signed out everybody in it within
 * seconds; Delete — reversible in exactly the same way — asked first.
 */
const PAGE = Object.values(
  import.meta.glob("./pages/AdminTenantDetailPage.tsx", { query: "?raw", import: "default", eager: true }),
)[0] as string;

describe("the Suspend button", () => {
  const doSuspend = PAGE.slice(PAGE.indexOf("const doSuspend = async"), PAGE.indexOf("const doAssignPlan"));

  it("is found", () => {
    expect(doSuspend.length).toBeGreaterThan(100);
  });

  it("opens the confirm sheet, and suspends only on a yes", () => {
    expect(doSuspend).toMatch(/await confirm\(\{/);
    expect(doSuspend).toMatch(/if \(ok\) run\(suspend,/);
  });

  it("says who is signed out", () => {
    expect(doSuspend).toMatch(/signed out at once/);
  });

  it("is what the button does — nothing else on the page suspends", () => {
    expect(PAGE).toMatch(/onClick=\{doSuspend\}/);
    expect(PAGE.match(/run\(suspend,/g)).toHaveLength(1);
  });
});
