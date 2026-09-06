import { isRateLimited, noteRateLimit, pollEvery, resetRateLimit } from "../src/common/api/backoff";

/**
 * WHEN THE SERVER SAYS SLOW DOWN.
 *
 * The API allows 240 requests a minute per user, and what this app spends
 * deliberately is nowhere near it — a rider's board is four a minute, an order
 * screen six. The risk is not the steady state. It is a phone waking every
 * timer at once, three mounted screens refetching on focus together, or a
 * shared connection behind one address.
 *
 * Those arrive as a 429, and the failure mode that matters is not the refused
 * call — React Query already declines to retry a 4xx. It is the POLLS, which
 * ask by the CLOCK rather than by failure and would keep being refused four
 * and six times a minute until somebody closed the app.
 */

describe("backing off", () => {
  beforeEach(() => {
    resetRateLimit();
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  it("is not holding anything back to begin with", () => {
    expect(isRateLimited()).toBe(false);
    expect(pollEvery(10_000)).toBe(10_000);
  });

  it("stops the polls for as long as the server asked", () => {
    noteRateLimit(20);

    expect(isRateLimited()).toBe(true);
    // `false` stops React Query's timer entirely, rather than slowing it.
    expect(pollEvery(10_000)).toBe(false);

    jest.advanceTimersByTime(19_000);
    expect(isRateLimited()).toBe(true);

    jest.advanceTimersByTime(2_000);
    expect(isRateLimited()).toBe(false);
    expect(pollEvery(10_000)).toBe(10_000);
  });

  it("has an answer for a 429 with no Retry-After", () => {
    // Laravel always sends one, so this is the case that should not happen — a
    // proxy stripping headers, a gateway of its own. Guessing beats resuming
    // immediately into the same wall.
    noteRateLimit(undefined);
    expect(isRateLimited()).toBe(true);

    jest.advanceTimersByTime(15_001);
    expect(isRateLimited()).toBe(false);
  });

  it("ignores a Retry-After that is not a number", () => {
    noteRateLimit(Number.NaN);
    expect(isRateLimited()).toBe(true);

    jest.advanceTimersByTime(15_001);
    expect(isRateLimited()).toBe(false);
  });

  it("caps a wildly long Retry-After", () => {
    // It is a number somebody else controls. A misconfigured gateway answering
    // a day would otherwise switch this app's live screens off for a day.
    noteRateLimit(86_400);

    jest.advanceTimersByTime(60_001);
    expect(isRateLimited()).toBe(false);
  });

  it("a second refusal mid-pause never shortens the first", () => {
    noteRateLimit(40);
    jest.advanceTimersByTime(5_000);

    // Five seconds in, a shorter one arrives. Thirty-five seconds are still
    // owed, and taking the newer figure would resume into the same wall.
    noteRateLimit(5);

    jest.advanceTimersByTime(20_000);
    expect(isRateLimited()).toBe(true);

    jest.advanceTimersByTime(16_000);
    expect(isRateLimited()).toBe(false);
  });

  it("extends when a later refusal reaches further", () => {
    noteRateLimit(10);
    noteRateLimit(30);

    jest.advanceTimersByTime(11_000);
    expect(isRateLimited()).toBe(true);
  });
});
