import { describe, expect, it } from "vitest";
import { ApiError } from "../../common/types/api";

/**
 * THE RETAIL FLOW, #7 (2026-10-21): a quotation dated into the past was
 * refused with the server's reason for the date box — and the sheet showed
 * only "The given data was invalid.", the envelope's own sentence.
 */
const SOURCES = import.meta.glob(["./**/*.tsx", "!./**/*.test.tsx"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

describe("a refused save on Quotes & Advances", () => {
  it("says the box and the reason the server gave", () => {
    const refused = new ApiError("The given data was invalid.", 422, "VALIDATION_ERROR", {
      expires_at: ["The expires at field must be a date after or equal to 2026-10-21."],
    });
    expect(refused.firstFieldError() ?? refused.message).toBe("The expires at field must be a date after or equal to 2026-10-21.");
  });

  it("never shows the bare envelope sentence on any screen of the module", () => {
    const bare = Object.entries(SOURCES).filter(([, code]) => /instanceof ApiError \? e\.message\b/.test(code)).map(([file]) => file);
    expect(bare).toEqual([]);
    expect(Object.keys(SOURCES).length).toBeGreaterThan(4);
  });

  it("does not offer a date the server will refuse", () => {
    expect(SOURCES["./components/ParkAsDocumentModal.tsx"]).toMatch(/<Input type="date" min=\{shopToday\(\)\}/);
  });
});
