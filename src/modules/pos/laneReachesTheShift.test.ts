import { describe, expect, it } from "vitest";

/**
 * THE RETAIL FLOW, #3 (2026-10-21): a lane picked after the shift was open —
 * the order the till offers them — was kept on the device only, and Day &
 * banking's Lane column read "—" for every shift. The picker now moves the
 * open shift to the lane it names.
 */
const SOURCE = Object.values(
  import.meta.glob("./pages/PosPage.tsx", { query: "?raw", import: "default", eager: true }),
)[0] as string;
const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

describe("the lane a cashier picks", () => {
  it("moves their open shift to it", () => {
    const pick = code.slice(code.indexOf("setTerminal(l.id, l.name);"), code.indexOf("laneModal.closeModal();\n                }}"));
    expect(pick).toMatch(/if \(open && open\.register_id !== l\.id\) \{\s*shift\.move\.mutate\(l\.id, \{/);
  });

  it("says so when the server refuses, rather than leaving the device and the shift apart", () => {
    expect(code).toMatch(/Your shift was NOT moved to \$\{l\.name\}/);
  });
});
