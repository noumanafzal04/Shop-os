import { describe, expect, it } from "vitest";

import { findOnBoard } from "./find";

const job = (number: string, customer_name: string | null, customer_phone: string | null, registration?: string) => ({
  number,
  customer_name,
  customer_phone,
  vehicle: registration ? { id: number, registration, make: null, model: null } : null,
});

const BOARD = [
  job("JOB-0041", "Sana Khan", "03001234567"),
  job("JOB-0042", "Bilal", "0321-7654321"),
  job("JOB-0043", null, null, "LEA4291"),
];

const numbers = (typed: string) => findOnBoard(BOARD, typed).map((j) => j.number);

describe("finding one job on a full board", () => {
  it("by the customer's name, in any case", () => {
    expect(numbers("sana")).toEqual(["JOB-0041"]);
    expect(numbers("SANA KHAN")).toEqual(["JOB-0041"]);
  });

  it("by phone, however it is spaced or dashed", () => {
    expect(numbers("0300 1234567")).toEqual(["JOB-0041"]);
    expect(numbers("03217654321")).toEqual(["JOB-0042"]);
  });

  it("by the number on the slip", () => {
    expect(numbers("JOB-0042")).toEqual(["JOB-0042"]);
    expect(numbers("0043")).toEqual(["JOB-0043"]);
  });

  it("by a plate typed with its dash", () => {
    expect(numbers("LEA-4291")).toEqual(["JOB-0043"]);
  });

  it("an empty box is the whole board, and a stranger is nobody", () => {
    expect(numbers("  ")).toEqual(["JOB-0041", "JOB-0042", "JOB-0043"]);
    expect(numbers("Kamran")).toEqual([]);
  });
});
