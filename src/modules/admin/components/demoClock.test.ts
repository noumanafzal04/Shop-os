import { afterEach, describe, expect, it, vi } from "vitest";

import { ends, opened } from "./demoClock";

const NOW = new Date("2026-10-09T12:00:00Z").getTime();
const at = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString();

afterEach(() => vi.useRealTimers());

describe("how long a demo has left", () => {
  it("counts hours while there are hours", () => {
    expect(ends(at(23 * 60 + 59), NOW)).toEqual({ text: "Ends in 23 h", tone: "sky" });
    expect(ends(at(60), NOW)).toEqual({ text: "Ends in 1 h", tone: "sky" });
  });

  it("counts minutes in the last hour, and says it is soon", () => {
    expect(ends(at(59), NOW)).toEqual({ text: "Ends in 59 min", tone: "amber" });
    expect(ends(at(1), NOW)).toEqual({ text: "Ends in 1 min", tone: "amber" });
  });

  it("past its day is still there to be kept — amber, never red", () => {
    expect(ends(at(0), NOW)).toEqual({ text: "Past its day", tone: "amber" });
    expect(ends(at(-600), NOW)).toEqual({ text: "Past its day", tone: "amber" });
  });

  it("says so when a demo was given no end", () => {
    expect(ends(null, NOW).text).toBe("No end set");
  });
});

describe("how long ago it was opened", () => {
  it("is a sentence, at every age", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    expect(opened(at(0))).toBe("opened just now");
    expect(opened(at(-12))).toBe("opened 12m ago");
    expect(opened(at(-185))).toBe("opened 3h 05m ago");
    expect(opened(null)).toBe("opened some time ago");
  });
});
