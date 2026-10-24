import { describe, expect, it } from "vitest";
import { failureWords, noAnswerWords } from "./failureWords";

/**
 * Next rounds #30 and #31, measured at the till: "Sale failed · Server Error",
 * "· Service Unavailable", "· Request failed.", "Couldn't save ·
 * Unauthenticated.", and "Too Many Attempts." with Retry-After: 30 ignored.
 */
describe("what a failed write tells a person", () => {
  it("says a broken server saved nothing and the work is still there", () => {
    for (const [status, body] of [[500, { message: "Server Error" }], [503, { message: "Service Unavailable" }], [502, undefined]] as const) {
      const said = failureWords(status, body, null);
      expect(said?.message).toContain("nothing was saved");
      expect(said?.message).toContain("still here");
      expect(said?.code).toBe("SERVER_FAILED");
    }
  });

  it("names the wait a throttle asked for, in seconds or as a date", () => {
    expect(failureWords(429, { message: "Too Many Attempts." }, "30")).toMatchObject({
      message: "Too many tries in a short time — wait 30 seconds, then try again. Nothing was saved.",
      meta: { retry_after: 30 },
    });
    const now = Date.parse("2026-10-24T10:00:00Z");
    expect(failureWords(429, undefined, "Sat, 24 Oct 2026 10:00:45 GMT", now)?.meta).toEqual({ retry_after: 45 });
    expect(failureWords(429, undefined, null)?.meta).toEqual({ retry_after: 30 });
  });

  it("says a lapsed sign-in in words", () => {
    expect(failureWords(401, { message: "Unauthenticated." }, null)?.message).toBe(
      "Your sign-in has run out, so nothing was saved. Sign in again to carry on.",
    );
  });

  it("leaves the server's own words where they are the shop's — a refusal, a field, a wrong password", () => {
    expect(failureWords(422, { message: "The amount field is required." }, null)).toBeNull();
    expect(failureWords(409, { message: "Open a shift first.", meta: { error_code: "SHIFT_REQUIRED" } }, null)).toBeNull();
    expect(failureWords(401, { message: "Those details don't match.", meta: { error_code: "INVALID_CREDENTIALS" } }, null)).toBeNull();
    expect(failureWords(503, { message: "Down for upkeep until 6.", meta: { error_code: "MAINTENANCE" } }, null)).toBeNull();
  });

  it("says an answer it cannot read saved nothing — a gateway's HTML page", () => {
    expect(failureWords(404, "<html>…</html>" as never, null)?.code).toBe("UNREADABLE_ANSWER");
  });
});

/** Next rounds #35: wifi off, and every list said "It may be down" — the server's fault. */
describe("no answer at all", () => {
  it("says the device is offline when it knows, and sends a person to their own line first when it does not", () => {
    expect(noAnswerWords(false)).toBe("This device is offline — check its wifi or mobile data. Nothing is lost; try again once the line is back.");
    expect(noAnswerWords(true)).toMatch(/^No answer from the server\. Check this device's internet first/);
    expect(noAnswerWords(true)).not.toContain("It may be down");
  });
});
