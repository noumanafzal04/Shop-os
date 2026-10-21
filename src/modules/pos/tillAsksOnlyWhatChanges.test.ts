import { describe, expect, it } from "vitest";

/**
 * THE RETAIL FLOW, #2 (2026-10-21): the till asked for held tickets and lanes
 * every ten seconds for ever — 720 empty answers an hour in a shop with no
 * lanes and nothing parked — and for a page of the catalogue for a trade-in
 * panel nobody had opened. Each poll now runs where its race can happen.
 */
const read = (glob: Record<string, unknown>) => (Object.values(glob)[0] as string)
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const POS = read(import.meta.glob("./hooks/usePos.ts", { query: "?raw", import: "default", eager: true }));
const LANES = read(import.meta.glob("../registers/hooks/useRegisters.ts", { query: "?raw", import: "default", eager: true }));
const PAGE = read(import.meta.glob("./pages/PosPage.tsx", { query: "?raw", import: "default", eager: true }));

describe("what the till keeps asking", () => {
  it("asks for held tickets every ten seconds only while another lane trades or one is held", () => {
    expect(POS).toMatch(/refetchInterval: \(query\) => \(shared \|\| \(query\.state\.data\?\.length \?\? 0\) > 0 \? 10_000 : 60_000\)/);
    expect(PAGE).toMatch(/useHeldSales\(laneList\.some\(\(l\) => !!l\.open_session && l\.open_session\.user_id !== user\?\.id\)\)/);
  });

  it("asks for lanes only while the picker is open, or where there is another lane", () => {
    expect(LANES).toMatch(/refetchInterval: \(query\) => \(live \? 10_000 : \(query\.state\.data\?\.length \?\? 0\) > 1 \? 30_000 : false\)/);
    expect(PAGE).toMatch(/useLanes\(true, laneModal\.isOpen\)/);
  });

  it("does not search the catalogue for a trade-in until something is typed", () => {
    expect(PAGE).toMatch(/useProducts\(\{ search: tradeInQuery \|\| undefined \}, tradeInQuery\.length > 1\)/);
  });
});
