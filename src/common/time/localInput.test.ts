import { afterEach, describe, expect, it } from "vitest";
import { instantOf } from "./localInput";

const was = process.env.TZ;
afterEach(() => {
  if (was === undefined) delete process.env.TZ;
  else process.env.TZ = was;
});

describe("the moment a date-and-time box means", () => {
  it("is five in the afternoon in Lahore — noon UTC — not five o'clock UTC", () => {
    process.env.TZ = "Asia/Karachi";
    expect(instantOf("2026-10-07T17:00")).toBe("2026-10-07T12:00:00.000Z");
  });

  it("is read on the clock of the device it was typed on", () => {
    process.env.TZ = "UTC";
    expect(instantOf("2026-10-07T17:00")).toBe("2026-10-07T17:00:00.000Z");
  });

  it("is nothing when nothing was chosen, or nonsense was", () => {
    expect(instantOf("")).toBeUndefined();
    expect(instantOf(null)).toBeUndefined();
    expect(instantOf(undefined)).toBeUndefined();
    expect(instantOf("not a time")).toBeUndefined();
  });
});
