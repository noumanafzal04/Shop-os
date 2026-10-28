import { describe, expect, it } from "vitest";
import type { LimitUsage } from "../auth/types";
import { sellsOfflineOnlyByGrant } from "./offlineGrant";

/** #OF-K — a shop downgraded to Basic kept selling offline on its grant, and its page never said why. */
const usage = (baseline: number | null) => [{ key: "offline_selling", baseline } as LimitUsage];

describe("a shop that sells offline only by its grant", () => {
  it("is named when the grant is all that lets it", () => {
    expect(sellsOfflineOnlyByGrant({ limits: { offline_selling: 1 }, limits_usage: usage(0) })).toBe(true);
  });

  it("is not, when the plan would allow it anyway, or there is no grant", () => {
    expect(sellsOfflineOnlyByGrant({ limits: { offline_selling: 1 }, limits_usage: usage(1) })).toBe(false);
    expect(sellsOfflineOnlyByGrant({ limits: {}, limits_usage: usage(0) })).toBe(false);
    expect(sellsOfflineOnlyByGrant({ limits: { offline_selling: 1 } })).toBe(false);
  });
});
