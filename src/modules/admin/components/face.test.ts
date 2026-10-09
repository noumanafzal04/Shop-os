import { describe, expect, it } from "vitest";

import { initialsOf, toneFor } from "./face";

describe("a face for somebody with no photograph", () => {
  it("takes the first and the last word", () => {
    expect(initialsOf("Farhan Ali")).toBe("FA");
    expect(initialsOf("Muhammad Ali Khan")).toBe("MK");
    expect(initialsOf("  hira  ")).toBe("H");
  });

  it("has something to draw for a blank name", () => {
    expect(initialsOf("")).toBe("?");
    expect(initialsOf("   ")).toBe("?");
  });

  it("gives the same person the same colour every time, however it is typed", () => {
    expect(toneFor("Farhan Ali")).toBe(toneFor("Farhan Ali"));
    expect(toneFor("farhan ali ")).toBe(toneFor("Farhan Ali"));
  });

  it("does not paint everybody one colour, and never uses the colour of nothing", () => {
    const names = ["Farhan Ali", "Hira Saleem", "Omar Farooq", "Ayesha Sheikh", "Bilal Chaudhry", "Sana Malik", "Usman Qureshi", "Zainab Awan", "Imran Khokhar", "Nida Malik"];
    const tones = new Set(names.map(toneFor));

    expect(tones.size).toBeGreaterThan(3);
    expect(tones.has("slate")).toBe(false);
  });
});
